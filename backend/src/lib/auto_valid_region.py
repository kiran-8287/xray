"""auto_valid_region.py — Generate valid region polygon from .npz pixel data.

This is a Python port of autoValidRegion.js, but avoids the massive memory
overhead of sending the entire pixel array through JSON to Node.js.

Usage:
    python auto_valid_region.py --npz-path /path/to/file.npz

Outputs a single JSON line to stdout:
    {"status":"ok","points":[[x1,y1],[x2,y2],...],"width":W,"height":H,"pixelCount":N}
    
Or on error:
    {"status":"error","reason":"..."}
"""
import sys
import json
import argparse
import gc
import numpy as np
from collections import deque


# ---------------------------------------------------------------------------
# Connected component labeling using 8-connectivity (two-pass)
# ---------------------------------------------------------------------------
def label_components(mask, width, height):
    """Label connected components using 8-connectivity. Returns 2D labels array."""
    labels = np.zeros((height, width), dtype=np.int32)
    # Disjoint set (Union-Find)
    parent = {}
    rank = {}

    def make_set(x):
        if x not in parent:
            parent[x] = x
            rank[x] = 0

    def find(x):
        # Path compression
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x, y):
        rx, ry = find(x), find(y)
        if rx == ry:
            return
        if rank[rx] < rank[ry]:
            parent[rx] = ry
        elif rank[rx] > rank[ry]:
            parent[ry] = rx
        else:
            parent[ry] = rx
            rank[rx] += 1

    next_label = 1
    for y in range(height):
        for x in range(width):
            if mask[y, x] == 0:
                continue
            # Check 4 already-visited neighbors: top-left, top, top-right, left
            neighbor_labels = []
            if x > 0 and mask[y, x - 1] == 1:
                neighbor_labels.append(labels[y, x - 1])
            if y > 0 and mask[y - 1, x] == 1:
                neighbor_labels.append(labels[y - 1, x])
            if x > 0 and y > 0 and mask[y - 1, x - 1] == 1:
                neighbor_labels.append(labels[y - 1, x - 1])
            if x < width - 1 and y > 0 and mask[y - 1, x + 1] == 1:
                neighbor_labels.append(labels[y - 1, x + 1])

            if not neighbor_labels:
                labels[y, x] = next_label
                make_set(next_label)
                next_label += 1
            else:
                min_label = min(neighbor_labels)
                labels[y, x] = min_label
                for nl in neighbor_labels:
                    if nl != min_label:
                        union(min_label, nl)

    # Second pass: flatten to root labels
    root_to_new = {}
    new_label = 1
    for y in range(height):
        for x in range(width):
            if labels[y, x] == 0:
                continue
            root = find(labels[y, x])
            if root not in root_to_new:
                root_to_new[root] = new_label
                new_label += 1
            labels[y, x] = root_to_new[root]

    return labels


# ---------------------------------------------------------------------------
# Extract largest connected component
# ---------------------------------------------------------------------------
def extract_largest_component(mask, width, height):
    labels = label_components(mask, width, height)
    if np.max(labels) == 0:
        return mask

    # Count pixels per component
    counts = np.bincount(labels.ravel())
    # Skip background (label 0)
    if len(counts) > 1:
        max_label = np.argmax(counts[1:]) + 1
    else:
        return mask

    result = np.where(labels == max_label, 1, 0).astype(np.uint8)
    return result


# ---------------------------------------------------------------------------
# Morphological operations (4-connectivity)
# ---------------------------------------------------------------------------
def dilate4(mask):
    h, w = mask.shape
    out = np.zeros_like(mask)
    for y in range(h):
        for x in range(w):
            if mask[y, x] == 0:
                continue
            if y > 0:   out[y - 1, x] = 1
            if y < h - 1: out[y + 1, x] = 1
            if x > 0:   out[y, x - 1] = 1
            if x < w - 1: out[y, x + 1] = 1
            out[y, x] = 1
    return out


def erode4(mask):
    h, w = mask.shape
    out = np.zeros_like(mask)
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if (mask[y, x] == 1 and
                mask[y - 1, x] == 1 and
                mask[y + 1, x] == 1 and
                mask[y, x - 1] == 1 and
                mask[y, x + 1] == 1):
                out[y, x] = 1
    return out


def morph_close(mask, radius=3):
    m = mask.copy()
    for _ in range(radius):
        m = dilate4(m)
    for _ in range(radius):
        m = erode4(m)
    return m


# ---------------------------------------------------------------------------
# Fill interior holes (flood-fill background from borders)
# ---------------------------------------------------------------------------
def fill_interior_holes(mask):
    h, w = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    queue = deque()

    def enqueue(y, x):
        if 0 <= y < h and 0 <= x < w and not visited[y, x] and mask[y, x] == 0:
            visited[y, x] = True
            queue.append((y, x))

    # Border pixels
    for x in range(w):
        enqueue(0, x)
        enqueue(h - 1, x)
    for y in range(h):
        enqueue(y, 0)
        enqueue(y, w - 1)

    while queue:
        y, x = queue.popleft()
        enqueue(y - 1, x)
        enqueue(y + 1, x)
        enqueue(y, x - 1)
        enqueue(y, x + 1)

    result = np.where((mask == 1) | ((mask == 0) & ~visited), 1, 0).astype(np.uint8)
    return result


# ---------------------------------------------------------------------------
# Moore-Neighbor contour tracing
# ---------------------------------------------------------------------------
DIR_DX = [1, 1, 0, -1, -1, -1, 0, 1]
DIR_DY = [0, -1, -1, -1, 0, 1, 1, 1]


def moore_next(mask, h, w, cx, cy, back_dir):
    for i in range(1, 9):
        d = (back_dir + i) % 8
        nx, ny = cx + DIR_DX[d], cy + DIR_DY[d]
        if 0 <= nx < w and 0 <= ny < h and mask[ny, nx] == 1:
            return nx, ny, d
    return None


def trace_contour(mask, h, w):
    """Trace outer contour of the largest component using Moore-neighbor algorithm."""
    # Find topmost-leftmost foreground pixel
    start_x, start_y = -1, -1
    for y in range(h):
        for x in range(w):
            if mask[y, x] == 1:
                start_x, start_y = x, y
                break
        if start_x != -1:
            break
    if start_x == -1:
        return []

    contour = [(start_x, start_y)]

    # First step: enter from West (dir=4)
    first = moore_next(mask, h, w, start_x, start_y, 4)
    if first is None:
        return contour

    cx, cy, back_d = first
    # back_dir = opposite of next.dir
    back_d = (first[2] + 4) % 8
    cx, cy = first[0], first[1]

    # Safety limit
    max_pts = 2 * (w + h) * 4

    while (cx, cy) != (start_x, start_y) and len(contour) < max_pts:
        contour.append((cx, cy))
        next_p = moore_next(mask, h, w, cx, cy, back_d)
        if next_p is None:
            break
        cx, cy, d = next_p
        back_d = (d + 4) % 8

    return contour


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
    for _ in range(30):
        mid = (lo + hi) / 2.0
        simplified = rdp_simplify(points, mid)
        if len(simplified) < min_pts:
            hi = mid
        elif len(simplified) > max_pts:
            lo = mid
        else:
            return simplified
        if hi - lo < 0.01:
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
    return [(x / w, y / h) for x, y in points]


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
    mask = np.where(pixel_array < WHITE_THRESHOLD, 1, 0).astype(np.uint8)
    pixel_count = int(np.sum(mask))

    if pixel_count == 0:
        raise ValueError("No non-white pixels found in pixel data")

    # Clean up source array - no longer needed
    del pixel_array
    del npz
    gc.collect()

    # 3. Extract largest component (removes noise before morphology)
    bag_mask = extract_largest_component(mask, width, height)
    del mask
    gc.collect()

    # 4. Multi-pass morphological closing (fill small interior holes)
    bag_mask = morph_close(bag_mask, 3)

    # 5. Flood-fill interior holes (catch large voids)
    bag_mask = fill_interior_holes(bag_mask)

    # 6. Re-extract largest component
    bag_mask = extract_largest_component(bag_mask, width, height)

    # 7. Pad mask by 1 pixel so bags touching border trace correctly
    h_pad, w_pad = height + 2, width + 2
    padded = np.zeros((h_pad, w_pad), dtype=np.uint8)
    padded[1:-1, 1:-1] = bag_mask
    del bag_mask
    gc.collect()

    # 8. Moore-Neighbor contour tracing
    contour = trace_contour(padded, h_pad, w_pad)
    if len(contour) < 3:
        raise ValueError("Could not find contour (< 3 points)")

    # Remove padding offset
    contour = [(x - 1, y - 1) for x, y in contour]

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


def main():
    parser = argparse.ArgumentParser(description="Generate valid region polygon from .npz pixel data")
    parser.add_argument("--npz-path", required=True, help="Absolute path to the .npz file")
    args = parser.parse_args()

    try:
        result = generate_valid_region(args.npz_path)
        # Convert points to list of [x, y] for JSON output
        points_list = [[float(p[0]), float(p[1])] for p in result["points"]]
        output = {
            "status": "ok",
            "points": points_list,
            "width": result["width"],
            "height": result["height"],
            "pixelCount": result["pixelCount"]
        }
        print(json.dumps(output))
    except Exception as e:
        error_output = {
            "status": "error",
            "reason": str(e)
        }
        print(json.dumps(error_output))
        sys.exit(1)


if __name__ == "__main__":
    main()