#!/usr/bin/env python3
"""Package the browser extension for sharing.

Builds ``extension/app.js`` from ``src/app/`` (see build.py), validates the
manifest and writes ``dist/vybirkovi-tntu-<version>.zip`` containing only the
files the extension needs. The zip can be:

* sent to other people, who unzip it and use "Load unpacked" in
  ``chrome://extensions`` / ``brave://extensions`` (developer mode), or
* uploaded as-is to the Chrome Web Store / Microsoft Edge Add-ons.

Usage:
    python3 package.py           # build + zip
    python3 package.py --icons   # (re)generate extension/icons/*.png first (needs Pillow)
"""
import json
import sys
import zipfile
from pathlib import Path

import build

ROOT = Path(__file__).resolve().parent
EXT = ROOT / "extension"
DIST = ROOT / "dist"
ICON_SIZES = (16, 32, 48, 128)
# Files inside extension/ that the extension itself never loads.
EXCLUDE = {"data.js"}   # data.js is only for the standalone index.html


def make_icons(out_dir=None, sizes=ICON_SIZES, maskable=False):
    """Render the "В" logo icons (TNTU slate background).

    Requires Pillow and a bold font with Cyrillic glyphs (Noto Sans or DejaVu Sans).

    Args:
        out_dir (Path): Target directory; defaults to extension/icons/.
        sizes (tuple[int]): Square sizes in pixels, written as icon-<size>.png.
        maskable (bool): Also write icon-maskable-512.png (full-bleed, logo in the
            80% safe zone) for PWA launchers that crop icons to circles.
    """
    from PIL import Image, ImageDraw, ImageFont

    fonts = ["/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
    font_path = next((f for f in fonts if Path(f).exists()), None)
    if not font_path:
        sys.exit("No bold Cyrillic font found for icons")
    out_dir = Path(out_dir or EXT / "icons")
    out_dir.mkdir(parents=True, exist_ok=True)
    jobs = [(size, False) for size in sizes] + ([(512, True)] if maskable else [])
    for size, full_bleed in jobs:
        scale = 4                                   # draw large, downscale for smooth edges
        s = size * scale
        img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        if full_bleed:
            d.rectangle((0, 0, s, s), fill=(64, 93, 114, 255))
        else:
            d.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.22), fill=(64, 93, 114, 255))   # #405D72
        font = ImageFont.truetype(font_path, int(s * (0.5 if full_bleed else 0.66)))
        box = d.textbbox((0, 0), "В", font=font)
        x = (s - (box[2] - box[0])) / 2 - box[0]
        y = (s - (box[3] - box[1])) / 2 - box[1]
        d.text((x, y), "В", font=font, fill=(255, 255, 255, 255))
        name = "icon-maskable-512.png" if full_bleed else f"icon-{size}.png"
        img.resize((size, size), Image.LANCZOS).save(out_dir / name)
    print(f"Icons written to {out_dir.relative_to(ROOT)} ({', '.join(str(s) for s, _ in jobs)} px)")


def check_manifest():
    """Validate that every file referenced by manifest.json exists.

    Returns:
        dict: The parsed manifest.
    """
    m = json.loads((EXT / "manifest.json").read_text())
    refs = [*m.get("icons", {}).values(), m["background"]["service_worker"]]
    for cs in m.get("content_scripts", []):
        refs += cs.get("js", []) + cs.get("css", [])
    missing = [r for r in refs if not (EXT / r).exists()]
    if missing:
        sys.exit(f"manifest.json references missing files: {missing}")
    return m


def main():
    if "--icons" in sys.argv:
        make_icons()
    (EXT / "app.js").write_text(build.build())
    m = check_manifest()
    DIST.mkdir(exist_ok=True)
    out = DIST / f"vybirkovi-tntu-{m['version']}.zip"
    files = sorted(p for p in EXT.rglob("*") if p.is_file() and p.name not in EXCLUDE and not p.name.startswith("."))
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            z.write(p, p.relative_to(EXT))
    size = out.stat().st_size / 1024
    print(f"{out.relative_to(ROOT)}: {len(files)} files, {size:.0f} KB (version {m['version']})")


if __name__ == "__main__":
    main()
