"""read_npz.py — Read pixel data from .npz file and output as JSON
CLI usage:
    python read_npz.py --npz-path /path/to/pixel_data.npz
Outputs JSON to stdout:
    {"width": 512, "height": 512, "pixel_data": [[...], [...], ...]}
"""
import sys
import json
import argparse
import numpy as np

def main():
    parser = argparse.ArgumentParser(description="Read pixel data from .npz file")
    parser.add_argument("--npz-path", required=True, help="Absolute path to the .npz file")
    args = parser.parse_args()
    
    try:
        # Load the .npz file with memory mapping to reduce memory usage
        npz_data = np.load(args.npz_path, mmap_mode='r')
        pixel_array = npz_data['pixel_data']
        
        # Get dimensions
        height, width = pixel_array.shape
        
        # Stream output row by row to avoid holding entire array in memory
        # This prevents the memory allocation error by never having both
        # the numpy array and the full list in memory simultaneously
        print(json.dumps({"width": width, "height": height, "pixel_data": "streaming"}))
        sys.stdout.flush()
        
        # Output array start
        print("[", end='')
        sys.stdout.flush()
        
        # Stream each row as JSON
        for i in range(height):
            row = pixel_array[i].tolist()
            row_json = json.dumps(row)
            if i > 0:
                print(",", end='')
            print(row_json, end='')
            sys.stdout.flush()
            del row
        
        # Output array end
        print("]")
        sys.stdout.flush()
        
        # Clean up
        del pixel_array
        del npz_data
        import gc
        gc.collect()
        
    except Exception as e:
        error_result = {
            "status": "error",
            "reason": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == "__main__":
    main()