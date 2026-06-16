"""Fix the width/height in the database for threat items by reading actual image dimensions."""

import urllib.request
import json
from pathlib import Path
from PIL import Image
import psycopg2

DB_CONFIG = {
    "user": "postgres",
    "host": "localhost",
    "database": "xray_db",
    "password": "SaiKiran2166",
    "port": 5432,
}

def main():
    lib_dir = Path(__file__).resolve().parent.parent / "backend" / "data" / "library_images"
    
    # Fetch all items from API
    resp = urllib.request.urlopen("http://localhost:8080/api/items/categorized")
    data = json.loads(resp.read())
    
    # Collect items where stored dimensions don't match actual
    updates = []
    for cat, subcats in data["categorized"].items():
        for sub, items in subcats.items():
            for item in items:
                fp = lib_dir / item["filepath"]
                if not fp.exists():
                    print(f"SKIP (missing file): {item['filename']}")
                    continue
                img = Image.open(fp)
                actual_w, actual_h = img.size
                stored_w = item["width"]
                stored_h = item["height"]
                if stored_w != actual_w or stored_h != actual_h:
                    updates.append((item["id"], actual_w, actual_h, item["filename"]))
    
    if not updates:
        print("All items already have correct dimensions.")
        return
    
    print(f"\nFound {len(updates)} items with wrong dimensions:")
    for item_id, w, h, name in updates:
        print(f"  {name:45s} -> {w}x{h}")
    
    # Connect to DB and fix
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    for item_id, w, h, name in updates:
        cur.execute("UPDATE items SET width = %s, height = %s WHERE id = %s", (w, h, item_id))
        print(f"  UPDATED {name:45s} -> width={w}, height={h}")
    conn.commit()
    cur.close()
    conn.close()
    print(f"\n✅ Updated {len(updates)} items successfully.")

if __name__ == "__main__":
    main()