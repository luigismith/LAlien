"""
generate_sprites.py - Idle animation regenerator for Lalien Companion sprites.

WHAT IT DOES
------------
Regenerates ONLY the `idle.png` sprite sheet for every variant of every stage
(stages 0..7) under D:/LAlien/web/sprites/stage_*/variant_*/ and updates the
matching `animations.idle` block inside each `meta.json`.

All other animations (happy, sad, sleep, eat, play, sick, sing, evolving,
dying, dead, escaping, transcending, love, hungry, ...) are LEFT UNTOUCHED.

STRATEGY
--------
1. Read the existing idle.png for each variant and extract frame 0 as the
   canonical RGBA "body template". This preserves the exact silhouette,
   palette and DNA-driven detail that was originally generated.
2. Read meta.json to pick up DNA params (core_hue, palette_warmth,
   eye_size, appendage_count, body_curvature) for per-stage effects.
3. Apply a per-stage procedural animation transform (squash, breath, sway,
   blink, dissolve, sparkles...) producing N frames at 64x64 (or whatever
   the original frame size was).
4. Pack frames horizontally into a new idle.png (overwriting the old one)
   and rewrite meta.json animations.idle with the new frame count + fps.

HOW TO RUN
----------
    python tools/generate_sprites.py                # all stages, all variants
    python tools/generate_sprites.py --stage 3      # only stage 3
    python tools/generate_sprites.py --dry-run      # list work, touch nothing

Dependencies: Pillow, numpy.

WHAT IT MODIFIES
----------------
For every matching variant folder:
    - idle.png                  (overwritten)
    - meta.json -> animations.idle  (overwritten; other keys preserved)

The script is idempotent: re-running reproduces identical output for a given
template idle.png + DNA combination.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
from pathlib import Path
from typing import Callable, Dict, List, Tuple

import numpy as np
from PIL import Image

# ---------------------------------------------------------------------------
# Paths / discovery
# ---------------------------------------------------------------------------

SPRITES_ROOT = Path("D:/LAlien/web/sprites")

STAGE_DIRS = {
    0: "stage_0_syrma",
    1: "stage_1_lalina",
    2: "stage_2_lalishi",
    3: "stage_3_laliko",
    4: "stage_4_laliren",
    5: "stage_5_lalivox",
    6: "stage_6_lalimere",
    7: "stage_7_lalithishi",
}

# Per-stage target frame counts + fps (matches the spec in the task).
STAGE_SPEC: Dict[int, Dict] = {
    0: {"frames": 8,  "fps": 6},
    1: {"frames": 8,  "fps": 6},
    2: {"frames": 8,  "fps": 6},
    3: {"frames": 10, "fps": 8},
    4: {"frames": 10, "fps": 8},
    5: {"frames": 10, "fps": 6},
    6: {"frames": 8,  "fps": 4},
    7: {"frames": 12, "fps": 8},
}

# ---------------------------------------------------------------------------
# Utility: silhouette / anchor extraction
# ---------------------------------------------------------------------------

def load_template_frame(idle_path: Path) -> Tuple[np.ndarray, int, int]:
    """Open idle.png, return (rgba of frame 0, frame_w, frame_h)."""
    im = Image.open(idle_path).convert("RGBA")
    w, h = im.size
    # Frame height == image height; frame width == h (square frames) if the
    # file is a horizontal strip. Fall back to full width for single-frame.
    fw = h if w % h == 0 else w
    frame0 = im.crop((0, 0, fw, h))
    return np.array(frame0, dtype=np.uint8), fw, h


def silhouette_bbox(rgba: np.ndarray) -> Tuple[int, int, int, int]:
    """Return (x0, y0, x1, y1) bounding box of non-transparent pixels."""
    alpha = rgba[..., 3]
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        h, w = alpha.shape
        return 0, 0, w, h
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def find_eye_pixels(rgba: np.ndarray) -> List[Tuple[int, int]]:
    """
    Heuristic eye-detection: look for small clusters of very dark or very
    bright pixels in the upper 60% of the silhouette. Used for blink effects.
    Returns a list of (x, y) center approximations.
    """
    r, g, b, a = rgba[..., 0], rgba[..., 1], rgba[..., 2], rgba[..., 3]
    luma = (0.299 * r + 0.587 * g + 0.114 * b).astype(np.int16)
    x0, y0, x1, y1 = silhouette_bbox(rgba)
    upper_cut = y0 + int((y1 - y0) * 0.55)

    mask = np.zeros_like(a, dtype=bool)
    mask[y0:upper_cut, x0:x1] = True
    mask &= a > 32
    # Very dark *inside* the body => likely eyes.
    dark_mask = mask & (luma < 70)

    ys, xs = np.where(dark_mask)
    if len(xs) < 2:
        return []
    # Cluster roughly by x position: take centroid of left half & right half.
    mid = (x0 + x1) // 2
    left = [(int(xs[i]), int(ys[i])) for i in range(len(xs)) if xs[i] < mid]
    right = [(int(xs[i]), int(ys[i])) for i in range(len(xs)) if xs[i] >= mid]
    eyes = []
    for cluster in (left, right):
        if cluster:
            cx = sum(p[0] for p in cluster) // len(cluster)
            cy = sum(p[1] for p in cluster) // len(cluster)
            eyes.append((cx, cy))
    return eyes


def paste_centered(canvas: Image.Image, sprite: Image.Image,
                   dx: int = 0, dy: int = 0) -> None:
    """Paste sprite at canvas center + (dx, dy) using alpha compositing."""
    cw, ch = canvas.size
    sw, sh = sprite.size
    x = (cw - sw) // 2 + dx
    y = (ch - sh) // 2 + dy
    canvas.alpha_composite(sprite, dest=(x, y))


# ---------------------------------------------------------------------------
# Per-stage animation transforms
# ---------------------------------------------------------------------------
# Each transform takes (template_rgba, frame_index, total_frames, dna, fw, fh)
# and returns a PIL.Image.Image (RGBA, size fw x fh) representing that frame.

def _squash_stretch(template: Image.Image, sx: float, sy: float,
                    fw: int, fh: int, dy: int = 0) -> Image.Image:
    """Scale template non-uniformly about its center, re-center on canvas."""
    tw, th = template.size
    nw = max(1, int(round(tw * sx)))
    nh = max(1, int(round(th * sy)))
    scaled = template.resize((nw, nh), Image.NEAREST)
    canvas = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    paste_centered(canvas, scaled, dy=dy)
    return canvas


def _shift(template: Image.Image, dx: int, dy: int,
           fw: int, fh: int) -> Image.Image:
    canvas = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    paste_centered(canvas, template, dx=dx, dy=dy)
    return canvas


def _apply_blink(img: Image.Image, eyes: List[Tuple[int, int]],
                 eye_size: int, strength: float = 1.0) -> Image.Image:
    """Draw a horizontal eyelid line across each eye location."""
    if not eyes:
        return img
    arr = np.array(img, dtype=np.uint8)
    h, w, _ = arr.shape
    radius = max(1, eye_size + 1)
    for (ex, ey) in eyes:
        x0 = max(0, ex - radius)
        x1 = min(w, ex + radius + 1)
        y0 = max(0, ey - 1)
        y1 = min(h, ey + 1)
        # Replace eye pixels with the average surrounding skin color.
        surround_y0 = max(0, ey - radius - 1)
        surround_y1 = min(h, ey + radius + 2)
        neigh = arr[surround_y0:surround_y1, x0:x1]
        mask = neigh[..., 3] > 64
        if mask.sum() > 0:
            avg = neigh[mask][..., :3].mean(axis=0)
            skin = np.clip(avg * 0.85, 0, 255).astype(np.uint8)
        else:
            skin = np.array([180, 150, 150], dtype=np.uint8)
        if strength < 1.0:
            # Half-lidded: only cover the upper half of the eye.
            y0 = ey
        region = arr[y0:y1, x0:x1]
        a = region[..., 3:4]
        region[..., :3] = np.where(a > 0, skin, region[..., :3])
        arr[y0:y1, x0:x1] = region
    return Image.fromarray(arr, "RGBA")


def _tremor(img: Image.Image, amp: int, rng: random.Random,
            fw: int, fh: int) -> Image.Image:
    dx = rng.randint(-amp, amp)
    dy = rng.randint(-amp, amp)
    canvas = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    canvas.alpha_composite(img, dest=(dx, dy))
    return canvas


def _sparkle(img: Image.Image, rng: random.Random, count: int,
             core_hue: int, phase: float) -> Image.Image:
    """Overlay orbiting sparkle pixels (stage 7)."""
    arr = np.array(img, dtype=np.uint8)
    h, w, _ = arr.shape
    cx, cy = w // 2, h // 2
    # Sparkle color from hue.
    import colorsys
    r, g, b = colorsys.hsv_to_rgb((core_hue % 360) / 360.0, 0.35, 1.0)
    spark = np.array([int(r * 255), int(g * 255), int(b * 255), 230],
                     dtype=np.uint8)
    for i in range(count):
        ang = phase * 2 * math.pi + i * (2 * math.pi / count)
        radius = 22 + (i % 3) * 3
        x = int(cx + math.cos(ang) * radius)
        y = int(cy + math.sin(ang) * radius * 0.7)
        if 0 <= x < w and 0 <= y < h:
            arr[y, x] = spark
    return Image.fromarray(arr, "RGBA")


def _edge_dissolve(img: Image.Image, rng: random.Random,
                   strength: float) -> Image.Image:
    """Make a fraction of edge pixels transparent (stage 7)."""
    arr = np.array(img, dtype=np.uint8)
    alpha = arr[..., 3]
    # Detect edges = opaque pixels adjacent to transparent.
    opaque = alpha > 32
    padded = np.pad(opaque, 1, mode="constant", constant_values=False)
    neighbors_transparent = (
        ~padded[:-2, 1:-1] | ~padded[2:, 1:-1] |
        ~padded[1:-1, :-2] | ~padded[1:-1, 2:]
    )
    edge = opaque & neighbors_transparent
    ys, xs = np.where(edge)
    k = int(len(xs) * strength)
    if k > 0:
        idx = rng.sample(range(len(xs)), k)
        for i in idx:
            arr[ys[i], xs[i], 3] = 0
    return Image.fromarray(arr, "RGBA")


def _translucency(img: Image.Image, factor: float) -> Image.Image:
    arr = np.array(img, dtype=np.uint8)
    arr[..., 3] = (arr[..., 3].astype(np.float32) * factor).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def _shimmer_top(img: Image.Image, core_hue: int, intensity: float) -> Image.Image:
    """Single bright pixel near the top of the silhouette (stage 0 crack)."""
    arr = np.array(img, dtype=np.uint8)
    bb = silhouette_bbox(arr)
    x0, y0, x1, y1 = bb
    cx = (x0 + x1) // 2
    ty = y0 + 1
    if 0 <= cx < arr.shape[1] and 0 <= ty < arr.shape[0]:
        v = int(200 + 55 * intensity)
        arr[ty, cx] = [v, v, v, 255]
    return Image.fromarray(arr, "RGBA")


# ---------------------------------------------------------------------------
# Stage-specific frame builders
# ---------------------------------------------------------------------------

def frames_stage0(tpl_rgba: np.ndarray, dna: dict,
                  fw: int, fh: int, n: int, loop_idx: int) -> List[Image.Image]:
    """Syrma egg: heartbeat squash-stretch, periodic crack-shimmer."""
    tpl = Image.fromarray(tpl_rgba, "RGBA")
    # Crop to silhouette bbox for cleaner scaling.
    bb = silhouette_bbox(tpl_rgba)
    tpl_crop = tpl.crop(bb)
    out = []
    for i in range(n):
        # Heartbeat: two-beat squash
        t = i / n
        beat = math.sin(2 * math.pi * t) * 0.5 + math.sin(4 * math.pi * t) * 0.25
        sx = 1.0 + beat * 0.04
        sy = 1.0 - beat * 0.04
        frame = _squash_stretch(tpl_crop, sx, sy, fw, fh, dy=0)
        # Crack shimmer every 6th loop, frame 0.
        if loop_idx % 6 == 5 and i == 0:
            frame = _shimmer_top(frame, dna.get("core_hue", 200), 1.0)
        out.append(frame)
    return out


def frames_stage1(tpl_rgba: np.ndarray, dna: dict,
                  fw: int, fh: int, n: int, loop_idx: int) -> List[Image.Image]:
    """Lali-na newborn: soft breath + blink on final frame."""
    tpl = Image.fromarray(tpl_rgba, "RGBA")
    bb = silhouette_bbox(tpl_rgba)
    tpl_crop = tpl.crop(bb)
    eyes = find_eye_pixels(tpl_rgba)
    eye_size = dna.get("eye_size", 2)
    out = []
    for i in range(n):
        t = i / n
        breath = math.sin(2 * math.pi * t)
        sx = 1.0 + breath * 0.02
        sy = 1.0 + breath * 0.03
        dy = int(round(-breath * 0.8))
        frame = _squash_stretch(tpl_crop, sx, sy, fw, fh, dy=dy)
        if i == n - 1:
            frame = _apply_blink(frame, eyes, eye_size, strength=1.0)
        out.append(frame)
    return out


def frames_stage2(tpl_rgba: np.ndarray, dna: dict,
                  fw: int, fh: int, n: int, loop_idx: int) -> List[Image.Image]:
    """Lali-shi infant: side-to-side rock + small arm waggle, blink on frame 0."""
    tpl = Image.fromarray(tpl_rgba, "RGBA")
    bb = silhouette_bbox(tpl_rgba)
    tpl_crop = tpl.crop(bb)
    eyes = find_eye_pixels(tpl_rgba)
    eye_size = dna.get("eye_size", 2)
    out = []
    for i in range(n):
        t = i / n
        dx = int(round(math.sin(2 * math.pi * t) * 1.5))
        dy = int(round(abs(math.sin(2 * math.pi * t)) * -0.8))
        frame = _shift(tpl_crop, dx, dy, fw, fh)
        if i == 0:
            frame = _apply_blink(frame, eyes, eye_size, strength=1.0)
        out.append(frame)
    return out


def frames_stage3(tpl_rgba: np.ndarray, dna: dict,
                  fw: int, fh: int, n: int, loop_idx: int) -> List[Image.Image]:
    """Lali-ko child: opposite-phase appendage sway + body lean; 2 blinks."""
    # We can't isolate appendages easily, so we emulate "lean" with a
    # combined horizontal shear (via shift) + slight squash.
    tpl = Image.fromarray(tpl_rgba, "RGBA")
    bb = silhouette_bbox(tpl_rgba)
    tpl_crop = tpl.crop(bb)
    eyes = find_eye_pixels(tpl_rgba)
    eye_size = dna.get("eye_size", 2)
    blink_frames = {1, 6}
    out = []
    for i in range(n):
        t = i / n
        lean = math.sin(2 * math.pi * t)
        dx = int(round(lean * 2))
        sy = 1.0 + math.cos(2 * math.pi * t) * 0.02
        frame = _squash_stretch(tpl_crop, 1.0, sy, fw, fh, dy=0)
        frame = _shift(frame, dx, 0, fw, fh)
        if i in blink_frames:
            frame = _apply_blink(frame, eyes, eye_size, strength=1.0)
        out.append(frame)
    return out


def frames_stage4(tpl_rgba: np.ndarray, dna: dict,
                  fw: int, fh: int, n: int, loop_idx: int) -> List[Image.Image]:
    """Lali-ren teen: confident sway + slow follow-through, blink frame 0."""
    tpl = Image.fromarray(tpl_rgba, "RGBA")
    bb = silhouette_bbox(tpl_rgba)
    tpl_crop = tpl.crop(bb)
    eyes = find_eye_pixels(tpl_rgba)
    eye_size = dna.get("eye_size", 2)
    out = []
    for i in range(n):
        t = i / n
        sway = math.sin(2 * math.pi * t)
        bob = math.sin(4 * math.pi * t) * 0.5
        dx = int(round(sway * 1.8))
        dy = int(round(-bob))
        sx = 1.0 + sway * 0.015
        sy = 1.0 - bob * 0.015
        frame = _squash_stretch(tpl_crop, sx, sy, fw, fh, dy=dy)
        frame = _shift(frame, dx, 0, fw, fh)
        if i == 0:
            frame = _apply_blink(frame, eyes, eye_size, strength=1.0)
        out.append(frame)
    return out


def frames_stage5(tpl_rgba: np.ndarray, dna: dict,
                  fw: int, fh: int, n: int, loop_idx: int) -> List[Image.Image]:
    """Lali-vox adult: slow measured breath + subtle gesture."""
    tpl = Image.fromarray(tpl_rgba, "RGBA")
    bb = silhouette_bbox(tpl_rgba)
    tpl_crop = tpl.crop(bb)
    out = []
    for i in range(n):
        t = i / n
        breath = math.sin(2 * math.pi * t)
        sx = 1.0 + breath * 0.018
        sy = 1.0 + breath * 0.028
        dy = int(round(-breath * 1.0))
        dx = int(round(math.sin(4 * math.pi * t) * 0.8))
        frame = _squash_stretch(tpl_crop, sx, sy, fw, fh, dy=dy)
        frame = _shift(frame, dx, 0, fw, fh)
        out.append(frame)
    return out


def frames_stage6(tpl_rgba: np.ndarray, dna: dict,
                  fw: int, fh: int, n: int, loop_idx: int) -> List[Image.Image]:
    """Lali-mere elder: slow deep breath, occasional tremor, half-lidded eyes."""
    tpl = Image.fromarray(tpl_rgba, "RGBA")
    bb = silhouette_bbox(tpl_rgba)
    tpl_crop = tpl.crop(bb)
    eyes = find_eye_pixels(tpl_rgba)
    eye_size = dna.get("eye_size", 2)
    rng = random.Random(dna.get("symmetry_seed", 42) ^ 0x6E6E)
    tremor_frames = {3}  # one tremor frame per loop
    eyes_open_frame = n // 2
    out = []
    for i in range(n):
        t = i / n
        breath = math.sin(2 * math.pi * t)
        sx = 1.0 + breath * 0.02
        sy = 1.0 + breath * 0.035
        dy = int(round(-breath * 1.2))
        frame = _squash_stretch(tpl_crop, sx, sy, fw, fh, dy=dy)
        if i in tremor_frames:
            frame = _tremor(frame, 1, rng, fw, fh)
        # Half-lidded except for one open frame.
        if i != eyes_open_frame:
            frame = _apply_blink(frame, eyes, eye_size, strength=0.5)
        out.append(frame)
    return out


def frames_stage7(tpl_rgba: np.ndarray, dna: dict,
                  fw: int, fh: int, n: int, loop_idx: int) -> List[Image.Image]:
    """Lali-thishi transcendence: edge dissolve, orbiting sparkles, translucency."""
    tpl = Image.fromarray(tpl_rgba, "RGBA")
    bb = silhouette_bbox(tpl_rgba)
    tpl_crop = tpl.crop(bb)
    core_hue = dna.get("core_hue", 280)
    out = []
    # Per-frame deterministic RNG so animation is reproducible.
    base_seed = dna.get("symmetry_seed", 99) ^ 0xA11E
    for i in range(n):
        t = i / n
        breath = math.sin(2 * math.pi * t)
        sx = 1.0 + breath * 0.02
        sy = 1.0 + breath * 0.03
        frame = _squash_stretch(tpl_crop, sx, sy, fw, fh, dy=0)
        # Translucency cycles 0.7..1.0
        alpha_factor = 0.7 + 0.3 * (0.5 + 0.5 * math.cos(2 * math.pi * t))
        frame = _translucency(frame, alpha_factor)
        # Edge dissolve: stronger near mid-cycle
        dissolve_strength = 0.12 + 0.18 * abs(math.sin(math.pi * t))
        rng = random.Random(base_seed + i)
        frame = _edge_dissolve(frame, rng, dissolve_strength)
        # Sparkles orbiting
        frame = _sparkle(frame, rng, count=5, core_hue=core_hue, phase=t)
        out.append(frame)
    return out


STAGE_BUILDERS: Dict[int, Callable] = {
    0: frames_stage0,
    1: frames_stage1,
    2: frames_stage2,
    3: frames_stage3,
    4: frames_stage4,
    5: frames_stage5,
    6: frames_stage6,
    7: frames_stage7,
}


# ---------------------------------------------------------------------------
# Sheet packing + meta update
# ---------------------------------------------------------------------------

def pack_horizontal(frames: List[Image.Image], fw: int, fh: int) -> Image.Image:
    sheet = Image.new("RGBA", (fw * len(frames), fh), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        if fr.size != (fw, fh):
            fr = fr.resize((fw, fh), Image.NEAREST)
        sheet.paste(fr, (i * fw, 0), fr)
    return sheet


def update_meta(meta_path: Path, frames: int, fps: int, fw: int, fh: int) -> None:
    with meta_path.open("r", encoding="utf-8") as f:
        meta = json.load(f)
    meta.setdefault("animations", {})
    meta["animations"]["idle"] = {
        "frames": frames,
        "fps": fps,
        "file": "idle.png",
        "frame_width": fw,
        "frame_height": fh,
    }
    with meta_path.open("w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def process_variant(stage_id: int, variant_dir: Path, dry_run: bool) -> bool:
    idle_path = variant_dir / "idle.png"
    meta_path = variant_dir / "meta.json"
    if not idle_path.exists() or not meta_path.exists():
        print(f"  [skip] {variant_dir.name}: missing idle.png or meta.json")
        return False

    try:
        tpl_rgba, fw, fh = load_template_frame(idle_path)
    except Exception as e:
        print(f"  [err ] {variant_dir.name}: cannot open idle.png ({e})")
        return False

    with meta_path.open("r", encoding="utf-8") as f:
        meta = json.load(f)
    dna = meta.get("dna_params", {})

    spec = STAGE_SPEC[stage_id]
    n = spec["frames"]
    fps = spec["fps"]

    loop_idx = int(dna.get("variant_index", 0))  # just for periodic effects
    builder = STAGE_BUILDERS[stage_id]
    frames = builder(tpl_rgba, dna, fw, fh, n, loop_idx)

    if dry_run:
        print(f"  [dry ] {variant_dir.name}: would write {n}f @ {fps}fps "
              f"({fw}x{fh})")
        return True

    sheet = pack_horizontal(frames, fw, fh)
    sheet.save(idle_path, optimize=True)
    update_meta(meta_path, n, fps, fw, fh)
    print(f"  [ok  ] {variant_dir.name}: {n}f @ {fps}fps ({fw}x{fh})")
    return True


def process_stage(stage_id: int, dry_run: bool) -> Tuple[int, int]:
    stage_dir = SPRITES_ROOT / STAGE_DIRS[stage_id]
    if not stage_dir.exists():
        print(f"[stage {stage_id}] missing: {stage_dir}")
        return 0, 0
    variants = sorted(p for p in stage_dir.iterdir()
                      if p.is_dir() and p.name.startswith("variant_"))
    print(f"[stage {stage_id}] {stage_dir.name}: {len(variants)} variants")
    ok = 0
    for v in variants:
        if process_variant(stage_id, v, dry_run):
            ok += 1
    return ok, len(variants)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stage", type=int, default=None,
                    help="Limit to a single stage id (0..7). Default: all.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Describe work but do not write any file.")
    args = ap.parse_args()

    stages = [args.stage] if args.stage is not None else list(STAGE_DIRS.keys())
    total_ok = 0
    total_all = 0
    for sid in stages:
        if sid not in STAGE_DIRS:
            print(f"Unknown stage {sid}, skipping")
            continue
        ok, total = process_stage(sid, args.dry_run)
        total_ok += ok
        total_all += total

    print(f"\nDone. {total_ok}/{total_all} variants processed"
          f"{' (dry run)' if args.dry_run else ''}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
