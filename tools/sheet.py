"""tools/sheet.py <out.jpg> <cols> <cellw> file1 file2 ...  : labelled contact sheet (label = file stem)."""
import sys, os
from PIL import Image, ImageDraw
out, cols, cw, *files = sys.argv[1:]
cols, cw = int(cols), int(cw)
ims = []
for f in files:
    im = Image.open(f).convert('RGB'); ch = int(cw * im.height / im.width); im = im.resize((cw, ch))
    d = ImageDraw.Draw(im); lab = os.path.splitext(os.path.basename(f))[0]; d.rectangle((0, 0, 8 * len(lab) + 6, 14), fill=(0, 0, 0)); d.text((3, 2), lab, fill=(255, 255, 0)); ims.append(im)
rows = (len(ims) + cols - 1) // cols; ch = ims[0].height
sh = Image.new('RGB', (cw * cols, ch * rows))
for i, im in enumerate(ims): sh.paste(im, ((i % cols) * cw, (i // cols) * ch))
sh.save(out, quality=88); print(out, sh.size)
