#!/usr/bin/env python3
"""
Convert .dump.pgm and .tip synthesis files to 8-bit grayscale PNGs
and write them into backend/data/library_images/. This script emits SQL
INSERT statements to help import items into the Postgres DB.

Requires: Pillow
Usage: python import_synthesis_data.py
"""
import sys
import os
from pathlib import Path
try:
    from PIL import Image
except Exception as e:
    print("Pillow is required. Install with: pip install pillow", file=sys.stderr)
    raise

ROOT = Path(__file__).resolve().parents[2]
SYN_ROOT = ROOT / 'data_synthesis' / 'data_synthesis'
OUT_ROOT = ROOT / 'backend' / 'data' / 'library_images' / 'synthesis'
OUT_ROOT.mkdir(parents=True, exist_ok=True)

EXTS = ['.dump.pgm', '.pgm', '.tip']

sql_statements = []

for dirpath, dirnames, filenames in os.walk(SYN_ROOT):
    for fn in filenames:
        lower = fn.lower()
        if any(lower.endswith(ext) for ext in EXTS):
            src = Path(dirpath) / fn
            # target name: replace dots with underscores and add .png
            target_name = fn.replace('.', '_') + '.png'
            out_path = OUT_ROOT / target_name
            try:
                # Pillow can usually open PGM; treat TIP as raw PGM as best-effort
                img = Image.open(src)
                # Convert to 8-bit grayscale
                img8 = img.convert('L')
                img8.save(out_path, format='PNG')
                print(f'Converted {src} -> {out_path}')
                # Emit a sample SQL insert (user should adapt category/subcategory)
                sql = f"-- File: {out_path}\nINSERT INTO items (filename, filepath, category, subcategory, name, upload_session_id, pixel_value) VALUES ('{out_path.name}', '{out_path.name}', 'bags', 'general', '{out_path.stem}', NULL, 32767);"
                sql_statements.append(sql)
            except Exception as e:
                print(f'Failed to convert {src}: {e}', file=sys.stderr)

if sql_statements:
    print('\n-- SQL insert suggestions (adjust as needed):\n')
    for s in sql_statements:
        print(s)

print('Done.')
