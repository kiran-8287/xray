"""Convert .tip files from guns/knife folders to 16-bit lossless PNGs.

- Synthesized images → extracted_synthesis/guns/ and .../knife/ (16-bit PNG, no pixel loss)
- High/low channel images → extracted_files_low_high/guns/ and .../knife/ (16-bit PNG, no pixel loss)
"""

import struct
from pathlib import Path

import cv2
import numpy as np


# ──────────────────────────────────────────────
# .tip file reader (PGM parser, same as original tipread.py)
# ──────────────────────────────────────────────
def read_tip(filename):
    """Read a .tip file and return (low_raw, high_raw) as uint16 arrays."""
    with open(filename, 'rb') as f:
        magic = f.readline().decode('ascii').strip()
        if magic != 'P5':
            raise ValueError("Not a valid P5 PGM file.")

        # Read dimension line (skip any comment lines)
        while True:
            line = f.readline().decode('ascii')
            if not line.startswith('#'):
                width, height = map(int, line.strip().split())
                break

        # Read maxval line (skip any comment lines)
        while True:
            line = f.readline().decode('ascii')
            if not line.startswith('#'):
                maxval = int(line.strip())
                break

        if maxval != 65535:
            raise ValueError("Expected maxval of 65535 for 16-bit PGM.")

        # Read interleaved high/low image data
        rows = height
        cols = width // 2
        high_raw = np.empty((rows, cols), dtype=np.uint16)
        low_raw = np.empty((rows, cols), dtype=np.uint16)

        for i in range(rows):
            for j in range(cols):
                high_raw[i, j] = struct.unpack('H', f.read(2))[0]
                low_raw[i, j] = struct.unpack('H', f.read(2))[0]

    return low_raw, high_raw


# ──────────────────────────────────────────────
# Normalisation helper
# ──────────────────────────────────────────────
# ──────────────────────────────────────────────
# Conversion routine
# ──────────────────────────────────────────────
def convert_tip_to_png(input_root: Path, synthesis_root: Path, lowhigh_root: Path):
    input_root = input_root.resolve()
    synthesis_root = synthesis_root.resolve()
    lowhigh_root = lowhigh_root.resolve()
    synthesis_root.mkdir(parents=True, exist_ok=True)
    lowhigh_root.mkdir(parents=True, exist_ok=True)

    tip_paths = sorted(input_root.glob("*.tip"))
    if not tip_paths:
        print(f"No .tip files found in {input_root}")
        return

    for src_path in tip_paths:
        low_raw, high_raw = read_tip(str(src_path))

        # Apply 270° rotation (matching original tipread.load_image)
        hi_rot = np.rot90(high_raw, k=3)
        lo_rot = np.rot90(low_raw, k=3)

        base_name = src_path.stem

        # 1) Synthesised image → extracted_synthesis/ (16-bit PNG, preserve all values)
        syn_path = synthesis_root / f"{base_name}.png"
        syn_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(syn_path), hi_rot)

        # 2) High/low channel images → extracted_files_low_high/ (16-bit lossless)
        high_out = lowhigh_root / f"{base_name}_high.png"
        low_out  = lowhigh_root / f"{base_name}_low.png"
        cv2.imwrite(str(high_out), hi_rot)  # hi_rot is already uint16
        cv2.imwrite(str(low_out), lo_rot)   # lo_rot is already uint16

        print(f"  {src_path.name} -> {syn_path.name}, {high_out.name}, {low_out.name}  (16-bit lossless)")

    print(f"\nDone. Converted {len(tip_paths)} .tip files from {input_root}")


# ──────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────
if __name__ == "__main__":
    base = Path(__file__).resolve().parent
    root = base.parent

    for category in ("guns", "knife"):
        src_dir = base / category
        if not src_dir.exists():
            continue
        print("=" * 60)
        print(f"PROCESSING {category}/")
        print("=" * 60)
        convert_tip_to_png(
            src_dir,
            root / "extracted_synthesis" / category,
            root / "extracted_files_low_high" / category,
        )

    print("\nAll done!")