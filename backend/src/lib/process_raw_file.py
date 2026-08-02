"""process_raw_file.py — Process .dump.pgm and .tip files via Python readers.

Single-file mode (CLI):
    python process_raw_file.py \\
        --file-path /path/to/file.dump.pgm \\
        --file-type dump \\
        --item-id P01X010-2024101200923 \\
        --library-images-dir /path/to/library_images \\
        --pixel-data-dir /path/to/pixel_data

Batch mode (stdin JSON):
    echo '[{"filePath":"...","fileType":"dump","itemId":"...","libraryImagesDir":"...","pixelDataDir":"..."},...]' \\
        | python process_raw_file.py --batch

Outputs a JSON result line per file to stdout (NDJSON format).
"""
import sys
import json
import os
import gc
import argparse
from pathlib import Path
import numpy as np
from PIL import Image


# --- Globals lazily populated on first use -----------------------------------
# Import dumpread/tipread ONCE per interpreter lifetime and reuse them for
# every subsequent file in a --batch run. Previously, process_single_file()
# would re-invoke importlib machinery per file, adding measurable overhead.
_DUMPREAD_MOD = None
_TIPREAD_MOD = None
_SCRIPTS_DIR = None


def _get_scripts_dir():
    global _SCRIPTS_DIR
    if _SCRIPTS_DIR is None:
        script_dir = Path(__file__).resolve().parent
        _SCRIPTS_DIR = script_dir.parent.parent / "scripts"
    return _SCRIPTS_DIR


def import_from_path(module_name, file_path):
    """Dynamically import a Python module from an arbitrary file path."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    if spec is None:
        raise ImportError(f"Could not load module from {file_path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _get_dumpread():
    global _DUMPREAD_MOD
    if _DUMPREAD_MOD is None:
        scripts_dir = _get_scripts_dir()
        dumpread_path = scripts_dir / "dumpread.py"
        if not dumpread_path.exists():
            raise FileNotFoundError(f"dumpread.py not found at {dumpread_path}")
        _DUMPREAD_MOD = import_from_path("dumpread", str(dumpread_path))
    return _DUMPREAD_MOD


def _get_tipread():
    global _TIPREAD_MOD
    if _TIPREAD_MOD is None:
        scripts_dir = _get_scripts_dir()
        tipread_path = scripts_dir / "tipread.py"
        if not tipread_path.exists():
            raise FileNotFoundError(f"tipread.py not found at {tipread_path}")
        _TIPREAD_MOD = import_from_path("tipread", str(tipread_path))
    return _TIPREAD_MOD


def resolve_scripts_dir():
    """Resolve the backend/scripts/ directory relative to this script's location."""
    return _get_scripts_dir()


def ensure_uint16(arr):
    """Ensure array is uint16; convert only if needed to avoid double allocation."""
    if isinstance(arr, np.ndarray) and arr.dtype == np.uint16:
        return arr
    return np.clip(arr, 0, 65535).astype(np.uint16)


def process_single_file(file_path, file_type, item_id, library_images_dir, pixel_data_dir):
    """Process a single raw file and return result dict.

    gc.collect() is intentionally NOT called per-file anymore. The Python
    allocator holds freelists of small objects that get reused; forcing a full
    GC sweep per file added ~5-20 ms/file latency for zero benefit in a batch
    run where the process exits immediately after anyway. We run a single
    gc.collect() at the END of the main() batch loop just to leave the heap
    tidy before the OS tears the process down.
    """
    if file_type == "dump":
        dumpread = _get_dumpread()

        # ReadDump now returns uint16 arrays directly (no float64 allocation)
        high, low, R = dumpread.ReadDump(file_path, raw=False)
        rows, cols = high.shape

        # Ensure uint16 — ensure_uint16 is a no-op if already correct dtype
        high_u16 = ensure_uint16(high)
        low_u16  = ensure_uint16(low)

        # Drop references; arrays become garbage once the caller moves on.
        # In practice CPython's refcounting frees them immediately here.
        del high, low, R

        img = high_u16  # preview PNG from high-energy channel
    else:  # file_type == "tip"
        tipread = _get_tipread()
        low_raw, high_raw = tipread.read_tip(file_path)

        high_u16 = ensure_uint16(np.rot90(high_raw, k=3))
        low_u16  = ensure_uint16(np.rot90(low_raw, k=3))
        rows, cols = high_u16.shape

        del high_raw, low_raw

        img = high_u16

    # Write 16-bit grayscale PNG
    os.makedirs(library_images_dir, exist_ok=True)
    png_path = os.path.join(library_images_dir, f"{item_id}.png")
    Image.fromarray(img).save(png_path)

    # Write pixel data as .npz (always uint16 — cuts file size in half vs float64)
    highenergy_dir = os.path.join(pixel_data_dir, "highenergy")
    lowenergy_dir  = os.path.join(pixel_data_dir, "lowenergy")
    os.makedirs(highenergy_dir, exist_ok=True)
    os.makedirs(lowenergy_dir,  exist_ok=True)

    high_pixel_path = os.path.join(highenergy_dir, f"{item_id}.npz")
    np.savez_compressed(high_pixel_path, pixel_data=high_u16)

    low_pixel_path = os.path.join(lowenergy_dir, f"{item_id}.npz")
    np.savez_compressed(low_pixel_path, pixel_data=low_u16)

    # Drop references to large arrays
    del high_u16, low_u16

    pixel_filename = f"highenergy/{item_id}.npz"
    return {
        "status": "done",
        "id": item_id,
        "filepath": f"{item_id}.png",
        "pixelDataFilename": pixel_filename,
        "width": cols,
        "height": rows,
        "fileType": file_type,
    }

def main():
    parser = argparse.ArgumentParser(description="Process raw .dump.pgm and .tip files")
    parser.add_argument("--batch", action="store_true", help="Read batch JSON from stdin")
    parser.add_argument("--file-path", help="Absolute path to the uploaded temp raw file")
    parser.add_argument("--file-type", choices=["dump", "tip"], help="Type of the raw file")
    parser.add_argument("--item-id", help="Derived item ID")
    parser.add_argument("--library-images-dir", help="Output directory for generated PNG")
    parser.add_argument("--pixel-data-dir", help="Output directory for pixel data")
    args = parser.parse_args()

    if args.batch:
        # Batch mode: read JSON array from stdin
        try:
            raw_input = sys.stdin.read()
            tasks = json.loads(raw_input)
        except Exception as e:
            error_result = {"status": "error", "id": "batch", "reason": f"Failed to parse batch input: {str(e)}"}
            print(json.dumps(error_result))
            sys.exit(1)

        if not isinstance(tasks, list):
            error_result = {"status": "error", "id": "batch", "reason": "Batch input must be a JSON array"}
            print(json.dumps(error_result))
            sys.exit(1)

        for task in tasks:
            file_path = task.get("filePath", "")
            file_type = task.get("fileType", "")
            item_id = task.get("itemId", "unknown")
            library_images_dir = task.get("libraryImagesDir", "")
            pixel_data_dir = task.get("pixelDataDir", "")

            try:
                result = process_single_file(file_path, file_type, item_id, library_images_dir, pixel_data_dir)
                print(json.dumps(result), flush=True)
            except Exception as e:
                error_result = {
                    "status": "error",
                    "id": item_id,
                    "reason": str(e),
                }
                print(json.dumps(error_result), flush=True)

        # End-of-batch tidy-up: one gc.collect() instead of three per file.
        # CPython refcounting already released transient arrays; this only
        # handles any cyclic garbage (extremely rare in this pipeline) so
        # the OS tears the process down with a clean heap.
        gc.collect()
        sys.exit(0)
    else:
        # Single-file mode (legacy CLI)
        file_path = args.file_path
        file_type = args.file_type
        item_id = args.item_id
        library_images_dir = args.library_images_dir
        pixel_data_dir = args.pixel_data_dir

        if not all([file_path, file_type, item_id, library_images_dir, pixel_data_dir]):
            print(json.dumps({"status": "error", "id": "cli", "reason": "Missing required arguments"}))
            sys.exit(1)

        try:
            result = process_single_file(file_path, file_type, item_id, library_images_dir, pixel_data_dir)
            print(json.dumps(result))
            gc.collect()
        except Exception as e:
            error_result = {
                "status": "error",
                "id": item_id,
                "reason": str(e),
            }
            print(json.dumps(error_result))
            sys.exit(1)

if __name__ == "__main__":
    main()