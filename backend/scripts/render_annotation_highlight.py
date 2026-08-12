"""
Render an x-ray composite image from a FULL combination annotation and highlight
each THREAT's segmentation mask (filled red) and its bounding box / boundary.

This is a helper to demonstrate how the saved `segmentationMask` (normalized
[0,1] polygon over each threat's box) is used. It reads the same annotation
structure stored by the app (backend/data/storage/savedLayouts_*.json), loads the
actual item images from library_images, composites them (center / size / rotation /
layer), and then overlays the threat masks and boundaries in colour.

Input annotation (a "full combination annotation"). The script accepts:
  * the whole saved-layout record   { ..., "layout_json": { "objects": {...} } }
  * or the layout_json block        { "objects": { "bag","threats","non-threats" } }
  * or the objects block directly   { "bag": {...}, "threats": [...], "non-threats": [...] }

Each object in "objects" uses the app's saved schema:
  {
    "id", "subcategory", "filepath",            // filepath is the image in library_images
    "center": { "x", "y" },
    "size":   { "width", "height" },
    "rotation": <degrees>,
    "layer": <int>,
    "segmentationMask": [ { "x", "y" }, ... ]   // threats only, normalized [0,1] over the box
  }

Usage:
    python render_annotation_highlight.py path/to/annotation.json [--out out.png] [--no-show]
"""

import argparse
import json
import math
import os
import sys

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(BACKEND_DIR, "data")
LIBRARY_IMAGES_DIR = os.path.join(DATA_DIR, "library_images")

CANVAS_W, CANVAS_H = 800, 600  # matches renderSceneAsync() default


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def rot2d(angle_deg):
    """2x2 counter-clockwise rotation matrix (degrees)."""
    a = math.radians(angle_deg)
    return np.array([[math.cos(a), -math.sin(a)],
                     [math.sin(a),  math.cos(a)]])


def load_object_image(obj, lib_dir=LIBRARY_IMAGES_DIR):
    """Load an object's 16-bit grayscale PNG by its `filepath`.

    Returns (img_float01, path, filename) where img_float01 is 0..1 (1 = air/empty).
    """
    fp = obj.get("filepath")
    if not fp:
        return None, None, None
    path = os.path.join(lib_dir, os.path.basename(fp))
    alt = os.path.join(LIBRARY_IMAGES_DIR, os.path.basename(fp))
    if not os.path.exists(path):
        path = alt
    if not os.path.exists(path):
        print(f"  [warn] image not found: {fp}", file=sys.stderr)
        return None, None, None
    # Read with UNCHANGED so 16-bit PNGs keep full precision.
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        print(f"  [warn] could not read image: {path}", file=sys.stderr)
        return None, None, None
    if img.ndim == 3:
        img = img[:, :, 0]
    img01 = img.astype(np.float32) / 65535.0
    return img01, path, fp


def warp_object(img01, obj):
    """Warp an object image onto the canvas according to its transform.

    Builds the affine map used by the app: scale source to size.width x size.height,
    rotate about the object center by `rotation`, then place centred at center.
    Returns float32 2D array (HxW) of the warped transmission (0..1).
    """
    src_h, src_w = img01.shape[:2]
    obj_w = float(obj["size"]["width"])
    obj_h = float(obj["size"]["height"])
    cx = float(obj["center"]["x"])
    cy = float(obj["center"]["y"])
    angle = float(obj.get("rotation", 0))

    sx = obj_w / src_w
    sy = obj_h / src_h
    R = rot2d(angle)

    # dst = center + R @ (scale * (src - src_center))
    src_center = np.array([(src_w - 1) / 2.0, (src_h - 1) / 2.0])
    S = np.diag([sx, sy])
    A = R @ S  # 2x2
    t = np.array([cx, cy]) - A @ src_center

    M = np.array([
        [A[0, 0], A[0, 1], t[0]],
        [A[1, 0], A[1, 1], t[1]],
    ], dtype=np.float64)

    warped = cv2.warpAffine(img01, M, (CANVAS_W, CANVAS_H),
                            flags=cv2.INTER_LINEAR, borderValue=1.0)
    return warped.astype(np.float32)


# ---------------------------------------------------------------------------
# Annotation parsing
# ---------------------------------------------------------------------------
def extract_objects(annotation):
    """Return the `objects` block from any of the accepted annotation shapes."""
    if isinstance(annotation, dict):
        if "objects" in annotation:
            return annotation["objects"]
        if "layout_json" in annotation and isinstance(annotation["layout_json"], dict):
            lj = annotation["layout_json"]
            if "objects" in lj:
                return lj["objects"]
    raise ValueError(
        "Could not find an 'objects' block. Expected a saved-layout record, "
        "a layout_json block, or an objects block."
    )


def collect_flat_objects(objects):
    """Flatten {bag, threats, non-threats} into one list with a `kind` tag."""
    flat = []
    bag = objects.get("bag")
    if bag:
        flat.append({**bag, "kind": "bag"})
    for t in objects.get("threats") or []:
        flat.append({**t, "kind": "threat"})
    for n in objects.get("non-threats") or []:
        flat.append({**n, "kind": "non-threat"})
    flat.sort(key=lambda o: o.get("layer", 0))
    return flat


# ---------------------------------------------------------------------------
# Mask reconstruction (the point of this demo: how segmentationMask is used)
# ---------------------------------------------------------------------------
def mask_points_to_image(mask, obj):
    """Convert normalized [0,1] mask points to a pixel polygon in canvas coords.

    normalized (nx, ny) over the threat box -> box-local (-0.5..0.5)*size
    -> rotate around center -> translate to center. Same transform as the paste.
    """
    cx = float(obj["center"]["x"])
    cy = float(obj["center"]["y"])
    box_w = float(obj["size"]["width"])
    box_h = float(obj["size"]["height"])
    angle = float(obj.get("rotation", 0))

    pts = np.array([[p["x"], p["y"]] for p in mask], dtype=np.float64)
    local = (pts - 0.5) * np.array([box_w, box_h])
    world = local @ rot2d(angle).T + np.array([cx, cy])
    return np.round(world).astype(np.int32).reshape((-1, 1, 2))


def box_corners(obj):
    """Return the 4 rotated corners of the threat's bounding box."""
    cx = float(obj["center"]["x"])
    cy = float(obj["center"]["y"])
    box_w = float(obj["size"]["width"])
    box_h = float(obj["size"]["height"])
    angle = float(obj.get("rotation", 0))
    half = np.array([box_w, box_h]) / 2.0
    local = np.array([[-1, -1], [1, -1], [1, 1], [-1, 1]], dtype=np.float64) * half
    world = local @ rot2d(angle).T + np.array([cx, cy])
    return np.round(world).astype(np.int32)


# ---------------------------------------------------------------------------
# Compositing
# ---------------------------------------------------------------------------
def composite(flat_objects):
    """Composite objects into an 800x600 grayscale x-ray scene.

    Uses Beer-Lambert style transmission: intensity = product of each object's
    pixel transmission, then mapped back to 8-bit. Empty air = 1.0 (white).
    """
    trans = np.ones((CANVAS_H, CANVAS_W), dtype=np.float32)
    for obj in flat_objects:
        img01, path, fp = load_object_image(obj)
        if img01 is None:
            continue
        warped = warp_object(img01, obj)
        trans *= np.clip(warped, 0.0, 1.0)

    g = np.clip(trans * 255.0, 0, 255).astype(np.uint8)
    return cv2.cvtColor(g, cv2.COLOR_GRAY2BGR)


# ---------------------------------------------------------------------------
# Highlighting
# ---------------------------------------------------------------------------
# One distinct colour per threat, in threat order (max 4 threats is enough).
# BGR tuples.
THREAT_COLORS = [
    (0, 0, 255),    # 1st threat  -> red
    (0, 255, 255),  # 2nd threat  -> yellow
    (255, 0, 0),    # 3rd threat  -> blue
    (0, 255, 0),    # 4th threat  -> green
]


def highlight_threats(canvas, flat_objects):
    """Fill each threat's segmentationMask and draw its box, one colour per threat."""
    drawn = []
    threat_idx = 0  # only threats count toward the colour index
    for obj in flat_objects:
        if obj.get("kind") != "threat":
            continue
        mask = obj.get("segmentationMask")
        if not mask or len(mask) < 3:
            print(f"  [warn] threat {obj.get('id')} has no usable segmentationMask")
            continue

        color = THREAT_COLORS[threat_idx % len(THREAT_COLORS)]
        threat_idx += 1

        poly = mask_points_to_image(mask, obj)
        corners = box_corners(obj)

        # 1) fill the mask in the threat's colour (semi-transparent so the threat
        #    underneath stays visible)
        overlay = canvas.copy()
        cv2.fillPoly(overlay, [poly], color)
        cv2.addWeighted(overlay, 0.6, canvas, 0.4, 0, canvas)

        # 2) crisp mask boundary on top
        cv2.polylines(canvas, [poly], isClosed=True, color=color, thickness=2)

        # 3) bounding box (same colour)
        cv2.polylines(canvas, [corners], isClosed=True, color=color, thickness=2)

        cx = int(round(float(obj["center"]["x"])))
        cy = int(round(float(obj["center"]["y"])))
        label = obj.get("subcategory") or obj.get("id") or "threat"
        cv2.putText(canvas, str(label), (cx - 60, cy - 50),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA)

        drawn.append({
            "id": obj.get("id"),
            "subcategory": obj.get("subcategory"),
            "mask_points": len(mask),
            "color": "BGR" + str(color),
        })
    return drawn


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Render a combination from a full annotation and highlight threat masks/boxes")
    parser.add_argument("annotation", help="Path to the full combination annotation JSON")
    parser.add_argument("--out", default=None, help="Output PNG path (default: <annotation>.rendered.png)")
    parser.add_argument("--images", default=LIBRARY_IMAGES_DIR, help="Directory containing item PNGs")
    parser.add_argument("--no-show", dest="show", action="store_false",
                        help="Only write the PNG, don't open a window")
    parser.set_defaults(show=True)
    args = parser.parse_args()

    if not os.path.exists(args.annotation):
        raise SystemExit(f"Annotation not found: {args.annotation}")

    with open(args.annotation, encoding="utf-8") as f:
        annotation = json.load(f)

    objects = extract_objects(annotation)
    flat = collect_flat_objects(objects)
    if not flat:
        raise SystemExit("The annotation contains no bag/threats/non-threats.")

    print("Objects in annotation:",
          [(o.get('kind'), o.get('id')) for o in flat])

    canvas = composite(flat)
    drawn = highlight_threats(canvas, flat)

    if not drawn:
        print("[warn] No threats with segmentationMask were found to highlight.")

    out = args.out or (os.path.splitext(args.annotation)[0] + ".rendered.png")
    cv2.imwrite(out, canvas)
    print(f"Wrote rendered+highlighted image: {out}")
    if drawn:
        print("Highlighted threats:")
        for d in drawn:
            print(f"  - {d.get('id')} ({d.get('subcategory')}): "
                  f"{d['mask_points']} mask points, colour {d.get('color')}")

    if args.show:
        try:
            cv2.imshow("Combination with masks highlighted", canvas)
            print("Press any key in the image window to close.")
            cv2.waitKey(0)
            cv2.destroyAllWindows()
        except cv2.error:
            print("No interactive display available; image saved only.")


if __name__ == "__main__":
    main()
