"""Convert .tip files from guns/knife folders to 16-bit lossless PNGs.

- Synthesized images -> extracted_synthesis/guns/ and .../knife/ (16-bit PNG, no pixel loss)
- High/low channel images -> extracted_files_low_high/guns/ and .../knife/ (16-bit PNG, no pixel loss)
"""

import struct
from pathlib import Path

from PIL import Image
import numpy as np

def read_tip(filename):
    """Read a .tip file and return (low_raw, high_raw) as uint16 arrays."""
    with open(filename, "rb") as f:
        magic = f.readline().decode("ascii").strip()
        if magic != "P5":
            raise ValueError("Not a valid P5 PGM file.")

        while True:
            line = f.readline().decode("ascii")
            if not line.startswith("#"):
                width, height = map(int, line.strip().split())
                break

        while True:
            line = f.readline().decode("ascii")
            if not line.startswith("#"):
                maxval = int(line.strip())
                break

        if maxval != 65535:
            raise ValueError("Expected maxval of 65535 for 16-bit PGM.")

        rows = height
        cols = width // 2
        high_raw = np.empty((rows, cols), dtype=np.uint16)
        low_raw = np.empty((rows, cols), dtype=np.uint16)

        for i in range(rows):
            for j in range(cols):
                high_raw[i, j] = struct.unpack("H", f.read(2))[0]
                low_raw[i, j] = struct.unpack("H", f.read(2))[0]

    return low_raw, high_raw


def convert_tip_to_png(input_root, synthesis_root, lowhigh_root):
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

        hi_rot = np.rot90(high_raw, k=3)
        lo_rot = np.rot90(low_raw, k=3)

        base_name = src_path.stem

        syn_path = synthesis_root / f"{base_name}.png"
        syn_path.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(hi_rot).save(str(syn_path))

        high_out = lowhigh_root / f"{base_name}_high.png"
        low_out  = lowhigh_root / f"{base_name}_low.png"
        Image.fromarray(hi_rot).save(str(high_out))
        Image.fromarray(lo_rot).save(str(low_out))

        print(f"  {src_path.name} -> {syn_path.name}, {high_out.name}, {low_out.name}  (16-bit lossless)")

    print(f"\nDone. Converted {len(tip_paths)} .tip files from {input_root}")

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
