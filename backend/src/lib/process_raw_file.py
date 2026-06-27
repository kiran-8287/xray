"""process_raw_file.py — Process .dump.pgm and .tip files via Python readers.
CLI usage:
    python process_raw_file.py \\
        --file-path /path/to/file.dump.pgm \\
        --file-type dump \\
        --item-id P01X010-2024101200923 \\
        --library-images-dir /path/to/library_images \\
        --pixel-data-dir /path/to/pixel_data
Outputs a single JSON line to stdout:
    Success: {"status":"done","id":"...","filepath":"...","pixelDataFilename":"...","width":...,"height":...,"fileType":"..."}
    Error:   {"status":"error","id":"...","reason":"..."}
"""
import sys
import json
import os
import uuid
import argparse
from pathlib import Path
import numpy as np
from PIL import Image

def import_from_path(module_name, file_path):
    """Dynamically import a Python module from an arbitrary file path."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    if spec is None:
        raise ImportError(f"Could not load module from {file_path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def resolve_scripts_dir():
    """Resolve the backend/scripts/ directory relative to this script's location.
    
    Script is at: backend/src/lib/process_raw_file.py
    scripts is at: backend/scripts/
    So we go up 2 levels to reach backend/, then into scripts.
    """
    script_dir = Path(__file__).resolve().parent  # backend/src/lib/
    scripts_dir = script_dir.parent.parent / "scripts"  # backend/scripts/
    return scripts_dir

def main():
    parser = argparse.ArgumentParser(description="Process raw .dump.pgm and .tip files")
    parser.add_argument("--file-path", required=True, help="Absolute path to the uploaded temp raw file")
    parser.add_argument("--file-type", required=True, choices=["dump", "tip"], help="Type of the raw file")
    parser.add_argument("--item-id", required=True, help="Derived item ID (filename stripped from first dot)")
    parser.add_argument("--library-images-dir", required=True, help="Output directory for the generated PNG")
    parser.add_argument("--pixel-data-dir", required=True, help="Output directory for pixel data JSON")
    args = parser.parse_args()
    file_path = args.file_path
    file_type = args.file_type
    item_id = args.item_id
    library_images_dir = args.library_images_dir
    pixel_data_dir = args.pixel_data_dir
    try:
        # Resolve the scripts directory and dynamically import the reader
        scripts_dir = resolve_scripts_dir()
        if file_type == "dump":
            dumpread_path = scripts_dir / "dumpread.py"
            if not dumpread_path.exists():
                raise FileNotFoundError(f"dumpread.py not found at {dumpread_path}")
            dumpread = import_from_path("dumpread", str(dumpread_path))
            # ReadDump returns (high, low, R) as numpy 2D float64 arrays (when raw=False)
            high, low, R = dumpread.ReadDump(file_path, raw=False)
            pixel_array = high  # 2D float64, shape (rows, cols)
            # Convert to uint16 using the existing helper in dumpread.py
            img = dumpread.to_uint16(pixel_array)  # np.uint16 array
            # Dimensions from the high array shape
            rows, cols = pixel_array.shape
        else:  # file_type == "tip"
            tipread_path = scripts_dir / "tipread.py"
            if not tipread_path.exists():
                raise FileNotFoundError(f"tipread.py not found at {tipread_path}")
            tipread = import_from_path("tipread", str(tipread_path))
            # read_tip returns (low_raw, high_raw) as numpy 2D uint16 arrays
            low_raw, high_raw = tipread.read_tip(file_path)
            # Apply 270° rotation (k=3), matching tipread.py's convert_tip_to_png behavior
            img = np.rot90(high_raw, k=3)  # uint16 array
            # Dimensions after rotation
            rows, cols = img.shape
        # --- Write 16-bit grayscale PNG ---
        os.makedirs(library_images_dir, exist_ok=True)
        png_path = os.path.join(library_images_dir, f"{item_id}.png")
        Image.fromarray(img).save(png_path)
        # --- Write pixel data JSON ---
        os.makedirs(pixel_data_dir, exist_ok=True)
        pixel_filename = f"{item_id}.json"
        pixel_path = os.path.join(pixel_data_dir, pixel_filename)
        # Convert pixel array to nested list for JSON serialization
        # Use the original pixel_array (before rotation for dump, before rotation for tip we use the rotated version)
        # For dump, pixel_array is the original high array
        # For tip, the rotated img is our pixel data source
        if file_type == "dump":
            pixel_data_for_json = pixel_array.tolist()  # convert to json-serializable
        else:
            pixel_data_for_json = img.tolist()  # rotated version
        with open(pixel_path, "w") as f:
            json.dump(pixel_data_for_json, f)
        # --- Output success result as JSON to stdout ---
        result = {
            "status": "done",
            "id": item_id,
            "filepath": f"{item_id}.png",
            "pixelDataFilename": pixel_filename,
            "width": cols,
            "height": rows,
            "fileType": file_type,
        }
        print(json.dumps(result))
    except Exception as e:
        # Output error result as JSON to stdout
        error_result = {
            "status": "error",
            "id": item_id,
            "reason": str(e),
        }
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == "__main__":
    main()