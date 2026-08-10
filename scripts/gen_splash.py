#!/usr/bin/env python3
"""
GOD Frame iOS splash generator (ADR-0027).

Native pixel art at 240x240 in 16Neo palette, Tor sprite from docs/16neo/sprites.
Outputs:
  - splash_native.png  240x240 (true pixel art)
  - splash.png         1920x1920 (8x nearest upscale, source for flutter_native_splash)
"""
from PIL import Image
import os, random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPRITE_DIR = os.path.join(ROOT, "docs/16neo/sprites")
OUT_DIR = os.path.join(ROOT, "god_frame/assets/splash")
os.makedirs(OUT_DIR, exist_ok=True)

# 16Neo palette
P = {
    "bg":         (26, 26, 46),     # #1a1a2e deep night
    "bg2":        (45, 45, 68),     # #2d2d44 dark wall
    "shadow":     (74, 74, 104),    # #4a4a68
    "midpurple":  (107, 107, 141),  # #6b6b8d
    "lightgrey":  (152, 152, 181),  # #9898b5
    "pale":       (200, 200, 216),  # #c8c8d8
    "white":      (245, 245, 250),  # #f5f5fa
    "darkblue":   (29, 53, 87),     # #1d3557
    "ocean":      (69, 123, 157),   # #457b9d
    "sky":        (114, 180, 212),  # #72b4d4
    "lightsky":   (168, 218, 220),  # #a8dadc
    "darkforest": (27, 67, 50),     # #1b4332
    "forest":     (45, 106, 79),    # #2d6a4f
    "fresh":      (82, 183, 136),   # #52b788
    "lightgreen": (149, 213, 178),  # #95d5b2
    "red":        (192, 57, 43),    # #c0392b
    "lightred":   (231, 76, 60),    # #e74c3c
    "gold":       (212, 160, 23),   # #d4a017
    "amber":      (243, 156, 18),   # #f39c12
    "orange":     (230, 126, 34),   # #e67e22
    "purple":     (192, 132, 252),  # #c084fc
    "pink":       (255, 107, 157),  # #ff6b9d
    "yellow":     (251, 191, 36),   # #fbbf24
}

W, H = 240, 240
img = Image.new("RGB", (W, H), P["bg"])
px = img.load()


def setpx(x, y, c):
    if 0 <= x < W and 0 <= y < H:
        px[x, y] = c


def hline(x1, x2, y, c):
    for x in range(x1, x2 + 1):
        setpx(x, y, c)


# ---------- Pointy-top hex helper (clean pixel-art) ----------
def pointy_hex(cx, cy, hw, body_h, color):
    """
    Pointy-top hex with half-width hw (max), and body_h rows at full width.
    Tapering uses 2-pixel-per-row steps for clean diagonal look.
    Returns the list of (x_left, x_right, y) scanlines used.
    """
    rows = []
    # Top tapering: hw_step from 1, 3, 5, ..., (2k-1) until reaches hw
    # Each row: half-width = 1 + 2*i (clamped to hw)
    cur = 1
    top_taper = []
    while cur < hw:
        top_taper.append(cur)
        cur += 2
    # Add the row that hits exactly hw if cur != hw (clamp)
    if not top_taper or top_taper[-1] != hw:
        # Need to land on hw
        pass
    n_taper = len(top_taper)

    # Top tapering rows
    for i, half in enumerate(top_taper):
        y = cy - body_h // 2 - (n_taper - i)
        rows.append((cx - half, cx + half, y))
    # Middle body rows at full hw
    for i in range(body_h):
        y = cy - body_h // 2 + i
        rows.append((cx - hw, cx + hw, y))
    # Bottom tapering (mirror)
    for i, half in enumerate(reversed(top_taper)):
        y = cy + body_h // 2 + (i + 1)
        rows.append((cx - half, cx + half, y))

    if color is not None:
        for x_l, x_r, y in rows:
            hline(x_l, x_r, y, color)
    return rows


def hex_outline(rows, color, thickness=1):
    """Draw outline along the perimeter rows of a hex."""
    if not rows:
        return
    # Top edge of first row
    x_l, x_r, y = rows[0]
    hline(x_l, x_r, y, color)
    # Bottom edge of last row
    x_l, x_r, y = rows[-1]
    hline(x_l, x_r, y, color)
    # Left/right edges
    for i, (x_l, x_r, y) in enumerate(rows):
        # Left edge segment
        if i == 0:
            continue
        prev_l, prev_r, prev_y = rows[i - 1]
        # Connect prev_l..x_l on this row's y if shrinking, on prev's y if growing
        if x_l < prev_l:
            # diagonal expanding left
            hline(x_l, prev_l - 1, y, color)
        elif x_l > prev_l:
            hline(prev_l, x_l - 1, prev_y, color)
        else:
            setpx(x_l, y, color)
        # Right edge
        if x_r > prev_r:
            hline(prev_r + 1, x_r, y, color)
        elif x_r < prev_r:
            hline(x_r + 1, prev_r, prev_y, color)
        else:
            setpx(x_r, y, color)


# ---------- Background: starfield ----------
random.seed(7)
star_pos = []
for _ in range(80):
    x = random.randint(0, W - 1)
    y = random.randint(0, H - 1)
    star_pos.append((x, y))
for x, y in star_pos:
    setpx(x, y, P["midpurple"])
for x, y in random.sample(star_pos, 16):
    setpx(x, y, P["lightsky"])
# A few sparkle stars (3px cross)
sparkles = random.sample(star_pos, 4)
for x, y in sparkles:
    setpx(x, y, P["white"])
    setpx(x - 1, y, P["lightsky"])
    setpx(x + 1, y, P["lightsky"])
    setpx(x, y - 1, P["lightsky"])
    setpx(x, y + 1, P["lightsky"])


# ---------- Phone hex case ----------
case_cx, case_cy = 120, 130
# Outer dark frame (large hex)
outer = pointy_hex(case_cx, case_cy, hw=58, body_h=64, color=P["bg2"])
# Frame highlight (top-left ridge)
for x_l, x_r, y in outer[:30]:
    if y < case_cy - 24:
        hline(x_l, min(x_r, x_l + 2), y, P["midpurple"])
# Inner case (smaller hex)
inner = pointy_hex(case_cx, case_cy, hw=53, body_h=58, color=P["shadow"])
# Inner-inner body (yet smaller, as raised plate)
plate = pointy_hex(case_cx, case_cy, hw=49, body_h=54, color=P["midpurple"])

# Subtle plate gradient: top half lighter
for x_l, x_r, y in plate:
    if y < case_cy - 12:
        hline(x_l, x_r, y, P["lightgrey"])
    elif y > case_cy + 18:
        hline(x_l, x_r, y, P["shadow"])

# Outer outline (very dark)
hex_outline(outer, P["bg"])


# ---------- LCD hex screen (upper half of plate) ----------
lcd_cx, lcd_cy = case_cx, case_cy - 18
lcd_outer = pointy_hex(lcd_cx, lcd_cy, hw=32, body_h=20, color=P["darkforest"])
# Inner LCD glow
lcd_inner = pointy_hex(lcd_cx, lcd_cy, hw=29, body_h=18, color=P["forest"])
# Brighter band at top
for x_l, x_r, y in lcd_inner:
    if y < lcd_cy - 6:
        hline(x_l, x_r, y, P["fresh"])
    elif y < lcd_cy - 2:
        # blend
        for x in range(x_l, x_r + 1):
            if (x + y) % 2 == 0:
                setpx(x, y, P["fresh"])

# LCD bezel outline
hex_outline(lcd_outer, P["bg"])

# Scanline effect inside LCD (every 3rd row darker)
for x_l, x_r, y in lcd_inner:
    if (y - lcd_cy) % 3 == 0:
        for x in range(x_l, x_r + 1):
            r, g, b = px[x, y]
            px[x, y] = (max(0, r - 12), max(0, g - 12), max(0, b - 12))


# ---------- Place Tor sprite inside LCD ----------
tor_path = os.path.join(SPRITE_DIR, "pes-tor-happy.png")
tor = Image.open(tor_path).convert("RGBA")
# Tor is 64x64. The sprite has lots of padding; resize to fit LCD interior comfortably.
tor_size = 36
tor_small = tor.resize((tor_size, tor_size), Image.NEAREST)
tx = lcd_cx - tor_size // 2
ty = lcd_cy - tor_size // 2 + 1
tor_px = tor_small.load()
for yy in range(tor_size):
    for xx in range(tor_size):
        r, g, b, a = tor_px[xx, yy]
        if a > 30:
            setpx(tx + xx, ty + yy, (r, g, b))


# ---------- 3 hex buttons under LCD ----------
btn_y = case_cy + 18
btn_spacing = 28
btn_colors = [P["red"], P["amber"], P["fresh"]]
btn_hilights = [P["lightred"], P["yellow"], P["lightgreen"]]
for i, (color, hl) in enumerate(zip(btn_colors, btn_hilights)):
    bx = case_cx - btn_spacing + i * btn_spacing
    # Bezel (dark)
    pointy_hex(bx, btn_y, hw=10, body_h=6, color=P["bg"])
    # Button face
    btn_rows = pointy_hex(bx, btn_y, hw=8, body_h=5, color=color)
    # Highlight on top edge
    for x_l, x_r, y in btn_rows[:3]:
        hline(x_l + 1, x_r - 1, y, hl)
    # Tiny shine pixel
    setpx(bx - 2, btn_y - 3, P["white"])


# ---------- Antenna nub at top of case ----------
nub_x = case_cx + 38
nub_top_y = case_cy - 70
hline(nub_x - 1, nub_x + 1, nub_top_y, P["bg2"])
hline(nub_x - 1, nub_x + 1, nub_top_y + 1, P["bg2"])
setpx(nub_x, nub_top_y - 1, P["red"])  # antenna tip light


# ---------- HLTRN logo + tagline ----------
FONT = {
    "H": ["X...X", "X...X", "X...X", "XXXXX", "X...X", "X...X", "X...X"],
    "L": ["X....", "X....", "X....", "X....", "X....", "X....", "XXXXX"],
    "T": ["XXXXX", "..X..", "..X..", "..X..", "..X..", "..X..", "..X.."],
    "R": ["XXXX.", "X...X", "X...X", "XXXX.", "X.X..", "X..X.", "X...X"],
    "N": ["X...X", "XX..X", "XX..X", "X.X.X", "X..XX", "X..XX", "X...X"],
    "G": ["XXXXX", "X....", "X....", "X.XXX", "X...X", "X...X", "XXXXX"],
    "O": [".XXX.", "X...X", "X...X", "X...X", "X...X", "X...X", ".XXX."],
    "D": ["XXXX.", "X...X", "X...X", "X...X", "X...X", "X...X", "XXXX."],
    "F": ["XXXXX", "X....", "X....", "XXXX.", "X....", "X....", "X...."],
    "A": [".XXX.", "X...X", "X...X", "XXXXX", "X...X", "X...X", "X...X"],
    "M": ["X...X", "XX.XX", "X.X.X", "X.X.X", "X...X", "X...X", "X...X"],
    "E": ["XXXXX", "X....", "X....", "XXXX.", "X....", "X....", "XXXXX"],
    " ": ["....."] * 7,
}


def draw_text(text, x0, y0, color, scale=1):
    cur_x = x0
    for ch in text:
        glyph = FONT.get(ch.upper(), FONT[" "])
        for gy, row in enumerate(glyph):
            for gx, c in enumerate(row):
                if c == "X":
                    for sy in range(scale):
                        for sx in range(scale):
                            setpx(cur_x + gx * scale + sx, y0 + gy * scale + sy, color)
        cur_x += (len(glyph[0]) + 1) * scale


def text_width(text, scale=1):
    return ((5 + 1) * len(text) - 1) * scale


# HLTRN top — gold, scale 2 (big)
hltrn = "HLTRN"
tw = text_width(hltrn, scale=2)
draw_text(hltrn, (W - tw) // 2, 16, P["gold"], scale=2)
# Underline
ul_y = 16 + 7 * 2 + 2
hline((W - tw) // 2, (W - tw) // 2 + tw - 1, ul_y, P["amber"])

# GOD FRAME tagline — bottom
tag = "GOD FRAME"
tw2 = text_width(tag, scale=1)
draw_text(tag, (W - tw2) // 2, 218, P["lightsky"], scale=1)

# Decorative dots on either side of tagline
dots_y = 218 + 3
for x in range(20, (W - tw2) // 2 - 4, 6):
    setpx(x, dots_y, P["sky"])
for x in range((W + tw2) // 2 + 4, W - 20, 6):
    setpx(x, dots_y, P["sky"])


# ---------- Save outputs ----------
native_path = os.path.join(OUT_DIR, "splash_native.png")
img.save(native_path)
print(f"native saved: {native_path}  size={img.size}")

big = img.resize((W * 8, H * 8), Image.NEAREST)
big_path = os.path.join(OUT_DIR, "splash.png")
big.save(big_path)
print(f"upscaled saved: {big_path}  size={big.size}")

# ---------- iOS LaunchImage assets (Runner/Assets.xcassets/LaunchImage.imageset) ----------
IOS_LAUNCH_DIR = os.path.join(ROOT, "god_frame/ios/Runner/Assets.xcassets/LaunchImage.imageset")
os.makedirs(IOS_LAUNCH_DIR, exist_ok=True)

# 1x=320, 2x=640, 3x=960 — nearest upscale preserves pixel-art crispness
for scale, suffix in [(320, ""), (640, "@2x"), (960, "@3x")]:
    out = img.resize((scale, scale), Image.NEAREST)
    out_path = os.path.join(IOS_LAUNCH_DIR, f"LaunchImage{suffix}.png")
    out.save(out_path)
    print(f"ios launch: {out_path}  size={out.size}")
