from pathlib import Path
from PIL import Image
import numpy as np

base = Path(__file__).resolve().parent
out = base / 'extracted_synthesis_tip'
out.mkdir(parents=True, exist_ok=True)

for kind in ['guns', 'knife']:
    folder = base / kind
    if not folder.exists():
        print('missing folder', kind)
        continue
    tip_files = sorted(folder.glob('*.tip'))
    print('PROCESS', kind, 'count', len(tip_files))
    for p in tip_files:
        img = Image.open(p)
        arr = np.array(img)
        print('  file', p.name, 'mode', img.mode, 'shape', arr.shape, 'dtype', arr.dtype, 'min', arr.min(), 'max', arr.max())
        np.save(out / (p.stem + f'_{kind}_tip.npy'), arr)
        arr16 = np.clip(arr, 0, 65535).astype(np.uint16)
        arr8 = (arr16 >> 8).astype(np.uint8)
        Image.fromarray(arr8, mode='L').save(out / (p.stem + f'_{kind}_tip.png'))
print('saved outputs to', out)
