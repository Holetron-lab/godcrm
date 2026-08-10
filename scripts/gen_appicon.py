#!/usr/bin/env python3
"""
GOD Frame iOS AppIcon generator (ADR-0027 Phase 8.6).

Native pixel art at 64x64 (Tor sprite on hex-accented bg #2D3142),
upscaled NEAREST 16x to 1024x1024 master, then Lanczos-resized to every
filename referenced by AppIcon.appiconset/Contents.json.

Outputs:
  - god_frame/assets/icon/icon_64.png          (native pixel art)
  - god_frame/assets/icon/icon_1024.png        (master, RGB no alpha)
  - god_frame/ios/Runner/Assets.xcassets/AppIcon.appiconset/<size>.png  (all)
"""
from PIL import Image
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPRITE_PATH = os.path.join(ROOT, "docs/16neo/sprites/pes-tor-happy.png")
ICON_DIR = os.path.join(ROOT, "god_frame/assets/icon")
APPICON_DIR = os.path.join(
    ROOT, "god_frame/ios/Runner/Assets.xcassets/AppIcon.appiconset"
)
CONTENTS_JSON = os.path.join(APPICON_DIR, "Contents.json")
os.makedirs(ICON_DIR, exist_ok=True)

# Palette — matches splash where it overlaps; bg per architect brief #2D3142.
P = {
    "bg":         (45, 49, 66),     # #2D3142 — base
    "bg_light":   (66, 71, 92),     # lighter inner panel
    "bg_dark":    (28, 32, 46),     # outer rim
    "accent":     (192, 132, 252),  # #c084fc HLTRN purple
    "accent_dim": (107, 107, 141),  # dim purple
    "gold":       (212, 160, 23),   # #d4a017
    "white":      (245, 245, 250),
    "lightsky":   (168, 218, 220),
}

W, H = 64, 64
img = Image.new("RGB", (W, H), P["bg"])
px = img.load()


def setpx(x, y, c):
    if 0 <= x < W and 0 <= y < H:
        px[x, y] = c


def hline(x1, x2, y, c):
    for x in range(x1, x2 + 1):
        setpx(x, y, c)


def vline(x, y1, y2, c):
    for y in range(y1, y2 + 1):
        setpx(x, y, c)


# ---- Outer rim (dark) ----
for y in range(H):
    for x in range(W):
        if x < 1 or x > W - 2 or y < 1 or y > H - 2:
            setpx(x, y, P["bg_dark"])

# ---- Inner panel (slight lighter rectangle, hex-cornered) ----
# 4px corner cuts to echo hex theme
for y in range(2, H - 2):
    for x in range(2, W - 2):
        # cut the 4 corners diagonally for a hex-stop feel
        d_tl = (2 - x) + (2 - y)
        d_tr = (x - (W - 3)) + (2 - y)
        d_bl = (2 - x) + (y - (H - 3))
        d_br = (x - (W - 3)) + (y - (H - 3))
        if max(d_tl, d_tr, d_bl, d_br) > 1:
            continue
        setpx(x, y, P["bg_light"])

# ---- Hex frame: 4 short purple ticks at the panel corners ----
def hex_corner(cx, cy, dx, dy, color):
    # 3-pixel L mark pointing inward
    setpx(cx, cy, color)
    setpx(cx + dx, cy, color)
    setpx(cx, cy + dy, color)


hex_corner(3, 3, 2, 2, P["accent"])
hex_corner(W - 4, 3, -2, 2, P["accent"])
hex_corner(3, H - 4, 2, -2, P["accent"])
hex_corner(W - 4, H - 4, -2, -2, P["accent"])

# ---- Mid-purple shadow halo behind Tor (soft dot grid) ----
cx, cy = 32, 32
for y in range(cy - 14, cy + 14):
    for x in range(cx - 14, cx + 14):
        if 0 <= x < W and 0 <= y < H:
            dx = x - cx
            dy = y - cy
            r2 = dx * dx + dy * dy
            if 80 < r2 < 170 and (x + y) % 2 == 0:
                setpx(x, y, P["accent_dim"])

# ---- Place Tor sprite cropped to bbox, fitted to ~48x44 ----
tor = Image.open(SPRITE_PATH).convert("RGBA")
bbox = tor.getbbox()  # (4, 0, 60, 52) for happy sprite
tor_crop = tor.crop(bbox)
# Target ~46 wide, preserve aspect
target_w = 46
ratio = target_w / tor_crop.width
target_h = max(1, round(tor_crop.height * ratio))
tor_small = tor_crop.resize((target_w, target_h), Image.NEAREST)
tx = (W - target_w) // 2
ty = (H - target_h) // 2 + 1  # nudge down 1px to balance
tor_px = tor_small.load()
for yy in range(target_h):
    for xx in range(target_w):
        r, g, b, a = tor_px[xx, yy]
        if a > 30:
            setpx(tx + xx, ty + yy, (r, g, b))

# ---- Tiny gold sparkle in top-right (echoes splash HLTRN gold) ----
sx, sy = W - 10, 9
setpx(sx, sy, P["gold"])
setpx(sx - 1, sy, P["accent_dim"])
setpx(sx + 1, sy, P["accent_dim"])
setpx(sx, sy - 1, P["accent_dim"])
setpx(sx, sy + 1, P["accent_dim"])

# ---- Save native + master ----
native_path = os.path.join(ICON_DIR, "icon_64.png")
img.save(native_path)
print(f"native saved:  {native_path}  size={img.size}")

master = img.resize((1024, 1024), Image.NEAREST)
master_path = os.path.join(ICON_DIR, "icon_1024.png")
master.save(master_path)
print(f"master saved:  {master_path}  size={master.size}")


# ---- Resize master into every filename referenced by Contents.json ----
with open(CONTENTS_JSON) as f:
    contents = json.load(f)

filenames = sorted({entry["filename"] for entry in contents["images"]})
print(f"\nWriting {len(filenames)} icon files into {APPICON_DIR}\n")

for name in filenames:
    m = re.match(r"^(\d+)\.png$", name)
    if not m:
        print(f"  skip: {name} (cannot parse size)")
        continue
    size = int(m.group(1))
    if size == 1024:
        out = master  # already 1024 NEAREST upscale — pixel-perfect
    else:
        # Lanczos for downscale (smooth at small sizes — needed at 16/20/29)
        out = master.resize((size, size), Image.LANCZOS)
    # Force RGB (no alpha — App Store rejects icons with alpha channel)
    if out.mode != "RGB":
        out = out.convert("RGB")
    out_path = os.path.join(APPICON_DIR, name)
    out.save(out_path)
    print(f"  {name:>10}  {size}x{size}")

print(f"\n✅ {len(filenames)} icon files written.")
