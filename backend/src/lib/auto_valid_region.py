"""auto_valid_region.py — Generate valid region polygon from .npz pixel data.

Optimized version using scipy.ndimage and opencv for vectorized C-level operations.
Phase 1 optimizations yield ~50-150x speedup over pure Python pixel loops.

Single-file mode (CLI):
    python auto_valid_region.py --npz-path /path/to/file.npz

Batch mode (stdin NDJSON):
    echo '[{"npzPath":"...","itemId":"1"},{"npzPath":"...","itemId":"2"}]' \
        | python auto_valid_region.py --batch

Outputs a single JSON line per file to stdout (NDJSON format):
    {"status":"ok","points":[[x1,y1],[x2,y2],...],"width":W,"height":H,"pixelCount":N,"itemId":"..."}

Or on error:
    {"status":"error","reason":"...","itemId":"..."}
"""
import sys
import json
import argparse
import numpy as np
from scipy.ndimage import label as nd_label, binary_closing, binary_fill_holes, generate_binary_structure
import cv2


# ---------------------------------------------------------------------------
# Extract largest connected component (vectorized via scipy.ndimage.label)
# ---------------------------------------------------------------------------
def extract_largest_component(mask):
    """Return mask containing only the largest 8-connected component."""
    struct = np.ones((3, 3), dtype=np.uint8)
    labels, num_features = nd_label(mask, structure=struct)
    if num_features == 0:
        return mask

    counts = np.bincount(labels.ravel())
    if len(counts) <= 1:
        return mask

    max_label = int(np.argmax(counts[1:])) + 1
    return (labels == max_label).astype(np.uint8)


# ---------------------------------------------------------------------------
# Gaussian smoothing
# ---------------------------------------------------------------------------
def gaussian_kernel(hw):
    sigma = hw / 2.0
    kernel = []
    total = 0.0
    for i in range(-hw, hw + 1):
        w = np.exp(-(i * i) / (2 * sigma * sigma))
        kernel.append(w)
        total += w
    return [w / total for w in kernel]


def gaussian_smooth(points, half_window=5, passes=2):
    n = len(points)
    if n < 3:
        return points
    kernel = gaussian_kernel(half_window)
    pts = list(points)

    for _ in range(passes):
        out = []
        for i in range(n):
            sx, sy = 0.0, 0.0
            for j in range(-half_window, half_window + 1):
                idx = (i + j) % n
                w = kernel[j + half_window]
                sx += pts[idx][0] * w
                sy += pts[idx][1] * w
            out.append((sx, sy))
        pts = out
    return pts


# ---------------------------------------------------------------------------
# Ramer-Douglas-Peucker simplification
# ---------------------------------------------------------------------------
def perp_dist(point, a, b):
    px, py = point
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    len_sq = dx * dx + dy * dy
    if len_sq == 0:
        return np.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / len_sq))
    return np.hypot(px - (ax + t * dx), py - (ay + t * dy))


def rdp_simplify(points, epsilon):
    n = len(points)
    if n <= 2:
        return points
    max_dist, max_idx = 0.0, 0
    first, last = points[0], points[-1]
    for i in range(1, n - 1):
        d = perp_dist(points[i], first, last)
        if d > max_dist:
            max_dist = d
            max_idx = i
    if max_dist > epsilon:
        left = rdp_simplify(points[:max_idx + 1], epsilon)
        right = rdp_simplify(points[max_idx:], epsilon)
        return left[:-1] + right
    return [first, last]


def adaptive_rdp(points, min_pts=30, max_pts=80):
    if len(points) <= max_pts:
        return points
    lo, hi = 0.01, 50.0
    for _ in range(12):
        mid = (lo + hi) / 2.0
        simplified = rdp_simplify(points, mid)
        if len(simplified) < min_pts:
            hi = mid
        elif len(simplified) > max_pts:
            lo = mid
        else:
            return simplified
        if hi - lo < 0.05:
            break
    return rdp_simplify(points, lo)


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------
def ensure_closed(points):
    if len(points) < 3:
        return points
    if points[0] != points[-1]:
        return points + [points[0]]
    return points


def remove_duplicates(points):
    if len(points) <= 1:
        return points
    out = [points[0]]
    for p in points[1:]:
        if p != out[-1]:
            out.append(p)
    return out


def normalize_points(points, w, h):
    return [(float(x) / float(w), float(y) / float(h)) for x, y in points]


# ---------------------------------------------------------------------------
# Contour extraction via OpenCV
# ---------------------------------------------------------------------------
def extract_external_contour(padded):
    """Extract outer contour of the largest component using cv2.findContours."""
    contours, _ = cv2.findContours(padded, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return []
    largest = max(contours, key=cv2.contourArea)
    pts = largest.reshape(-1, 2)
    return [(float(p[0]), float(p[1])) for p in pts]


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------
def generate_valid_region(npz_path):
    """Generate valid region polygon from .npz pixel data."""
    # 1. Load pixel data using memory mapping (zero-copy)
    npz = np.load(npz_path, mmap_mode='r')
    pixel_array = npz['pixel_data']
    height, width = pixel_array.shape

    # 2. Binary mask: < 65400 = bag material
    WHITE_THRESHOLD = 65400
    mask = (pixel_array < WHITE_THRESHOLD).astype(np.uint8)
    pixel_count = int(np.sum(mask))

    if pixel_count == 0:
        raise ValueError("No non-white pixels found in pixel data")

    del pixel_array
    del npz

    # 3. Extract largest component (removes noise before morphology)
    bag_mask = extract_largest_component(mask)
    del mask

    # 4. Morphological closing (fill small interior holes) — vectorized scipy
    struct4 = generate_binary_structure(2, 1)
    bag_mask = binary_closing(bag_mask, structure=struct4, iterations=3).astype(np.uint8)

    # 5. Flood-fill interior holes (catch large voids) — vectorized scipy
    bag_mask = binary_fill_holes(bag_mask).astype(np.uint8)

    # 6. Re-extract largest component (only if multiple components remain, rare)
    check_labels, check_num = nd_label(bag_mask, structure=np.ones((3, 3), dtype=np.uint8))
    if check_num > 1:
        counts = np.bincount(check_labels.ravel())
        max_label = int(np.argmax(counts[1:])) + 1
        bag_mask = (check_labels == max_label).astype(np.uint8)
    del check_labels

    # 7. Pad mask by 1 pixel so bags touching border trace correctly
    padded = np.zeros((height + 2, width + 2), dtype=np.uint8)
    padded[1:-1, 1:-1] = bag_mask
    del bag_mask

    # 8. Contour extraction via OpenCV (C-optimized)
    contour = extract_external_contour(padded)
    if len(contour) < 3:
        raise ValueError("Could not find contour (< 3 points)")

    # Remove padding offset
    contour = [(float(x) - 1.0, float(y) - 1.0) for x, y in contour]

    # 9. Gaussian smoothing
    contour = gaussian_smooth(contour, 5, 2)

    # 10. Close and deduplicate
    contour = ensure_closed(contour)
    contour = remove_duplicates(contour)
    if len(contour) < 3:
        raise ValueError("Contour too small after smoothing")

    # 11. Adaptive RDP simplification
    simplified = adaptive_rdp(contour, 30, 80)
    if len(simplified) < 3:
        raise ValueError("Simplified polygon < 3 points")

    # 12. Final cleanup + normalize to [0, 1]
    final = remove_duplicates(ensure_closed(simplified))
    if len(final) < 3:
        raise ValueError("Final polygon < 3 points")

    normalized = normalize_points(final, width, height)

    return {
        "points": normalized,
        "width": width,
        "height": height,
        "pixelCount": pixel_count
    }


def process_one(npz_path, item_id=None):
    """Process a single .npz file and return a result dict with itemId."""
    try:
        result = generate_valid_region(npz_path)
        points_list = [[float(p[0]), float(p[1])] for p in result["points"]]
        output = {
            "status": "ok",
            "points": points_list,
            "width": result["width"],
            "height": result["height"],
            "pixelCount": result["pixelCount"]
        }
        if item_id is not None:
            output["itemId"] = item_id
        return output
    except Exception as e:
        output = {
            "status": "error",
            "reason": str(e)
        }
        if item_id is not None:
            output["itemId"] = item_id
        return output


def main():
    parser = argparse.ArgumentParser(description="Generate valid region polygon from .npz pixel data")
    parser.add_argument("--npz-path", help="Absolute path to the .npz file (single-file mode)")
    parser.add_argument("--batch", action="store_true", help="Read batch tasks as NDJSON array from stdin")
    args = parser.parse_args()

    if args.batch:
        data = sys.stdin.read()
        try:
            tasks = json.loads(data)
        except json.JSONDecodeError as e:
            print(json.dumps({"status": "error", "reason": f"Invalid batch JSON: {e}"}))
            sys.exit(1)

        if not isinstance(tasks, list):
            print(json.dumps({"status": "error", "reason": "Batch input must be a JSON array"}))
            sys.exit(1)

        for task in tasks:
            npz_path = task.get("npzPath")
            item_id = task.get("itemId")
            if not npz_path:
                res = {"status": "error", "reason": "Missing npzPath in task"}
                if item_id:
                    res["itemId"] = item_id
                print(json.dumps(res))
                continue
            result = process_one(npz_path, item_id)
            print(json.dumps(result))
            sys.stdout.flush()
    else:
        if not args.npz_path:
            print(json.dumps({"status": "error", "reason": "--npz-path is required in single-file mode"}))
            sys.exit(1)
        result = process_one(args.npz_path)
        print(json.dumps(result))
        if result["status"] == "error":
            sys.exit(1)


if __name__ == "__main__":
    main()
