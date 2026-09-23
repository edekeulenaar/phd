"""Prepare the images for the print build.

sips -Z resamples to fit a box, and it ENLARGES anything smaller than that box.
The pasted equation snippets in Chapters 12 and 14 are a couple of hundred
pixels wide, so a flat `-Z 1800` blew them up sixfold and then JPEG-compressed
the result: that is why the weighting formulas came out huge and smeared.
Never upscale, and keep small line art lossless.
"""
import re, os, subprocess, hashlib, shutil
from PIL import Image

os.chdir(os.path.dirname(os.path.abspath(__file__)))
os.makedirs("img", exist_ok=True)

MAX      = 1800     # only ever a ceiling
SMALL_H  = 120      # at or under this, treat as line art: copy, do not touch
JPEG_Q   = "88"

# Chapter 1's figures are exported from the website, so they carry its cream
# page colour. On paper that reads as a grey panel; flatten it to white.
SITE_PAPER = (250, 247, 242)
TOLERANCE  = 6

def whiten_background(src, dst):
    """Repaint the site's paper colour white. Returns True if it did anything."""
    try:
        im = Image.open(src).convert("RGB")
    except Exception:
        return False
    corner = im.getpixel((2, 2))
    if max(abs(a - b) for a, b in zip(corner, SITE_PAPER)) > TOLERANCE:
        return False
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            c = px[x, y]
            if max(abs(a - b) for a, b in zip(c, SITE_PAPER)) <= TOLERANCE:
                px[x, y] = (255, 255, 255)
    im.save(dst)
    return True

def dims(path):
    out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", path],
                         capture_output=True, text=True).stdout
    w = re.search(r"pixelWidth: (\d+)", out)
    h = re.search(r"pixelHeight: (\d+)", out)
    return (int(w.group(1)), int(h.group(1))) if w and h else (None, None)

b = open("body.md", encoding="utf-8").read()
paths = sorted({p for p in re.findall(r'!\[[^\]]*\]\(((?:[^()]|\([^()]*\))+)\)', b)
                if not p.startswith("http")})

mapping, kept_small, whitened = {}, 0, [0]
for p in paths:
    w, h = dims(p)
    stem = hashlib.md5(p.encode()).hexdigest()[:12]
    ext = os.path.splitext(p)[1].lower()

    # Small line art (equations, inline snippets): copy through untouched, so it
    # stays crisp and keeps its real size for the layout filter to read.
    if h is not None and h <= SMALL_H:
        dst = os.path.abspath(os.path.join("img", stem + (".png" if ext == ".gif" else ext)))
        if not os.path.exists(dst):
            if ext == ".gif":
                subprocess.run(["sips", "-s", "format", "png", p, "--out", dst],
                               capture_output=True)
            else:
                shutil.copy(p, dst)
        kept_small += 1
        mapping[p] = dst
        continue

    dst = os.path.abspath(os.path.join("img", stem + ".jpg"))
    if not os.path.exists(dst):
        source = p
        flat = os.path.abspath(os.path.join("img", stem + "-white.png"))
        if whiten_background(p, flat):
            source, whitened[0] = flat, whitened[0] + 1
        args = ["sips", "-s", "format", "jpeg", "-s", "formatOptions", JPEG_Q]
        if w and h and max(w, h) > MAX:          # a ceiling, never an upscale
            args += ["-Z", str(MAX)]
        subprocess.run(args + [source, "--out", dst], capture_output=True)
    if not os.path.exists(dst):
        dst = os.path.abspath(os.path.join("img", stem + ext))
        shutil.copy(p, dst)
    mapping[p] = dst

def repl(m):
    alt, path = m.group(1), m.group(2)
    return m.group(0) if path.startswith("http") else f"![{alt}]({mapping[path]})"

b2, n = re.subn(r'!\[([^\]]*)\]\(((?:[^()]|\([^()]*\))+)\)', repl, b)
open("body.md", "w", encoding="utf-8").write(b2)
total = sum(os.path.getsize(v) for v in mapping.values())
print(f"  {n} embeds -> {total/1e6:.1f} MB "
      f"({kept_small} small images untouched, {whitened[0]} backgrounds whitened)")
