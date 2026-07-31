"""generate_png.py — Convert .npz file to .png image"""
import sys
import os
import argparse
import numpy as np
from PIL import Image


def main():
    parser = argparse.ArgumentParser(description="Convert .npz to .png")
    parser.add_argument("--npz-path", required=True, help="Path to .npz file")
    parser.add_argument("--png-path", required=True, help="Path to output .png file")
    args = parser.parse_args()

    try:
        # Use mmap_mode='r' to memory-map the npz file, avoiding a full RAM allocation
        npz = np.load(args.npz_path, mmap_mode='r')
        data = npz['pixel_data']

        # If data is float64 (legacy files), cast in-place to uint16 to halve memory usage
        if data.dtype != np.uint16:
            data = np.clip(data, 0, 65535).astype(np.uint16)

        os.makedirs(os.path.dirname(args.png_path), exist_ok=True)
        Image.fromarray(data).save(args.png_path)
        print("OK")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
