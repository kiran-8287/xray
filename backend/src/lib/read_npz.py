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
        # Load the .npz file
        npz_data = np.load(args.npz_path)
        pixel_array = npz_data['pixel_data']
        
        # Convert to list for JSON serialization
        pixel_list = pixel_array.tolist()
        
        # Get dimensions
        height = len(pixel_list)
        width = len(pixel_list[0]) if height > 0 else 0
        
        # Output as JSON
        result = {
            "width": width,
            "height": height,
            "pixel_data": pixel_list
        }
        print(json.dumps(result))
        
    except Exception as e:
        error_result = {
            "status": "error",
            "reason": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == "__main__":
    main()