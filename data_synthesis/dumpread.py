# Version Info Variables
#
DUMPREAD_MAJOR_REVISION = "1.0"
DUMPREAD_MINOR_VERSION = "0.0.1"
DUMPREAD_VERSION_DATE = "20240917"


import argparse
import struct
from pathlib import Path

import numpy as np
import cv2

#from denoise import LVstPMGuidedDenoise


def ReadDump(filename, raw=False, FlippedAndRotated=False, DenoiseRequired=False):
    """read dump file and return arrays of high, low, R, high_raw, low_raw"""

    #     filename = 'P00X001-2020120200189.dump.pgm'
    f = open(filename, "rb")  # opening a binary file

    gate = f.readline().decode("ascii").strip()
    dims = f.readline().decode("ascii").split()
    cols = int(dims[0]) // 2
    rows = int(dims[1])
    line = f.readline()

    check_denoise = False
    while True:

        if line.decode("ascii")[0] == "#":

            line = f.readline()

            if not line:
                break
            decoded_line = line.decode("ascii", errors="ignore")
            if "denoised" in decoded_line:
                if "denoised=0" in decoded_line:
                    check_denoise = False
                # print("High and low are  not denoised")
                else:
                    check_denoise = True
                    # print("High and low are denoised")
        else:
            break

    high = np.empty([rows, cols])
    low = np.empty([rows, cols])

    for i in range(rows):
        for j in range(cols):
            value = f.read(2)
            high[i, j] = struct.unpack("H", value)[0]
            value = f.read(2)
            low[i, j] = struct.unpack("H", value)[0]

    while True:
        line = f.readline()
        if line.decode("ascii").strip() == "#Raw Data Dump":

            break

    high_raw = np.empty([rows, cols])
    low_raw = np.empty([rows, cols])

    for i in range(rows):
        for j in range(cols):
            value = f.read(2)
            high_raw[i, j] = struct.unpack("H", value)[0]
            value = f.read(2)
            low_raw[i, j] = struct.unpack("H", value)[0]

    R = np.empty([rows, cols])
    for i in range(rows):
        for j in range(cols):
            if low[i, j] < 60000 and low[i, j] != 0 and high[i, j] != 0:
                R[i, j] = np.log(high[i, j] / 65535) / np.log(low[i, j] / 65535)
            elif low[i, j] == 0:
                R[i, j] = 0
            elif high[i, j] == 0:
                R[i, j] = 0
            elif low[i, j] >= 60000:
                R[i, j] = np.inf
    if DenoiseRequired == True and check_denoise == False:

        low, high = LVstPMGuidedDenoise(low, high, 1.6, 100, 1, 5, 5, 3, 10000, 10000)

    if raw == True:
        return high, low, high_raw, low_raw

    elif FlippedAndRotated == True:
        print("The Image is flipped and Rotated")
        return cv2.flip(np.transpose(high),1), cv2.flip(np.transpose(low),1), cv2.flip(np.transpose(R), 1)
    else:
        print("The Image is Not flipped and Rotated")

        return high, low, R


def save_array_png(array, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img = cv2.normalize(array, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    return cv2.imwrite(str(path), img)


def convert_dump_to_png(input_root: Path, output_root: Path, channel_root: Path, source: str = "high"):
    input_root = input_root.resolve()
    output_root = output_root.resolve()
    channel_root = channel_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    channel_root.mkdir(parents=True, exist_ok=True)

    paths = sorted(input_root.rglob("*.dump.pgm"))
    if not paths:
        print(f"No .dump.pgm files found under {input_root}")
        return

    for src_path in paths:
        rel_path = src_path.relative_to(input_root)
        out_name = src_path.name[:-9] + ".png"
        out_path = output_root / rel_path.parent / out_name
        out_path.parent.mkdir(parents=True, exist_ok=True)

        high, low, R = ReadDump(str(src_path), raw=False)
        image_array = {"high": high, "low": low, "R": R}[source]
        if save_array_png(image_array, out_path):
            print(f"Converted {src_path} -> {out_path}")
        else:
            print(f"Failed to save {out_path}")

        base_name = src_path.name[:-9]
        for channel_name, channel_array in [("high", high), ("low", low), ("R", R)]:
            channel_path = channel_root / rel_path.parent / f"{base_name}_{channel_name}.png"
            if save_array_png(channel_array, channel_path):
                print(f"Saved {channel_name} channel {src_path} -> {channel_path}")
            else:
                print(f"Failed to save {channel_name} channel {channel_path}")

    print(f"Done. Converted {len(paths)} files to {output_root} and saved low/high/R files to {channel_root}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Convert all .dump.pgm files under data_synthesis to 8-bit PNGs."
    )
    parser.add_argument(
        "--input-root",
        default=Path(__file__).resolve().parent,
        help="Root folder to search for .dump.pgm files (default: current data_synthesis folder)",
        type=Path,
    )
    parser.add_argument(
        "--output-root",
        default=Path(__file__).resolve().parent.parent / "extracted_synthesis",
        help="Output folder for PNG files (default: top-level extracted_synthesis)",
        type=Path,
    )
    parser.add_argument(
        "--channel-root",
        default=Path(__file__).resolve().parent.parent / "extracted_files_low_high_R",
        help="Output folder for low/high/R PNG files (default: top-level extracted_files_low_high_R)",
        type=Path,
    )
    parser.add_argument(
        "--source",
        choices=["high", "low", "R"],
        default="high",
        help="Which internal array to write as PNG (default: high)",
    )
    args = parser.parse_args()
    convert_dump_to_png(args.input_root, args.output_root, args.channel_root, args.source)