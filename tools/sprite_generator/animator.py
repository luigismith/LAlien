"""
animator.py - Animation frame generation for Lalien sprites.
Generates N frames per animation with appropriate transformations.
"""

import math
from PIL import Image, ImageEnhance, ImageDraw
import numpy as np

from stages import draw_stage, _create_canvas, SIZE
from palettes import get_palette, get_body_colors, desaturate_palette
from primitives import draw_pixel_particles, add_glow, lerp_color


# Animation definitions: name -> (frame_count, fps)
ANIMATIONS = {
    'idle':         (4, 4),
    'happy':        (4, 6),
    'sad':          (3, 3),
    'sleep':        (3, 2),
    'eat':          (4, 5),
    'play':         (4, 6),
    'sick':         (3, 4),
    'sing':         (6, 5),
    'evolving':     (8, 6),
    'dying':        (8, 3),
    'dead':         (1, 1),
    'escaping':     (8, 5),
    'transcending': (12, 4),
}


def _shift_image(img, dx, dy):
    """Shift image by (dx, dy) pixels, filling with transparency."""
    result = Image.new('RGBA', img.size, (0, 0, 0, 0))
    result.paste(img, (int(dx), int(dy)))
    return result


def _tint_image(img, factor):
    """Adjust image brightness.

    Args:
        img: PIL Image (RGBA)
        factor: >1 = brighter, <1 = darker
    """
    # Split alpha, adjust RGB, recombine
    r, g, b, a = img.split()
    rgb = Image.merge('RGB', (r, g, b))
    enhancer = ImageEnhance.Brightness(rgb)
    rgb = enhancer.enhance(factor)
    r2, g2, b2 = rgb.split()
    return Image.merge('RGBA', (r2, g2, b2, a))


def _desaturate_image(img, amount=0.5):
    """Desaturate an image.

    Args:
        img: PIL Image (RGBA)
        amount: 0 = original, 1 = fully gray
    """
    pixels = np.array(img, dtype=np.float64)
    gray = 0.299 * pixels[:, :, 0] + 0.587 * pixels[:, :, 1] + 0.114 * pixels[:, :, 2]
    for i in range(3):
        pixels[:, :, i] = pixels[:, :, i] * (1 - amount) + gray * amount
    return Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8), 'RGBA')


def _fade_image(img, alpha_factor):
    """Reduce overall alpha of an image."""
    pixels = np.array(img)
    pixels[:, :, 3] = np.clip(pixels[:, :, 3] * alpha_factor, 0, 255).astype(np.uint8)
    return Image.fromarray(pixels, 'RGBA')


def _scale_image(img, scale):
    """Scale image around center."""
    w, h = img.size
    new_w = max(1, int(w * scale))
    new_h = max(1, int(h * scale))
    scaled = img.resize((new_w, new_h), Image.NEAREST)
    result = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ox = (w - new_w) // 2
    oy = (h - new_h) // 2
    result.paste(scaled, (ox, oy))
    return result


def generate_animation(anim_name, stage, dna_params):
    """Generate all frames for an animation.

    Args:
        anim_name: string animation name
        stage: int 0-7
        dna_params: dict from dna_to_params

    Returns:
        list of PIL Images (frames)
    """
    if anim_name not in ANIMATIONS:
        raise ValueError(f"Unknown animation: {anim_name}")

    frame_count, fps = ANIMATIONS[anim_name]
    frames = []

    for i in range(frame_count):
        t = i / max(1, frame_count - 1)  # 0.0 to 1.0
        frame = _create_canvas()

        if anim_name == 'idle':
            frames.append(_anim_idle(frame, stage, dna_params, i, frame_count))
        elif anim_name == 'happy':
            frames.append(_anim_happy(frame, stage, dna_params, i, frame_count))
        elif anim_name == 'sad':
            frames.append(_anim_sad(frame, stage, dna_params, i, frame_count))
        elif anim_name == 'sleep':
            frames.append(_anim_sleep(frame, stage, dna_params, i, frame_count))
        elif anim_name == 'eat':
            frames.append(_anim_eat(frame, stage, dna_params, i, frame_count))
        elif anim_name == 'play':
            frames.append(_anim_play(frame, stage, dna_params, i, frame_count))
        elif anim_name == 'sick':
            frames.append(_anim_sick(frame, stage, dna_params, i, frame_count))
        elif anim_name == 'sing':
            frames.append(_anim_sing(frame, stage, dna_params, i, frame_count))
        elif anim_name == 'evolving':
            frames.append(_anim_evolving(frame, stage, dna_params, i, frame_count))
        elif anim_name == 'dying':
            frames.append(_anim_dying(frame, stage, dna_params, i, frame_count))
        elif anim_name == 'dead':
            frames.append(_anim_dead(frame, stage, dna_params, i, frame_count))
        elif anim_name == 'escaping':
            frames.append(_anim_escaping(frame, stage, dna_params, i, frame_count))
        elif anim_name == 'transcending':
            frames.append(_anim_transcending(frame, stage, dna_params, i, frame_count))

    return frames


def _anim_idle(frame, stage, dna_params, i, count):
    """Idle: gentle vertical bob (2px up/down)."""
    # Bob offset: sinusoidal
    bob = int(2 * math.sin(i / count * 2 * math.pi))
    draw_stage(stage, frame, dna_params, frame=i)
    return _shift_image(frame, 0, bob)


def _anim_happy(frame, stage, dna_params, i, count):
    """Happy: bigger bob + appendage wave (via frame parameter)."""
    bob = int(3 * math.sin(i / count * 2 * math.pi))
    # Pass frame index so appendages wave faster
    draw_stage(stage, frame, dna_params, frame=i * 3)
    result = _shift_image(frame, 0, bob)
    # Slight brightness boost
    return _tint_image(result, 1.1)


def _anim_sad(frame, stage, dna_params, i, count):
    """Sad: slight tilt + desaturation."""
    draw_stage(stage, frame, dna_params, frame=i)
    # Shift down slightly (drooping)
    result = _shift_image(frame, 0, 1)
    return _desaturate_image(result, 0.4)


def _anim_sleep(frame, stage, dna_params, i, count):
    """Sleep: eyes closing gradually, slower pulse."""
    draw_stage(stage, frame, dna_params, frame=i)
    # Darken progressively
    factor = 0.9 - (i / max(1, count - 1)) * 0.2
    result = _tint_image(frame, factor)
    # Draw "closed eyes" overlay for later stages
    if stage >= 1:
        draw = ImageDraw.Draw(result)
        # Simple eyelid lines at approximate eye positions
        cx, cy = SIZE // 2, SIZE // 2
        close_amount = i / max(1, count - 1)
        if close_amount > 0.3:
            line_y = cy - 5
            draw.line((cx - 8, line_y, cx - 3, line_y), fill=(80, 60, 80, 200), width=1)
            draw.line((cx + 3, line_y, cx + 8, line_y), fill=(80, 60, 80, 200), width=1)
    return result


def _anim_eat(frame, stage, dna_params, i, count):
    """Eat: mouth opening animation."""
    # Use frame to control mouth opening in stage drawing
    draw_stage(stage, frame, dna_params, frame=i)
    # Simulate mouth open by adding a dark ellipse
    if stage >= 1:
        draw = ImageDraw.Draw(frame)
        cx, cy = SIZE // 2, SIZE // 2
        open_amount = math.sin(i / count * math.pi)
        mouth_h = max(1, int(3 * open_amount))
        draw.ellipse((cx - 2, cy + 3, cx + 2, cy + 3 + mouth_h),
                      fill=(30, 10, 30, 230))
    return frame


def _anim_play(frame, stage, dna_params, i, count):
    """Play: bouncy movement."""
    # Bigger bounce
    bounce = int(4 * abs(math.sin(i / count * math.pi)))
    draw_stage(stage, frame, dna_params, frame=i * 4)
    result = _shift_image(frame, 0, -bounce)
    return _tint_image(result, 1.05)


def _anim_sick(frame, stage, dna_params, i, count):
    """Sick: tremor/shake."""
    draw_stage(stage, frame, dna_params, frame=i)
    # Horizontal shake
    shake = int(2 * math.sin(i * math.pi * 2))
    result = _shift_image(frame, shake, 0)
    # Greenish tint
    pixels = np.array(result, dtype=np.float64)
    pixels[:, :, 1] = np.clip(pixels[:, :, 1] * 1.15, 0, 255)  # boost green
    pixels[:, :, 0] = np.clip(pixels[:, :, 0] * 0.85, 0, 255)  # reduce red
    return Image.fromarray(pixels.astype(np.uint8), 'RGBA')


def _anim_sing(frame, stage, dna_params, i, count):
    """Sing: concentric circles expanding from core."""
    draw_stage(stage, frame, dna_params, frame=i * 2)
    cx, cy = SIZE // 2, SIZE // 2
    # Draw expanding rings
    palette = get_palette(dna_params.get('palette_warmth', 128))
    ring_color = (*palette[3], int(120 * (1.0 - i / count)))
    ring_r = 5 + i * 4
    draw = ImageDraw.Draw(frame)
    if ring_r < 30:
        draw.ellipse((cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r),
                      outline=ring_color, width=1)
    return frame


def _anim_evolving(frame, stage, dna_params, i, count):
    """Evolving: bright flash transition."""
    t = i / max(1, count - 1)
    draw_stage(stage, frame, dna_params, frame=i)

    if t < 0.5:
        # Brighten toward flash
        factor = 1.0 + t * 2.0
        return _tint_image(frame, factor)
    else:
        # Fade back from flash
        factor = 3.0 - t * 2.0
        result = _tint_image(frame, max(1.0, factor))
        return result


def _anim_dying(frame, stage, dna_params, i, count):
    """Dying: gradual fade and desaturation."""
    t = i / max(1, count - 1)
    draw_stage(stage, frame, dna_params, frame=0)
    result = _desaturate_image(frame, t * 0.8)
    result = _fade_image(result, 1.0 - t * 0.7)
    return _tint_image(result, 1.0 - t * 0.3)


def _anim_dead(frame, stage, dna_params, i, count):
    """Dead: gray, still, single frame."""
    draw_stage(stage, frame, dna_params, frame=0)
    result = _desaturate_image(frame, 0.9)
    return _tint_image(result, 0.5)


def _anim_escaping(frame, stage, dna_params, i, count):
    """Escaping: float upward, shrink."""
    t = i / max(1, count - 1)
    draw_stage(stage, frame, dna_params, frame=i * 2)
    # Float up
    dy = -int(t * 20)
    result = _shift_image(frame, 0, dy)
    # Shrink
    scale = 1.0 - t * 0.5
    return _scale_image(result, scale)


def _anim_transcending(frame, stage, dna_params, i, count):
    """Transcending: dissolve into light particles."""
    t = i / max(1, count - 1)
    draw_stage(stage, frame, dna_params, frame=i)

    # Gradually fade body
    result = _fade_image(frame, max(0, 1.0 - t * 0.8))

    # Add increasing particles
    palette = get_palette(dna_params.get('palette_warmth', 128))
    particle_count = int(t * 40)
    if particle_count > 0:
        particle_color = (*palette[4], int(200 * (1.0 - t * 0.5)))
        draw_pixel_particles(result, (SIZE // 2, SIZE // 2),
                             particle_count, int(10 + t * 25),
                             particle_color, seed=i * 17)

    # Bright glow increasing
    core_rgb = palette[3]
    result = add_glow(result, (SIZE // 2, SIZE // 2),
                      int(15 + t * 15), core_rgb, 0.2 + t * 0.4)
    return result


def frames_to_spritesheet(frames):
    """Combine animation frames into a horizontal sprite sheet.

    Args:
        frames: list of PIL Images (same size)

    Returns:
        PIL Image (horizontal strip)
    """
    if not frames:
        return Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))

    w, h = frames[0].size
    sheet = Image.new('RGBA', (w * len(frames), h), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.paste(f, (i * w, 0))
    return sheet
