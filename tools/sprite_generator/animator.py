"""
animator.py - Animation frame generation for Lalien sprites.
Generates N frames per animation with appropriate transformations.

Each animation now passes its mood context to the stage renderer,
so eyes, mouth, body posture, and particle effects all reflect
the emotional state of the creature.
"""

import math
from PIL import Image, ImageEnhance, ImageDraw
import numpy as np

from stages import draw_stage, _create_canvas, SIZE
from palettes import get_palette, get_body_colors, desaturate_palette, get_mood_accents
from primitives import (
    draw_pixel_particles, add_glow, add_background_glow, lerp_color,
    draw_sparkle_particles, draw_heart_particles, draw_z_particles,
    draw_concentric_rings, generate_particles, draw_particles,
)


# Animation definitions: name -> (frame_count, fps)
ANIMATIONS = {
    'idle':         (4, 4),
    'happy':        (6, 6),
    'sad':          (4, 3),
    'sleep':        (4, 2),
    'eat':          (4, 5),
    'play':         (6, 6),
    'sick':         (4, 4),
    'sing':         (6, 5),
    'evolving':     (8, 6),
    'dying':        (8, 3),
    'dead':         (1, 1),
    'escaping':     (8, 5),
    'transcending': (12, 4),
    'love':         (6, 5),
    'hungry':       (4, 4),
    'hatching':     (6, 5),
}


def _shift_image(img, dx, dy):
    """Shift image by (dx, dy) pixels, filling with transparency."""
    result = Image.new('RGBA', img.size, (0, 0, 0, 0))
    result.paste(img, (int(dx), int(dy)))
    return result


def _tint_image(img, factor):
    """Adjust image brightness."""
    r, g, b, a = img.split()
    rgb = Image.merge('RGB', (r, g, b))
    enhancer = ImageEnhance.Brightness(rgb)
    rgb = enhancer.enhance(factor)
    r2, g2, b2 = rgb.split()
    return Image.merge('RGBA', (r2, g2, b2, a))


def _desaturate_image(img, amount=0.5):
    """Desaturate an image."""
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


def _apply_green_tint(img, intensity=0.15):
    """Apply greenish sickly tint to an image."""
    pixels = np.array(img, dtype=np.float64)
    mask = pixels[:, :, 3] > 0
    pixels[:, :, 1] = np.where(mask,
        np.clip(pixels[:, :, 1] * (1 + intensity), 0, 255), pixels[:, :, 1])
    pixels[:, :, 0] = np.where(mask,
        np.clip(pixels[:, :, 0] * (1 - intensity * 0.6), 0, 255), pixels[:, :, 0])
    pixels[:, :, 2] = np.where(mask,
        np.clip(pixels[:, :, 2] * (1 - intensity * 0.3), 0, 255), pixels[:, :, 2])
    return Image.fromarray(pixels.astype(np.uint8), 'RGBA')


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

    dispatch = {
        'idle': _anim_idle,
        'happy': _anim_happy,
        'sad': _anim_sad,
        'sleep': _anim_sleep,
        'eat': _anim_eat,
        'play': _anim_play,
        'sick': _anim_sick,
        'sing': _anim_sing,
        'evolving': _anim_evolving,
        'dying': _anim_dying,
        'dead': _anim_dead,
        'escaping': _anim_escaping,
        'transcending': _anim_transcending,
        'love': _anim_love,
        'hungry': _anim_hungry,
        'hatching': _anim_hatching,
    }

    func = dispatch.get(anim_name, _anim_idle)

    for i in range(frame_count):
        frame = _create_canvas()
        frames.append(func(frame, stage, dna_params, i, frame_count))

    return frames


# ---------------------------------------------------------------------------
# Animation functions - each passes mood context to draw_stage
# ---------------------------------------------------------------------------

def _anim_idle(frame, stage, dna_params, i, count):
    """Idle: gentle breathing bob with subtle size oscillation."""
    # Smooth sinusoidal bob
    bob = int(2 * math.sin(i / max(1, count) * 2 * math.pi))
    draw_stage(stage, frame, dna_params, frame=i, mood='neutral')
    return _shift_image(frame, 0, bob)


def _anim_happy(frame, stage, dna_params, i, count):
    """Happy: bouncy movement with sparkles, smile eyes, arms up."""
    # Bigger, bouncier bob
    bob = int(3 * abs(math.sin(i / max(1, count) * math.pi)))
    draw_stage(stage, frame, dna_params, frame=i, mood='happy')
    result = _shift_image(frame, 0, -bob)  # bounce UP
    # Warm brightness boost
    return _tint_image(result, 1.08)


def _anim_sad(frame, stage, dna_params, i, count):
    """Sad: slow sway, drooping, desaturated, tears from eyes."""
    # Slow side-to-side sway
    sway = int(1.5 * math.sin(i / max(1, count) * math.pi * 2))
    draw_stage(stage, frame, dna_params, frame=i, mood='sad')
    result = _shift_image(frame, sway, 1)  # sink down slightly
    # Blue-tinted desaturation
    result = _desaturate_image(result, 0.3)
    return _tint_image(result, 0.92)


def _anim_sleep(frame, stage, dna_params, i, count):
    """Sleep: closed eyes, gentle breathing rhythm, Z particles."""
    # Very gentle rise/fall (breathing)
    breath = int(1 * math.sin(i / max(1, count) * 2 * math.pi))
    draw_stage(stage, frame, dna_params, frame=i, mood='sleep')
    result = _shift_image(frame, 0, breath)
    # Darken (nighttime feel)
    result = _tint_image(result, 0.82)
    # Slight blue cast
    pixels = np.array(result, dtype=np.float64)
    mask = pixels[:, :, 3] > 0
    pixels[:, :, 2] = np.where(mask,
        np.clip(pixels[:, :, 2] * 1.08, 0, 255), pixels[:, :, 2])
    return Image.fromarray(pixels.astype(np.uint8), 'RGBA')


def _anim_eat(frame, stage, dna_params, i, count):
    """Eat: chomping motion with open mouth, satisfying."""
    # Bob toward food (forward/down)
    chomp = int(2 * abs(math.sin(i / max(1, count) * math.pi * 2)))
    draw_stage(stage, frame, dna_params, frame=i, mood='eat')
    result = _shift_image(frame, 0, chomp)
    # Slight warm tint (satisfaction)
    return _tint_image(result, 1.03)


def _anim_play(frame, stage, dna_params, i, count):
    """Play: energetic bouncing, dynamic poses."""
    # Big bounce + horizontal movement
    bounce = int(4 * abs(math.sin(i / max(1, count) * math.pi)))
    side_move = int(2 * math.sin(i / max(1, count) * math.pi * 2))
    draw_stage(stage, frame, dna_params, frame=i * 4, mood='play')
    result = _shift_image(frame, side_move, -bounce)
    return _tint_image(result, 1.06)


def _anim_sick(frame, stage, dna_params, i, count):
    """Sick: tremor/shake, green tint, spiral eyes, sweat drop."""
    draw_stage(stage, frame, dna_params, frame=i, mood='sick')
    # Irregular tremor
    shake_x = int(2 * math.sin(i * math.pi * 2.5))
    shake_y = int(1 * math.cos(i * math.pi * 1.5))
    result = _shift_image(frame, shake_x, shake_y)
    # Sickly green tint
    result = _apply_green_tint(result, 0.12)
    return _tint_image(result, 0.93)


def _anim_sing(frame, stage, dna_params, i, count):
    """Sing: gentle sway with sound wave rings and music notes."""
    # Rhythmic sway
    sway = int(1 * math.sin(i / max(1, count) * math.pi * 2))
    draw_stage(stage, frame, dna_params, frame=i * 2, mood='sing')
    result = _shift_image(frame, sway, 0)

    # Expanding concentric rings (sound waves)
    cx, cy = SIZE // 2, SIZE // 2
    palette = get_palette(dna_params.get('palette_warmth', 128))
    ring_color = palette.get('glow_color', palette.get('core_outer', (200, 160, 255)))
    draw_concentric_rings(result, (cx, cy + 2), 25, ring_color,
                          count=3, phase=(i / max(1, count)))

    return _tint_image(result, 1.04)


def _anim_evolving(frame, stage, dna_params, i, count):
    """Evolving: dramatic glow buildup, flash, then new form revealed."""
    t = i / max(1, count - 1)
    draw_stage(stage, frame, dna_params, frame=i, mood='evolving')

    if t < 0.4:
        # Build up: increasing glow
        factor = 1.0 + t * 2.5
        result = _tint_image(frame, factor)
        # Add growing glow
        palette = get_palette(dna_params.get('palette_warmth', 128))
        glow_rgb = palette.get('core_inner', (255, 240, 200))
        result = add_glow(result, (SIZE // 2, SIZE // 2),
                          int(10 + t * 20), glow_rgb, t * 0.5)
        return result
    elif t < 0.6:
        # Peak flash (near white)
        return _tint_image(frame, 2.5)
    else:
        # Fade back, reveal
        factor = 2.5 - (t - 0.6) * 3.5
        result = _tint_image(frame, max(1.0, factor))
        # Particle burst
        particle_count = int((1.0 - t) * 20)
        if particle_count > 0:
            palette = get_palette(dna_params.get('palette_warmth', 128))
            p_color = (*palette.get('particle_color', (255, 220, 140)), 180)
            particles = generate_particles(
                (SIZE // 2, SIZE // 2), particle_count, 20,
                p_color, seed=i * 13, upward_bias=0.3
            )
            result = draw_particles(result, particles, phase=0.2)
        return result


def _anim_dying(frame, stage, dna_params, i, count):
    """Dying: dignified fade with desaturation, sinking, dimming light."""
    t = i / max(1, count - 1)
    draw_stage(stage, frame, dna_params, frame=0, mood='dying')

    # Gradual desaturation
    result = _desaturate_image(frame, t * 0.85)
    # Slow fade
    result = _fade_image(result, 1.0 - t * 0.65)
    # Dim
    result = _tint_image(result, 1.0 - t * 0.35)
    # Sink downward
    sink = int(t * 4)
    result = _shift_image(result, 0, sink)
    return result


def _anim_dead(frame, stage, dna_params, i, count):
    """Dead: gray, still, single frame. Dignified silence."""
    draw_stage(stage, frame, dna_params, frame=0, mood='dying')
    result = _desaturate_image(frame, 0.9)
    result = _tint_image(result, 0.45)
    return _shift_image(result, 0, 3)  # settled down


def _anim_escaping(frame, stage, dna_params, i, count):
    """Escaping: float upward, shrink, trail of particles."""
    t = i / max(1, count - 1)
    draw_stage(stage, frame, dna_params, frame=i * 2, mood='neutral')
    # Float up
    dy = -int(t * 22)
    result = _shift_image(frame, 0, dy)
    # Shrink
    scale = 1.0 - t * 0.5
    result = _scale_image(result, scale)
    # Fade slightly
    result = _fade_image(result, 1.0 - t * 0.3)
    return result


def _anim_transcending(frame, stage, dna_params, i, count):
    """Transcending: dissolve into light particles, cosmic beauty."""
    t = i / max(1, count - 1)
    draw_stage(stage, frame, dna_params, frame=i, mood='transcending')

    # Gradually fade body
    result = _fade_image(frame, max(0.05, 1.0 - t * 0.85))

    # Increasing particle emission
    palette = get_palette(dna_params.get('palette_warmth', 128))
    particle_count = int(t * 45)
    if particle_count > 0:
        p_color = (*palette.get('particle_color', (220, 240, 255)), int(200 * (1.0 - t * 0.4)))
        particles = generate_particles(
            (SIZE // 2, SIZE // 2), particle_count, int(12 + t * 25),
            p_color, seed=i * 17, upward_bias=0.4 + t * 0.3
        )
        result = draw_particles(result, particles, phase=(i % 4) / 4.0)

    # Bright expanding glow
    core_rgb = palette.get('core_inner', (230, 220, 255))
    result = add_glow(result, (SIZE // 2, SIZE // 2),
                      int(15 + t * 18), core_rgb, 0.2 + t * 0.45)
    return result


def _anim_love(frame, stage, dna_params, i, count):
    """Love: heart eyes, floating hearts, warm pink tint, gentle float."""
    bob = int(2 * math.sin(i / max(1, count) * 2 * math.pi))
    draw_stage(stage, frame, dna_params, frame=i, mood='love')
    result = _shift_image(frame, 0, -abs(bob))  # float up
    # Warm pink tint
    pixels = np.array(result, dtype=np.float64)
    mask = pixels[:, :, 3] > 0
    pixels[:, :, 0] = np.where(mask,
        np.clip(pixels[:, :, 0] * 1.06, 0, 255), pixels[:, :, 0])
    pixels[:, :, 2] = np.where(mask,
        np.clip(pixels[:, :, 2] * 1.04, 0, 255), pixels[:, :, 2])
    return Image.fromarray(pixels.astype(np.uint8), 'RGBA')


def _anim_hungry(frame, stage, dna_params, i, count):
    """Hungry: half-lidded eyes looking sideways, slight lean."""
    lean = int(1 * math.sin(i / max(1, count) * math.pi * 2))
    draw_stage(stage, frame, dna_params, frame=i, mood='hungry')
    result = _shift_image(frame, lean, 0)
    # Slightly desaturated (energy loss)
    return _desaturate_image(result, 0.12)


def _anim_hatching(frame, stage, dna_params, i, count):
    """Hatching: egg cracks, shakes, then burst of light."""
    t = i / max(1, count - 1)

    if t < 0.7:
        # Shaking egg with cracks
        shake = int(2 * math.sin(i * math.pi * 3) * t)
        draw_stage(0, frame, dna_params, frame=i, mood='hatching')
        result = _shift_image(frame, shake, 0)
        return result
    else:
        # Burst of light
        draw_stage(0, frame, dna_params, frame=i, mood='hatching')
        factor = 1.0 + (t - 0.7) * 6.0
        result = _tint_image(frame, factor)
        # Add particle burst
        palette = get_palette(dna_params.get('palette_warmth', 128))
        p_color = (*palette.get('particle_color', (255, 240, 200)), 220)
        burst_count = int((t - 0.7) * 30)
        if burst_count > 0:
            particles = generate_particles(
                (SIZE // 2, SIZE // 2), burst_count, 15,
                p_color, seed=i * 11, upward_bias=0.2
            )
            result = draw_particles(result, particles, phase=0.3)
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
