from pathlib import Path
import sys
sys.path.append(str(Path(__file__).resolve().parent))
from dumpread import ReadDump
from PIL import Image
import numpy as np

def test(path):
    print('TEST', path)
    try:
        high, low, R = ReadDump(str(path), raw=False)
        print('DUMPREAD OK', path.name, high.shape, low.shape, 'high min/max', high.min(), high.max(), 'low min/max', low.min(), low.max(), 'R finite min/max', np.nanmin(R[np.isfinite(R)]), np.nanmax(R[np.isfinite(R)]))
    except Exception as e:
        print('DUMPREAD ERR', type(e).__name__, e)
    try:
        img = Image.open(path)
        arr = np.array(img)
        print('PIL OK', path.name, img.mode, arr.shape, arr.dtype, arr.min(), arr.max())
    except Exception as e:
        print('PIL ERR', type(e).__name__, e)

if __name__ == '__main__':
    base = Path(__file__).resolve().parent
    for p in [base / 'guns' / 'TP02_000000000030.tip', base / 'knife' / 'TP05_202603140056.tip']:
        test(p)
