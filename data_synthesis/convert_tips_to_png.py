"""Convert .tip files from guns/knife folders to 8-bit grayscale PNGs
using min-max normalization (same approach as dumpread.py does for .dump.pgm files)."""

import sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image


def normalize_to_uint8(array: np.ndarray) -> np.ndarray:
    """Min-max normalize a float/int array to 0-255 uint8 using cv2 (same as dumpread.py)."""
    return cv2.normalize(array, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)


def convert_tip_to_png(input_root: Path, output_root: Path):
    input_root = input_root.resolve()
    output_root = output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)

    tip_paths = sorted(input_root.glob("*.tip"))
    if not tip_paths:
        print(f"No .tip files found in {input_root}")
        return

    for src_path in tip_paths:
        # Open .tip as PIL Image -> numpy array
        img_pil = Image.open(src_path)
        arr = np.array(img_pil)  # dtype int32, values 0-65535

        # Min-max normalize to 0-255 uint8 (same as dumpread's save_array_png)
        arr_u8 = normalize_to_uint8(arr)

        # Save as grayscale PNG
        out_name = src_path.stem + ".png"
        out_path = output_root / out_name
        out_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(out_path), arr_u8)
        print(f"Converted {src_path.name} -> {out_path}  shape={arr.shape}  orig_range=[{arr.min()},{arr.max()}]")

    print(f"\nDone. Converted {len(tip_paths)} .tip files to {output_root}")


if __name__ == "__main__":
    base = Path(__file__).resolve().parent
    top_out = base.parent / "extracted_synthesis"

    # Convert guns
    guns_in = base / "guns"
    guns_out = top_out / "guns"
    if guns_in.exists():
        print("=" * 60)
        print("PROCESSING guns/")
        print("=" * 60)
        convert_tip_to_png(guns_in, guns_out)

    # Convert knife
    knife_in = base / "knife"
    knife_out = top_out / "knife"
    if knife_in.exists():
        print("=" * 60)
        print("PROCESSING knife/")
        print("=" * 60)
        convert_tip_to_png(knife_in, knife_out)

    print("\nAll done!")