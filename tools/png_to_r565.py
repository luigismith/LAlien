#!/usr/bin/env python3
"""
png_to_r565.py — Batch-convert PNG sprite sheets to raw RGB565 format
for the Lalien Companion embedded firmware.

Reads RGBA PNGs from sd_card_template/sprites/ and writes .r565 files
alongside them. Transparent pixels become magenta (0xF81F in RGB565).

RGB565 format: 16-bit little-endian, RRRRRGGGGGGBBBBB
  R = bits 15..11 (5 bits)
  G = bits 10..5  (6 bits)
  B = bits 4..0   (5 bits)

Usage:
    python tools/png_to_r565.py [--sprites-dir path/to/sprites]

Author: Claude Code | Date: 2026-04-13
"""

import os
import sys
import struct
import argparse
import json
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow is required. Install with: pip install Pillow")
    sys.exit(1)


# Magenta key for transparent pixels (R=31, G=0, B=31 in RGB565)
TRANSPARENT_KEY = 0xF81F


def rgba_to_rgb565(r: int, g: int, b: int, a: int) -> int:
    """Convert an RGBA pixel to RGB565 (little-endian uint16).
    Transparent pixels (a < 128) become magenta 0xF81F."""
    if a < 128:
        return TRANSPARENT_KEY
    r5 = (r >> 3) & 0x1F
    g6 = (g >> 2) & 0x3F
    b5 = (b >> 3) & 0x1F
    return (r5 << 11) | (g6 << 5) | b5


def convert_png_to_r565(png_path: str, r565_path: str) -> tuple:
    """Convert a single PNG file to raw RGB565 format.
    Returns (width, height) on success, None on failure."""
    try:
        img = Image.open(png_path).convert("RGBA")
    except Exception as e:
        print(f"  ERROR reading {png_path}: {e}")
        return None

    width, height = img.size
    pixels = img.load()

    # Build raw RGB565 buffer
    buf = bytearray(width * height * 2)
    idx = 0
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            val = rgba_to_rgb565(r, g, b, a)
            struct.pack_into("<H", buf, idx, val)
            idx += 2

    # Write output
    os.makedirs(os.path.dirname(r565_path), exist_ok=True)
    with open(r565_path, "wb") as f:
        f.write(buf)

    return (width, height)


def process_sprites_dir(sprites_dir: str) -> dict:
    """Walk the sprites directory and convert all PNGs to .r565 files.
    Returns stats dict."""
    stats = {"converted": 0, "skipped": 0, "errors": 0, "bytes_total": 0}

    sprites_path = Path(sprites_dir)
    if not sprites_path.exists():
        print(f"ERROR: Sprites directory not found: {sprites_dir}")
        return stats

    # Walk all stage directories
    for stage_dir in sorted(sprites_path.iterdir()):
        if not stage_dir.is_dir() or not stage_dir.name.startswith("stage_"):
            continue

        print(f"\n=== {stage_dir.name} ===")

        for variant_dir in sorted(stage_dir.iterdir()):
            if not variant_dir.is_dir() or not variant_dir.name.startswith("variant_"):
                continue

            # Check for meta.json
            meta_path = variant_dir / "meta.json"
            if not meta_path.exists():
                print(f"  WARN: No meta.json in {variant_dir}, skipping")
                continue

            # Read meta.json to know which PNGs to convert
            try:
                with open(meta_path, "r") as f:
                    meta = json.load(f)
            except Exception as e:
                print(f"  ERROR reading meta.json in {variant_dir}: {e}")
                stats["errors"] += 1
                continue

            animations = meta.get("animations", {})
            for anim_name, anim_info in animations.items():
                png_file = anim_info.get("file", f"{anim_name}.png")
                png_path = variant_dir / png_file
                r565_path = variant_dir / (Path(png_file).stem + ".r565")

                if not png_path.exists():
                    print(f"  WARN: {png_path} not found, skipping")
                    stats["errors"] += 1
                    continue

                # Skip if .r565 is newer than .png
                if r565_path.exists():
                    png_mtime = os.path.getmtime(png_path)
                    r565_mtime = os.path.getmtime(r565_path)
                    if r565_mtime >= png_mtime:
                        stats["skipped"] += 1
                        continue

                result = convert_png_to_r565(str(png_path), str(r565_path))
                if result:
                    w, h = result
                    file_size = os.path.getsize(r565_path)
                    stats["converted"] += 1
                    stats["bytes_total"] += file_size
                    print(f"  {variant_dir.name}/{png_file} -> .r565 "
                          f"({w}x{h}, {file_size} bytes)")
                else:
                    stats["errors"] += 1

    return stats


def main():
    parser = argparse.ArgumentParser(
        description="Convert PNG sprite sheets to raw RGB565 format"
    )
    parser.add_argument(
        "--sprites-dir",
        default=None,
        help="Path to sprites directory (default: auto-detect from script location)"
    )
    args = parser.parse_args()

    # Auto-detect sprites directory
    if args.sprites_dir:
        sprites_dir = args.sprites_dir
    else:
        # Script is in tools/, sprites are in sd_card_template/sprites/
        script_dir = Path(__file__).parent
        project_root = script_dir.parent
        sprites_dir = str(project_root / "sd_card_template" / "sprites")

    print(f"PNG to RGB565 Converter for Lalien Companion")
    print(f"Sprites directory: {sprites_dir}")
    print(f"Transparent pixels -> magenta (0x{TRANSPARENT_KEY:04X})")
    print("=" * 60)

    stats = process_sprites_dir(sprites_dir)

    print("\n" + "=" * 60)
    print(f"Done! Converted: {stats['converted']}, "
          f"Skipped (up-to-date): {stats['skipped']}, "
          f"Errors: {stats['errors']}")
    if stats["bytes_total"] > 0:
        mb = stats["bytes_total"] / (1024 * 1024)
        print(f"Total .r565 data: {mb:.2f} MB")


if __name__ == "__main__":
    main()
