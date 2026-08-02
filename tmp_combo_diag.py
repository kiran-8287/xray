import json
from collections import Counter

LOG_PATH = r'c:\Users\saikiran\Desktop\xray\backend\data\monitoring.log'
SAVED_LAYOUTS_PATH = r'c:\Users\saikiran\Desktop\xray\backend\data\savedLayouts.json'
ITEMS_PATH = r'c:\Users\saikiran\Desktop\xray\backend\data\items.json'

print("=" * 70)
print("RECENT NETWORK CALLS: routes + status + content_length (tail 120 events)")
print("=" * 70)
recent = []
with open(LOG_PATH, "r", encoding="utf-8", errors="replace") as fh:
    lines = fh.readlines()
parsed = []
for l in lines:
    s = l.strip()
    if not s: continue
    try:
        parsed.append(json.loads(s))
    except:
        pass

finished = [e for e in parsed if e.get('type') == 'request_finished']
print(f"Total finished events: {len(finished)}")

# Focus on errors / large content_length / relevant routes
errors = [e for e in finished if e.get('status') and e['status'] >= 400]
large = [e for e in finished if e.get('content_length', 0) >= 1_000_000]
combo_routes = [e for e in finished if 'save' in str(e.get('path','')).lower() or 'layout' in str(e.get('path','')).lower() or 'batch' in str(e.get('path','')).lower()]

if errors:
    print(f"\nERROR STATUS events ({len(errors)}):")
    for e in errors[-15:]:
        print(f"  {str(e.get('status')):>5s} {str(e.get('method')):6s} {str(e.get('path'))[:60]} cl={e.get('content_length')} dur_ms={e.get('duration_ms')}")

print(f"\nLARGE RESPONSE events >= 1MB ({len(large)}):")
for e in large[-15:]:
    print(f"  {str(e.get('status')):>5s} {str(e.get('method')):6s} {str(e.get('path'))[:60]} cl={e.get('content_length',0)//1024} KB dur_ms={e.get('duration_ms')}")

print(f"\nSAVED-LAYOUTS / BATCH related events ({len(combo_routes)}):")
for e in combo_routes[-20:]:
    print(f"  {str(e.get('status', '?'))} {str(e.get('method','')):6s} {str(e.get('path',''))[:60]} cl={e.get('content_length')} dur_ms={e.get('duration_ms')}")

print("\n" + "=" * 70)
print("PERSISTED DATA SIZES")
print("=" * 70)
import os
for p in [SAVED_LAYOUTS_PATH, ITEMS_PATH]:
    if os.path.exists(p):
        sz = os.path.getsize(p)
        with open(p, "r", encoding="utf-8", errors="replace") as fh:
            try:
                data = json.load(fh)
                n = len(data) if isinstance(data, (list, dict)) else '?'
                sz_item = (sz / n) if isinstance(n,int) and n > 0 else 0
                print(f"  {os.path.basename(p):35s}: {sz/1024/1024:6.1f} MB, {n:>8s} entries, avg {sz_item/1024:6.1f} KB/entry")
            except Exception as ex:
                print(f"  {os.path.basename(p):35s}: {sz/1024/1024:6.1f} MB, JSON parse failed: {ex}")
    else:
        print(f"  {os.path.basename(p)}: MISSING")
