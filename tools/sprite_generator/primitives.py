"""
primitives.py - Drawing helper functions for Lalien sprite generation.
Provides SNES-style pixel art drawing utilities with bilateral symmetry,
outlines, glow effects, and dithering.
"""

import math
from PIL import Image, ImageDraw, ImageFilter
import numpy as np


def draw_oval(img, bbox, color, outline_color=None):
    """Draw a filled oval with optional outline.

    Args:
        img: PIL Image (RGBA)
        bbox: (x0, y0, x1, y1) bounding box
        color: RGBA tuple for fill
        outline_color: RGBA tuple for outline, or None
    """
    draw = ImageDraw.Draw(img)
    if outline_color:
        draw.ellipse(bbox, fill=color, outline=outline_color)
    else:
        draw.ellipse(bbox, fill=color)


def draw_symmetric(img, draw_func):
    """Draw with bilateral symmetry: draw on left half, mirror to right.

    Args:
        img: PIL Image (RGBA), should be even width
        draw_func: callable(img, draw) that draws on the LEFT half only

    Returns:
        Modified image with mirrored content
    """
    w, h = img.size
    mid = w // 2

    # Create a working copy
    work = img.copy()
    draw = ImageDraw.Draw(work)
    draw_func(work, draw)

    # Extract left half pixels and mirror to right
    pixels = np.array(work)
    left_half = pixels[:, :mid, :]
    # Mirror: flip horizontally
    right_half = np.flip(left_half, axis=1)

    # For odd-width images, the center column stays as-is
    if w % 2 == 0:
        pixels[:, mid:, :] = right_half
    else:
        pixels[:, mid + 1:, :] = right_half

    result = Image.fromarray(pixels, 'RGBA')
    return result


def apply_dithering(img, palette):
    """Apply Floyd-Steinberg dithering to reduce image to a limited palette.

    Args:
        img: PIL Image (RGBA)
        palette: list of RGB tuples (the target palette)

    Returns:
        New PIL Image dithered to the palette
    """
    pixels = np.array(img, dtype=np.float64)
    h, w, _ = pixels.shape

    def closest_color(r, g, b, alpha):
        if alpha < 128:
            return (0, 0, 0, 0)
        best = None
        best_dist = float('inf')
        for pr, pg, pb in palette:
            dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
            if dist < best_dist:
                best_dist = dist
                best = (pr, pg, pb, int(alpha))
        return best

    for y in range(h):
        for x in range(w):
            old_r, old_g, old_b, old_a = pixels[y, x]
            new_r, new_g, new_b, new_a = closest_color(old_r, old_g, old_b, old_a)
            pixels[y, x] = [new_r, new_g, new_b, new_a]

            err_r = old_r - new_r
            err_g = old_g - new_g
            err_b = old_b - new_b

            # Distribute error (Floyd-Steinberg)
            if x + 1 < w:
                pixels[y, x + 1, :3] += [err_r * 7 / 16, err_g * 7 / 16, err_b * 7 / 16]
            if y + 1 < h:
                if x - 1 >= 0:
                    pixels[y + 1, x - 1, :3] += [err_r * 3 / 16, err_g * 3 / 16, err_b * 3 / 16]
                pixels[y + 1, x, :3] += [err_r * 5 / 16, err_g * 5 / 16, err_b * 5 / 16]
                if x + 1 < w:
                    pixels[y + 1, x + 1, :3] += [err_r * 1 / 16, err_g * 1 / 16, err_b * 1 / 16]

    pixels = np.clip(pixels, 0, 255).astype(np.uint8)
    return Image.fromarray(pixels, 'RGBA')


def add_outline(img, outline_color=(10, 10, 20, 255), inner_color=None):
    """Add a dark outline and optional lighter inner contour (SNES style).

    Non-transparent pixels get a 1px dark outline on their transparent neighbors.
    If inner_color is given, a lighter contour is drawn 1px inside the outline.

    Args:
        img: PIL Image (RGBA)
        outline_color: RGBA tuple for the outer edge
        inner_color: RGBA tuple for the inner highlight contour, or None

    Returns:
        New PIL Image with outlines applied
    """
    pixels = np.array(img)
    h, w, _ = pixels.shape
    alpha = pixels[:, :, 3]
    result = pixels.copy()

    # Find transparent pixels adjacent to opaque ones -> outline
    outline_mask = np.zeros((h, w), dtype=bool)
    for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        shifted_alpha = np.zeros_like(alpha)
        sy = max(0, dy)
        ey = min(h, h + dy)
        sx = max(0, dx)
        ex = min(w, w + dx)
        sy2 = max(0, -dy)
        ey2 = min(h, h - dy)
        sx2 = max(0, -dx)
        ex2 = min(w, w - dx)
        shifted_alpha[sy2:ey2, sx2:ex2] = alpha[sy:ey, sx:ex]
        outline_mask |= (alpha < 128) & (shifted_alpha >= 128)

    result[outline_mask] = list(outline_color)

    if inner_color:
        # Inner contour: opaque pixels adjacent to outline pixels
        inner_mask = np.zeros((h, w), dtype=bool)
        for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            shifted_outline = np.zeros_like(alpha, dtype=bool)
            sy = max(0, dy)
            ey = min(h, h + dy)
            sx = max(0, dx)
            ex = min(w, w + dx)
            sy2 = max(0, -dy)
            ey2 = min(h, h - dy)
            sx2 = max(0, -dx)
            ex2 = min(w, w - dx)
            shifted_outline[sy2:ey2, sx2:ex2] = outline_mask[sy:ey, sx:ex]
            inner_mask |= (alpha >= 128) & shifted_outline

        # Blend inner color
        for i in range(4):
            result[:, :, i] = np.where(
                inner_mask & (alpha >= 128) & ~outline_mask,
                np.clip(
                    result[:, :, i].astype(np.int16) * 0.5 + inner_color[i] * 0.5,
                    0, 255
                ).astype(np.uint8),
                result[:, :, i]
            )

    return Image.fromarray(result, 'RGBA')


def add_glow(img, center, radius, color, intensity=0.6):
    """Add a radial glow effect centered at a point.

    Args:
        img: PIL Image (RGBA)
        center: (cx, cy) center of glow
        radius: radius in pixels
        color: RGB tuple for glow color
        intensity: 0.0-1.0 glow strength

    Returns:
        New PIL Image with glow applied
    """
    pixels = np.array(img, dtype=np.float64)
    h, w, _ = pixels.shape
    cx, cy = center

    y_coords, x_coords = np.mgrid[0:h, 0:w]
    dist = np.sqrt((x_coords - cx) ** 2 + (y_coords - cy) ** 2)

    # Glow falloff: smooth gaussian-like
    glow_strength = np.clip(1.0 - (dist / radius), 0, 1) ** 2 * intensity
    mask = pixels[:, :, 3] > 0  # Only glow on existing pixels

    for i in range(3):
        pixels[:, :, i] = np.where(
            mask,
            np.clip(pixels[:, :, i] + glow_strength * color[i], 0, 255),
            pixels[:, :, i]
        )

    return Image.fromarray(pixels.astype(np.uint8), 'RGBA')


def pulse_core(img, center, radius, color, phase=0.0):
    """Draw a pulsating luminous core.

    Args:
        img: PIL Image (RGBA)
        center: (cx, cy) center of core
        radius: base radius
        color: RGB tuple for core color
        phase: 0.0-1.0 animation phase (controls pulse size/brightness)

    Returns:
        Modified image with pulsing core
    """
    pulse_factor = 0.7 + 0.3 * math.sin(phase * 2 * math.pi)
    actual_radius = radius * pulse_factor
    brightness = 0.5 + 0.5 * math.sin(phase * 2 * math.pi)

    pixels = np.array(img, dtype=np.float64)
    h, w, _ = pixels.shape
    cx, cy = center

    y_coords, x_coords = np.mgrid[0:h, 0:w]
    dist = np.sqrt((x_coords - cx) ** 2 + (y_coords - cy) ** 2)

    # Core: bright center with soft falloff
    core_mask = dist < actual_radius
    core_strength = np.where(
        core_mask,
        np.clip(1.0 - (dist / actual_radius), 0, 1) ** 1.5 * brightness,
        0.0
    )

    for i in range(3):
        pixels[:, :, i] = np.clip(
            pixels[:, :, i] + core_strength * color[i] * 0.8, 0, 255
        )
    # Also boost alpha where core is visible
    pixels[:, :, 3] = np.where(
        core_mask & (pixels[:, :, 3] > 0),
        np.clip(pixels[:, :, 3] + core_strength * 80, 0, 255),
        pixels[:, :, 3]
    )

    return Image.fromarray(pixels.astype(np.uint8), 'RGBA')


def draw_concentric_circles(img, center, radii, colors):
    """Draw concentric circles (rings) with specified colors.

    Args:
        img: PIL Image (RGBA)
        center: (cx, cy)
        radii: list of radii from outer to inner
        colors: list of RGBA tuples, same length as radii
    """
    draw = ImageDraw.Draw(img)
    cx, cy = center
    for r, c in zip(radii, colors):
        bbox = (cx - r, cy - r, cx + r, cy + r)
        draw.ellipse(bbox, fill=c)


def draw_pixel_particles(img, center, count, radius, color, seed=42):
    """Draw scattered pixel particles around a center point.

    Args:
        img: PIL Image (RGBA)
        center: (cx, cy)
        count: number of particles
        radius: max distance from center
        color: RGBA base color (will vary slightly)
        seed: random seed for reproducibility
    """
    rng = np.random.RandomState(seed)
    cx, cy = center
    pixels = np.array(img)

    for _ in range(count):
        angle = rng.uniform(0, 2 * math.pi)
        dist = rng.uniform(0, radius)
        px = int(cx + math.cos(angle) * dist)
        py = int(cy + math.sin(angle) * dist)

        if 0 <= px < img.size[0] and 0 <= py < img.size[1]:
            # Vary brightness slightly
            brightness = rng.uniform(0.6, 1.0)
            c = tuple(int(min(255, v * brightness)) for v in color[:3])
            alpha = int(color[3] * rng.uniform(0.4, 1.0))
            pixels[py, px] = (*c, alpha)

    result = Image.fromarray(pixels, 'RGBA')
    img.paste(result, (0, 0))


def lerp_color(c1, c2, t):
    """Linearly interpolate between two RGB or RGBA tuples."""
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


def draw_body_blob(img, cx, cy, width, height, color, outline_col=None):
    """Draw an organic blob shape (body) using an ellipse with slight irregularity.

    Args:
        img: PIL Image (RGBA)
        cx, cy: center
        width, height: half-extents
        color: RGBA fill
        outline_col: RGBA outline or None
    """
    bbox = (cx - width, cy - height, cx + width, cy + height)
    draw_oval(img, bbox, color, outline_col)


def draw_eye(img, cx, cy, radius, pupil_ratio=0.4, eye_color=(220, 240, 255, 255),
             pupil_color=(10, 10, 30, 255), highlight_color=(255, 255, 255, 255)):
    """Draw a single eye with pupil and highlight.

    Args:
        img: PIL Image (RGBA)
        cx, cy: center of eye
        radius: eye radius in pixels
        pupil_ratio: pupil radius as fraction of eye radius
        eye_color: RGBA for the sclera/iris
        pupil_color: RGBA for the pupil
        highlight_color: RGBA for the specular highlight
    """
    draw = ImageDraw.Draw(img)
    # Sclera
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=eye_color)
    # Pupil
    pr = max(1, int(radius * pupil_ratio))
    draw.ellipse((cx - pr, cy - pr, cx + pr, cy + pr), fill=pupil_color)
    # Highlight
    hr = max(1, pr // 2)
    hx = cx - pr // 3
    hy = cy - pr // 3
    draw.ellipse((hx - hr, hy - hr, hx + hr, hy + hr), fill=highlight_color)


def draw_appendage(img, base_x, base_y, length, angle, thickness, color, tip_color=None):
    """Draw a tentacle/appendage as a tapered line.

    Args:
        img: PIL Image
        base_x, base_y: attachment point
        length: length in pixels
        angle: angle in radians from vertical (0 = down)
        thickness: base thickness in pixels
        color: RGBA base color
        tip_color: RGBA tip color (for gradient), or None
    """
    draw = ImageDraw.Draw(img)
    segments = max(3, length)

    for i in range(segments):
        t = i / max(1, segments - 1)
        # Slight wave
        wave = math.sin(t * math.pi * 2) * 1.5
        x = base_x + math.sin(angle) * (i) + wave * math.cos(angle)
        y = base_y + math.cos(angle) * (i)

        seg_thick = max(1, int(thickness * (1.0 - t * 0.7)))
        if tip_color:
            c = lerp_color(color, tip_color, t)
        else:
            c = color

        draw.ellipse(
            (int(x - seg_thick), int(y - seg_thick),
             int(x + seg_thick), int(y + seg_thick)),
            fill=c
        )


def draw_mouth(img, cx, cy, width, height, color=(40, 20, 40, 255), open_amount=0.0):
    """Draw a small mouth.

    Args:
        img: PIL Image
        cx, cy: center of mouth
        width: mouth width
        height: mouth height at rest
        color: RGBA mouth color
        open_amount: 0.0 (closed) to 1.0 (fully open)
    """
    draw = ImageDraw.Draw(img)
    actual_h = max(1, int(height * (0.3 + 0.7 * open_amount)))
    bbox = (cx - width // 2, cy - actual_h // 2, cx + width // 2, cy + actual_h // 2)
    if open_amount < 0.2:
        # Closed: just a line
        draw.line((cx - width // 2, cy, cx + width // 2, cy), fill=color, width=1)
    else:
        draw.ellipse(bbox, fill=color)
