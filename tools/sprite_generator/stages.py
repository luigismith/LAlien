"""
stages.py - Drawing functions for each Lalien developmental stage.
Each stage function draws the creature on a 64x64 RGBA canvas.
"""

import math
from PIL import Image, ImageDraw
import numpy as np

from primitives import (
    draw_oval, draw_symmetric, add_outline, add_glow, pulse_core,
    draw_concentric_circles, draw_pixel_particles, draw_body_blob,
    draw_eye, draw_appendage, draw_mouth, lerp_color
)
from palettes import get_palette, get_body_colors, desaturate_palette
from dna import params_for_stage


SIZE = 64
CENTER_X = SIZE // 2
CENTER_Y = SIZE // 2


def _create_canvas():
    """Create a blank 64x64 RGBA canvas."""
    return Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))


def _hue_to_rgb(hue):
    """Convert hue (0-360) to an RGB tuple."""
    h = (hue % 360) / 60.0
    c = 200  # chroma
    x = int(c * (1 - abs(h % 2 - 1)))
    c = int(c)
    if h < 1:
        return (c, x, 0)
    elif h < 2:
        return (x, c, 0)
    elif h < 3:
        return (0, c, x)
    elif h < 4:
        return (0, x, c)
    elif h < 5:
        return (x, 0, c)
    else:
        return (c, 0, x)


# ===== STAGE 0: Syrma (Egg) =====

def draw_stage_0(img, dna_params, frame=0):
    """Draw Stage 0 - Syrma (Egg).

    A smooth oval with a spiral pattern and slow pulsing core.
    Simple, mysterious, organic shape.
    """
    p = params_for_stage(dna_params, 0)
    palette = get_palette(p['palette_warmth'])
    colors = get_body_colors(palette)
    core_rgb = _hue_to_rgb(p['core_hue'])

    cx, cy = CENTER_X, CENTER_Y

    # Egg body dimensions
    egg_w = int(14 * p['body_width'])
    egg_h = int(20 * p['body_height'])

    # Draw egg body (oval)
    draw_body_blob(img, cx, cy, egg_w, egg_h, colors['body'], colors['outline'])

    # Spiral pattern on egg
    draw = ImageDraw.Draw(img)
    phase = frame * 0.25
    spiral_color = (*palette[3], 120)
    for i in range(20):
        t = i / 20.0
        angle = t * math.pi * 3 + phase
        r = t * min(egg_w, egg_h) * 0.7
        sx = int(cx + math.cos(angle) * r * 0.6)
        sy = int(cy + math.sin(angle) * r * 0.9)
        if 0 <= sx < SIZE and 0 <= sy < SIZE:
            # Only draw if inside the egg shape
            dx = (sx - cx) / max(1, egg_w)
            dy = (sy - cy) / max(1, egg_h)
            if dx * dx + dy * dy < 0.85:
                draw.point((sx, sy), fill=spiral_color)

    # Pulsating core
    core_phase = (frame % 8) / 8.0
    img_result = pulse_core(img, (cx, cy), int(egg_w * 0.4),
                            core_rgb, core_phase)
    img.paste(img_result, (0, 0))

    # Soft glow
    img_result = add_glow(img, (cx, cy), egg_w, core_rgb, 0.3)
    img.paste(img_result, (0, 0))

    # SNES-style outline
    img_result = add_outline(img, colors['outline'],
                             inner_color=colors['inner'])
    img.paste(img_result, (0, 0))

    return img


# ===== STAGE 1: Lali-na (Newborn) =====

def draw_stage_1(img, dna_params, frame=0):
    """Draw Stage 1 - Lali-na (Newborn).

    Luminous blob with 2 big eyes and a small mouth. No appendages.
    Cute, simple, glowing.
    """
    p = params_for_stage(dna_params, 1)
    palette = get_palette(p['palette_warmth'])
    colors = get_body_colors(palette)
    core_rgb = _hue_to_rgb(p['core_hue'])

    cx, cy = CENTER_X, CENTER_Y + 2  # slightly lower center

    # Body: rounded blob
    body_w = int(16 * p['body_width'])
    body_h = int(14 * p['body_height'])

    # Draw a slightly blobby body using overlapping ovals
    # Main body
    draw_body_blob(img, cx, cy, body_w, body_h, colors['body'])
    # Head bump (slightly above center)
    head_w = int(body_w * 0.85)
    head_h = int(body_h * 0.7)
    draw_body_blob(img, cx, cy - int(body_h * 0.3), head_w, head_h, colors['body'])

    # Core glow (center of body)
    core_phase = (frame % 8) / 8.0
    img_result = pulse_core(img, (cx, cy + 2), int(body_w * 0.35),
                            core_rgb, core_phase)
    img.paste(img_result, (0, 0))

    # Glow effect
    img_result = add_glow(img, (cx, cy), body_w + 2, core_rgb, 0.35)
    img.paste(img_result, (0, 0))

    # Eyes - big and expressive
    eye_radius = 2 + p['eye_size']
    eye_y = cy - int(body_h * 0.25)
    eye_spacing = int(body_w * p['eye_spacing'])

    # Draw eyes on the left half only, then mirror
    left_eye_x = cx - eye_spacing
    right_eye_x = cx + eye_spacing

    draw_eye(img, left_eye_x, eye_y, eye_radius,
             pupil_ratio=0.45, eye_color=colors['eyes'],
             pupil_color=(10, 10, 30, 255))
    draw_eye(img, right_eye_x, eye_y, eye_radius,
             pupil_ratio=0.45, eye_color=colors['eyes'],
             pupil_color=(10, 10, 30, 255))

    # Small mouth
    mouth_y = cy + int(body_h * 0.15)
    draw_mouth(img, cx, mouth_y, p['mouth_size'] + 2, 2,
               color=(40, 20, 40, 200))

    # SNES-style outline
    img_result = add_outline(img, colors['outline'],
                             inner_color=colors['inner'])
    img.paste(img_result, (0, 0))

    return img


# ===== STAGE 2: Lali-shi (Infant) =====

def draw_stage_2(img, dna_params, frame=0):
    """Draw Stage 2 - Lali-shi (Infant).
    Structured blob, 2 small appendages, huge eyes.
    """
    p = params_for_stage(dna_params, 2)
    palette = get_palette(p['palette_warmth'])
    colors = get_body_colors(palette)
    core_rgb = _hue_to_rgb(p['core_hue'])
    cx, cy = CENTER_X, CENTER_Y + 2

    body_w = int(15 * p['body_width'])
    body_h = int(16 * p['body_height'])

    # Body
    draw_body_blob(img, cx, cy, body_w, body_h, colors['body'])
    draw_body_blob(img, cx, cy - int(body_h * 0.35), int(body_w * 0.9),
                   int(body_h * 0.6), colors['body_light'])

    # Core
    core_phase = (frame % 8) / 8.0
    img_result = pulse_core(img, (cx, cy + 2), int(body_w * 0.3), core_rgb, core_phase)
    img.paste(img_result, (0, 0))
    img_result = add_glow(img, (cx, cy), body_w, core_rgb, 0.3)
    img.paste(img_result, (0, 0))

    # 2 small appendages
    wave = math.sin(frame * 0.5) * 0.3
    for side in [-1, 1]:
        ax = cx + side * body_w
        ay = cy + int(body_h * 0.3)
        angle = side * 0.8 + wave * side
        draw_appendage(img, ax, ay, 6 + p['appendage_length'] * 2,
                       angle, 2, colors['appendage'], colors['appendage_tip'])

    # Huge eyes
    eye_radius = 3 + p['eye_size']
    eye_y = cy - int(body_h * 0.2)
    eye_spacing = int(body_w * p['eye_spacing'])
    for side in [-1, 1]:
        draw_eye(img, cx + side * eye_spacing, eye_y, eye_radius,
                 pupil_ratio=0.4, eye_color=colors['eyes'])

    # Mouth
    draw_mouth(img, cx, cy + int(body_h * 0.2), p['mouth_size'] + 2, 2)

    # Outline
    img_result = add_outline(img, colors['outline'], inner_color=colors['inner'])
    img.paste(img_result, (0, 0))
    return img


# ===== STAGE 3: Lali-ko (Child) =====

def draw_stage_3(img, dna_params, frame=0):
    """Draw Stage 3 - Lali-ko (Child).
    Elongated body, 4 appendages, facial expressions.
    """
    p = params_for_stage(dna_params, 3)
    palette = get_palette(p['palette_warmth'])
    colors = get_body_colors(palette)
    core_rgb = _hue_to_rgb(p['core_hue'])
    cx, cy = CENTER_X, CENTER_Y + 1

    body_w = int(14 * p['body_width'])
    body_h = int(20 * p['body_height'])

    # Elongated body
    draw_body_blob(img, cx, cy, body_w, body_h, colors['body'])
    draw_body_blob(img, cx, cy - int(body_h * 0.3), int(body_w * 0.8),
                   int(body_h * 0.5), colors['body_light'])

    # Core
    core_phase = (frame % 8) / 8.0
    img_result = pulse_core(img, (cx, cy + 2), int(body_w * 0.3), core_rgb, core_phase)
    img.paste(img_result, (0, 0))
    img_result = add_glow(img, (cx, cy), body_w, core_rgb, 0.25)
    img.paste(img_result, (0, 0))

    # 4 appendages
    wave = math.sin(frame * 0.5) * 0.4
    app_count = min(4, p['appendage_count']) if p['appendage_count'] > 0 else 4
    app_len = 8 + p['appendage_length'] * 3
    positions = [
        (-1, 0.1, -0.6), (1, 0.1, 0.6),
        (-1, 0.5, -1.0), (1, 0.5, 1.0),
    ]
    for i, (side, y_frac, base_angle) in enumerate(positions[:app_count]):
        ax = cx + side * body_w
        ay = cy + int(body_h * y_frac)
        angle = base_angle + wave * side
        draw_appendage(img, ax, ay, app_len, angle, 2,
                       colors['appendage'], colors['appendage_tip'])

    # Eyes
    eye_radius = 2 + p['eye_size']
    eye_y = cy - int(body_h * 0.25)
    eye_spacing = int(body_w * p['eye_spacing'])
    for side in [-1, 1]:
        draw_eye(img, cx + side * eye_spacing, eye_y, eye_radius, pupil_ratio=0.45)

    # Mouth
    draw_mouth(img, cx, cy + int(body_h * 0.05), p['mouth_size'] + 3, 2)

    img_result = add_outline(img, colors['outline'], inner_color=colors['inner'])
    img.paste(img_result, (0, 0))
    return img


# ===== STAGE 4: Lali-ren (Teen) =====

def draw_stage_4(img, dna_params, frame=0):
    """Draw Stage 4 - Lali-ren (Teen).
    Defined body, long appendages, prominent core.
    """
    p = params_for_stage(dna_params, 4)
    palette = get_palette(p['palette_warmth'])
    colors = get_body_colors(palette)
    core_rgb = _hue_to_rgb(p['core_hue'])
    cx, cy = CENTER_X, CENTER_Y

    body_w = int(13 * p['body_width'])
    body_h = int(22 * p['body_height'])

    draw_body_blob(img, cx, cy, body_w, body_h, colors['body'])
    draw_body_blob(img, cx, cy - int(body_h * 0.3), int(body_w * 0.85),
                   int(body_h * 0.45), colors['body_light'])

    # Prominent core
    core_phase = (frame % 8) / 8.0
    img_result = pulse_core(img, (cx, cy + 3), int(body_w * 0.4), core_rgb, core_phase)
    img.paste(img_result, (0, 0))
    img_result = add_glow(img, (cx, cy), body_w + 3, core_rgb, 0.4)
    img.paste(img_result, (0, 0))

    # Long appendages
    wave = math.sin(frame * 0.5) * 0.5
    app_len = 10 + p['appendage_length'] * 4
    positions = [
        (-1, -0.05, -0.5), (1, -0.05, 0.5),
        (-1, 0.25, -0.8), (1, 0.25, 0.8),
        (-1, 0.55, -1.1), (1, 0.55, 1.1),
    ]
    for i, (side, y_frac, base_angle) in enumerate(positions[:p['appendage_count']]):
        ax = cx + side * body_w
        ay = cy + int(body_h * y_frac)
        angle = base_angle + wave * side * (0.5 + i * 0.2)
        draw_appendage(img, ax, ay, app_len, angle, 2,
                       colors['appendage'], colors['appendage_tip'])

    # Eyes
    eye_radius = 2 + p['eye_size']
    eye_y = cy - int(body_h * 0.28)
    eye_spacing = int(body_w * p['eye_spacing'])
    for side in [-1, 1]:
        draw_eye(img, cx + side * eye_spacing, eye_y, eye_radius, pupil_ratio=0.5)

    draw_mouth(img, cx, cy + int(body_h * 0.0), p['mouth_size'] + 3, 3)

    img_result = add_outline(img, colors['outline'], inner_color=colors['inner'])
    img.paste(img_result, (0, 0))
    return img


# ===== STAGE 5: Lali-vox (Adult) =====

def draw_stage_5(img, dna_params, frame=0):
    """Draw Stage 5 - Lali-vox (Adult).
    Mature form, maximum DNA detail, saturated palette.
    """
    p = params_for_stage(dna_params, 5)
    palette = get_palette(p['palette_warmth'])
    colors = get_body_colors(palette)
    core_rgb = _hue_to_rgb(p['core_hue'])
    cx, cy = CENTER_X, CENTER_Y

    body_w = int(14 * p['body_width'])
    body_h = int(24 * p['body_height'])

    # Layered body
    draw_body_blob(img, cx, cy, body_w, body_h, colors['body_dark'])
    draw_body_blob(img, cx, cy, int(body_w * 0.9), int(body_h * 0.9), colors['body'])
    draw_body_blob(img, cx, cy - int(body_h * 0.25), int(body_w * 0.8),
                   int(body_h * 0.45), colors['body_light'])

    # Strong core
    core_phase = (frame % 8) / 8.0
    img_result = pulse_core(img, (cx, cy + 3), int(body_w * 0.45), core_rgb, core_phase)
    img.paste(img_result, (0, 0))
    img_result = add_glow(img, (cx, cy), body_w + 4, core_rgb, 0.45)
    img.paste(img_result, (0, 0))

    # All appendages, full length
    wave = math.sin(frame * 0.5) * 0.5
    app_len = 12 + p['appendage_length'] * 4
    positions = [
        (-1, -0.1, -0.4), (1, -0.1, 0.4),
        (-1, 0.15, -0.7), (1, 0.15, 0.7),
        (-1, 0.4, -1.0), (1, 0.4, 1.0),
    ]
    for i, (side, y_frac, base_angle) in enumerate(positions[:p['appendage_count']]):
        ax = cx + side * body_w
        ay = cy + int(body_h * y_frac)
        angle = base_angle + wave * side * (0.3 + i * 0.15)
        draw_appendage(img, ax, ay, app_len, angle, 2,
                       colors['appendage'], colors['appendage_tip'])

    eye_radius = 2 + p['eye_size']
    eye_y = cy - int(body_h * 0.28)
    eye_spacing = int(body_w * p['eye_spacing'])
    for side in [-1, 1]:
        draw_eye(img, cx + side * eye_spacing, eye_y, eye_radius, pupil_ratio=0.5)

    draw_mouth(img, cx, cy - int(body_h * 0.02), p['mouth_size'] + 3, 3)

    img_result = add_outline(img, colors['outline'], inner_color=colors['inner'])
    img.paste(img_result, (0, 0))
    return img


# ===== STAGE 6: Lali-mere (Sage) =====

def draw_stage_6(img, dna_params, frame=0):
    """Draw Stage 6 - Lali-mere (Sage).
    Stylized, reflective eyes, desaturated noble palette, light aura.
    """
    p = params_for_stage(dna_params, 6)
    palette = desaturate_palette(get_palette(p['palette_warmth']), 0.35)
    colors = get_body_colors(palette)
    core_rgb = _hue_to_rgb(p['core_hue'])
    cx, cy = CENTER_X, CENTER_Y

    body_w = int(13 * p['body_width'])
    body_h = int(22 * p['body_height'])

    # Aura (drawn first, behind body)
    aura_color = tuple(min(255, c + 80) for c in core_rgb)
    img_result = add_glow(img, (cx, cy), body_w + 8, aura_color, 0.15)
    img.paste(img_result, (0, 0))

    draw_body_blob(img, cx, cy, body_w, body_h, colors['body'])
    draw_body_blob(img, cx, cy - int(body_h * 0.25), int(body_w * 0.8),
                   int(body_h * 0.4), colors['body_light'])

    core_phase = (frame % 8) / 8.0
    img_result = pulse_core(img, (cx, cy + 2), int(body_w * 0.35), core_rgb, core_phase)
    img.paste(img_result, (0, 0))

    # Appendages (graceful)
    wave = math.sin(frame * 0.4) * 0.3
    app_len = 10 + p['appendage_length'] * 3
    positions = [
        (-1, 0.0, -0.5), (1, 0.0, 0.5),
        (-1, 0.3, -0.9), (1, 0.3, 0.9),
    ]
    for i, (side, y_frac, base_angle) in enumerate(positions[:min(4, p['appendage_count'])]):
        ax = cx + side * body_w
        ay = cy + int(body_h * y_frac)
        angle = base_angle + wave * side
        draw_appendage(img, ax, ay, app_len, angle, 2,
                       colors['appendage'], colors['appendage_tip'])

    # Reflective eyes (slightly larger, with double highlight)
    eye_radius = 3 + p['eye_size']
    eye_y = cy - int(body_h * 0.25)
    eye_spacing = int(body_w * p['eye_spacing'])
    for side in [-1, 1]:
        ex = cx + side * eye_spacing
        draw_eye(img, ex, eye_y, eye_radius, pupil_ratio=0.5,
                 eye_color=(200, 220, 240, 255))
        # Second small highlight for "reflective" look
        draw = ImageDraw.Draw(img)
        hx = ex + side
        hy = eye_y + 1
        draw.point((hx, hy), fill=(255, 255, 255, 200))

    draw_mouth(img, cx, cy + int(body_h * 0.05), p['mouth_size'] + 2, 2)

    img_result = add_outline(img, colors['outline'], inner_color=colors['inner'])
    img.paste(img_result, (0, 0))
    return img


# ===== STAGE 7: Lali-thishi (Transcendence) =====

def draw_stage_7(img, dna_params, frame=0):
    """Draw Stage 7 - Lali-thishi (Transcendence).
    Translucent, undefined outline, light particles, iridescent.
    """
    p = params_for_stage(dna_params, 7)
    palette = get_palette(p['palette_warmth'])
    colors = get_body_colors(palette)
    core_rgb = _hue_to_rgb(p['core_hue'])
    cx, cy = CENTER_X, CENTER_Y

    body_w = int(12 * p['body_width'])
    body_h = int(20 * p['body_height'])

    # Translucent body (lower alpha)
    body_col = (*palette[0], 100)
    body_light = (*palette[4], 80)

    draw_body_blob(img, cx, cy, body_w, body_h, body_col)
    draw_body_blob(img, cx, cy - int(body_h * 0.2), int(body_w * 0.8),
                   int(body_h * 0.4), body_light)

    # Intense iridescent core
    core_phase = (frame % 12) / 12.0
    shifted_hue = (p['core_hue'] + int(frame * 15)) % 360
    shifting_rgb = _hue_to_rgb(shifted_hue)
    img_result = pulse_core(img, (cx, cy), int(body_w * 0.5),
                            shifting_rgb, core_phase)
    img.paste(img_result, (0, 0))
    img_result = add_glow(img, (cx, cy), body_w + 6, shifting_rgb, 0.5)
    img.paste(img_result, (0, 0))

    # Light particles
    particle_color = (*shifting_rgb, 180)
    draw_pixel_particles(img, (cx, cy), 15 + frame * 2, body_w + 10,
                         particle_color, seed=p['symmetry_seed'] + frame)

    # Ethereal eyes
    eye_radius = 2 + p['eye_size']
    eye_y = cy - int(body_h * 0.2)
    eye_spacing = int(body_w * p['eye_spacing'])
    for side in [-1, 1]:
        draw_eye(img, cx + side * eye_spacing, eye_y, eye_radius,
                 pupil_ratio=0.3, eye_color=(240, 250, 255, 160),
                 pupil_color=(200, 220, 255, 200),
                 highlight_color=(255, 255, 255, 220))

    # Very soft outline (almost none - translucent)
    img_result = add_outline(img, (40, 40, 60, 120))
    img.paste(img_result, (0, 0))
    return img


# ===== Stage dispatch =====

STAGE_FUNCTIONS = {
    0: draw_stage_0,
    1: draw_stage_1,
    2: draw_stage_2,
    3: draw_stage_3,
    4: draw_stage_4,
    5: draw_stage_5,
    6: draw_stage_6,
    7: draw_stage_7,
}


def draw_stage(stage, img, dna_params, frame=0):
    """Draw a specific stage on the given image.

    Args:
        stage: int 0-7
        img: PIL Image (RGBA, 64x64)
        dna_params: dict from dna_to_params
        frame: animation frame index

    Returns:
        The modified image
    """
    func = STAGE_FUNCTIONS.get(stage)
    if func is None:
        raise ValueError(f"Unknown stage: {stage}")
    return func(img, dna_params, frame)
