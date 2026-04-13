"""
stages.py - Drawing functions for each Lalien developmental stage.
Each stage function draws the creature on a 64x64 RGBA canvas at 2x resolution
then downsamples for anti-aliased pixel art.

Stages:
  0 - Syrma (Egg): cosmic egg with spiral energy, bioluminescent veins
  1 - Lali-na (Newborn): tiny helpless blob, huge eyes, translucent core
  2 - Lali-shi (Infant): growing curiosity, first appendages, eyebrow ridges
  3 - Lali-ko (Child): personality emerging, 4 appendages, expressive face
  4 - Lali-ren (Teen): awkward grace, long flowing tentacles, body patterns
  5 - Lali-vox (Adult): full beauty, all DNA at max, bioluminescent tips
  6 - Lali-mere (Sage): noble wisdom, desaturated, luminous aura
  7 - Lali-thishi (Transcendence): ethereal dissolving form
"""

import math
from PIL import Image, ImageDraw
import numpy as np

from primitives import (
    draw_body_blob, draw_eye, draw_eye_pair, draw_appendage,
    draw_mouth, draw_eyebrow_ridges,
    add_outline, add_glow, add_background_glow,
    pulse_core, draw_core_behind_body,
    draw_pixel_particles, draw_particles, generate_particles,
    draw_spiral, draw_veins, draw_body_pattern,
    draw_concentric_rings,
    apply_membrane_texture,
    lerp_color, create_hires_canvas, downsample, s,
    RENDER_SCALE,
)
from palettes import (
    get_palette, get_body_colors, desaturate_palette,
    apply_mood_shift, sage_palette, transcendence_palette,
)
from dna import params_for_stage


SIZE = 64
CENTER_X = SIZE // 2
CENTER_Y = SIZE // 2
HSIZE = SIZE * RENDER_SCALE
HCENTER_X = HSIZE // 2
HCENTER_Y = HSIZE // 2


def _create_canvas():
    """Create a blank 64x64 RGBA canvas."""
    return Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))


def _hue_to_rgb(hue):
    """Convert hue (0-360) to an RGB tuple."""
    h = (hue % 360) / 60.0
    c = 200
    x = int(c * (1 - abs(h % 2 - 1)))
    c = int(c)
    if h < 1: return (c, x, 0)
    elif h < 2: return (x, c, 0)
    elif h < 3: return (0, c, x)
    elif h < 4: return (0, x, c)
    elif h < 5: return (x, 0, c)
    else: return (c, 0, x)


# ===== STAGE 0: Syrma (Egg) =====

def draw_stage_0(img, dna_params, frame=0, mood='neutral'):
    """Draw Stage 0 - Syrma (Cosmic Egg).

    A beautiful cosmic egg with:
    - Spiral galaxy energy pattern inside
    - Bioluminescent veins on the shell surface
    - Inner glow pulsing from the forming core
    - Small sparkle particles floating around
    """
    p = params_for_stage(dna_params, 0)
    palette = get_palette(p['palette_warmth'])
    if mood != 'neutral':
        palette = apply_mood_shift(palette, mood)
    colors = get_body_colors(palette)
    core_rgb = _hue_to_rgb(p['core_hue'])

    # Work at 2x for anti-aliasing
    hi = create_hires_canvas()
    hcx, hcy = HCENTER_X, HCENTER_Y

    egg_w = s(int(15 * p['body_width']))
    egg_h = s(int(22 * p['body_height']))

    # Background aura glow (behind egg)
    hi = add_background_glow(hi, (hcx, hcy), egg_w + s(8), core_rgb, 0.15)

    # Egg shell (layered for depth)
    draw_body_blob(hi, hcx, hcy, egg_w, egg_h, colors['body_dark'],
                   irregularity=0.05, seed=p['symmetry_seed'])
    draw_body_blob(hi, hcx, hcy, egg_w - s(1), egg_h - s(1), colors['body'],
                   irregularity=0.03, seed=p['symmetry_seed'])
    # Highlight layer (upper half brighter)
    draw_body_blob(hi, hcx, hcy - egg_h // 4, int(egg_w * 0.75),
                   int(egg_h * 0.5), colors['body_light'],
                   irregularity=0.02, seed=p['symmetry_seed'] + 1)

    # Bioluminescent veins on shell
    vein_color = (*core_rgb, 60)
    draw_veins(hi, hcx, hcy, egg_w, egg_h, vein_color, count=6,
               seed=p['symmetry_seed'])

    # Spiral galaxy energy pattern inside
    phase = frame * 0.3
    spiral_color = (*palette['core_inner'], 90)
    draw_spiral(hi, hcx, hcy, min(egg_w, egg_h) * 0.65, spiral_color,
                turns=2.5, phase=phase, point_count=30)

    # Pulsating core (forming inside)
    core_phase = (frame % 8) / 8.0
    hi = pulse_core(hi, (hcx, hcy + s(2)), int(egg_w * 0.35),
                    core_rgb, core_phase, intensity=0.6)

    # Inner glow
    hi = add_glow(hi, (hcx, hcy), egg_w, core_rgb, 0.25)

    # Membrane texture
    hi = apply_membrane_texture(hi, intensity=0.06, seed=p['symmetry_seed'])

    # Outline
    hi = add_outline(hi, colors['outline'], inner_color=colors['inner'])

    # Downsample to 64x64
    result = downsample(hi)

    # Sparkle particles (drawn at final resolution for crispness)
    sparkle_color = (*palette['particle_color'], 180)
    particles = generate_particles(
        (CENTER_X, CENTER_Y), 6, int(15 * p['body_width']) + 5,
        sparkle_color, seed=p['symmetry_seed'] + frame,
        upward_bias=0.3
    )
    result = draw_particles(result, particles, phase=(frame % 4) / 4.0)

    img.paste(result, (0, 0))
    return img


# ===== STAGE 1: Lali-na (Newborn) =====

def draw_stage_1(img, dna_params, frame=0, mood='neutral'):
    """Draw Stage 1 - Lali-na (Newborn).

    Tiny helpless blob that triggers protective instinct:
    - HUGE expressive eyes (30%+ of face) with catch-lights
    - Translucent body showing core through skin
    - Tiny quivering mouth
    - Soft, rounded proportions
    """
    p = params_for_stage(dna_params, 1)
    palette = get_palette(p['palette_warmth'])
    if mood != 'neutral':
        palette = apply_mood_shift(palette, mood)
    colors = get_body_colors(palette, alpha_body=170)  # more translucent
    core_rgb = _hue_to_rgb(p['core_hue'])

    hi = create_hires_canvas()
    hcx, hcy = HCENTER_X, HCENTER_Y + s(3)

    body_w = s(int(17 * p['body_width']))
    body_h = s(int(15 * p['body_height']))

    # Body layer (drawn separately for translucency compositing)
    body_layer = Image.new('RGBA', (HSIZE, HSIZE), (0, 0, 0, 0))

    # Rounded blobby body
    draw_body_blob(body_layer, hcx, hcy, body_w, body_h, colors['body'],
                   squash=0.1, irregularity=0.06, seed=p['symmetry_seed'])
    # Head region (slightly above, lighter)
    head_h = int(body_h * 0.65)
    head_w = int(body_w * 0.9)
    draw_body_blob(body_layer, hcx, hcy - int(body_h * 0.25), head_w, head_h,
                   colors['body_light'], irregularity=0.04,
                   seed=p['symmetry_seed'] + 1)

    # Core glow showing through body (translucency)
    core_phase = (frame % 8) / 8.0
    hi = draw_core_behind_body(
        body_layer, (hcx, hcy + s(2)), int(body_w * 0.4),
        core_rgb, core_phase, body_alpha_factor=0.4
    )

    # Soft outer glow
    hi = add_glow(hi, (hcx, hcy), body_w + s(3), core_rgb, 0.3)

    # Membrane texture
    hi = apply_membrane_texture(hi, intensity=0.05, seed=p['symmetry_seed'])

    # HUGE eyes (at least 30% of face)
    eye_radius = s(3 + p['eye_size'] + 1)  # bigger than before
    eye_y = hcy - int(body_h * 0.2)
    eye_spacing = int(body_w * p['eye_spacing'])

    blink = 0.0
    if frame % 16 == 0:  # occasional blink
        blink = 0.8

    eye_mood = mood if mood in ('happy', 'sad', 'closed') else 'neutral'
    draw_eye_pair(hi, hcx, eye_y, body_w, 0, eye_radius,
                  p['eye_spacing'], colors, mood=eye_mood, blink=blink,
                  iris_color=colors.get('eye_iris'))

    # Tiny mouth
    mouth_y = hcy + int(body_h * 0.15)
    mouth_mood = mood if mood in ('happy', 'sad', 'open') else 'neutral'
    draw_mouth(hi, hcx, mouth_y, s(p['mouth_size'] + 2), s(2),
               color=(*palette['outline'], 180), mood=mouth_mood)

    # Outline
    hi = add_outline(hi, colors['outline'], inner_color=colors['inner'])

    result = downsample(hi)

    # Subtle body pulsation particles
    if frame % 3 == 0:
        sparkle = (*palette['particle_color'], 140)
        particles = generate_particles(
            (CENTER_X, CENTER_Y + 2), 3, int(17 * p['body_width']),
            sparkle, seed=p['symmetry_seed'] + frame, upward_bias=0.2
        )
        result = draw_particles(result, particles, phase=0.3)

    img.paste(result, (0, 0))
    return img


# ===== STAGE 2: Lali-shi (Infant) =====

def draw_stage_2(img, dna_params, frame=0, mood='neutral'):
    """Draw Stage 2 - Lali-shi (Infant).

    Growing curiosity:
    - Still huge eyes with visible iris colors from DNA
    - First tiny tentacle-appendages sprouting
    - More structured body
    - Expressive eyebrow-ridges
    """
    p = params_for_stage(dna_params, 2)
    palette = get_palette(p['palette_warmth'])
    if mood != 'neutral':
        palette = apply_mood_shift(palette, mood)
    colors = get_body_colors(palette, alpha_body=180)
    core_rgb = _hue_to_rgb(p['core_hue'])

    hi = create_hires_canvas()
    hcx, hcy = HCENTER_X, HCENTER_Y + s(2)

    body_w = s(int(16 * p['body_width']))
    body_h = s(int(17 * p['body_height']))

    # Body layers
    body_layer = Image.new('RGBA', (HSIZE, HSIZE), (0, 0, 0, 0))
    draw_body_blob(body_layer, hcx, hcy, body_w, body_h, colors['body'],
                   squash=0.08, irregularity=0.05, seed=p['symmetry_seed'])
    # Head region
    draw_body_blob(body_layer, hcx, hcy - int(body_h * 0.3),
                   int(body_w * 0.85), int(body_h * 0.55),
                   colors['body_light'], irregularity=0.03,
                   seed=p['symmetry_seed'] + 1)

    # Core behind body
    core_phase = (frame % 8) / 8.0
    hi = draw_core_behind_body(
        body_layer, (hcx, hcy + s(2)), int(body_w * 0.35),
        core_rgb, core_phase, body_alpha_factor=0.35
    )

    hi = add_glow(hi, (hcx, hcy), body_w + s(2), core_rgb, 0.3)

    # Membrane texture
    hi = apply_membrane_texture(hi, intensity=0.06, seed=p['symmetry_seed'])

    # 2 small appendages (sprouting)
    wave_phase = frame * 0.15
    for side_val in [-1, 1]:
        ax = hcx + side_val * body_w
        ay = hcy + int(body_h * 0.3)
        angle = side_val * 0.7
        app_len = s(5 + p['appendage_length'] * 2)
        draw_appendage(hi, ax, ay, app_len, angle, s(2),
                       colors['appendage'], colors['appendage_tip'],
                       curl=0.3, wave_phase=wave_phase)

    # Huge eyes with iris color
    eye_radius = s(3 + p['eye_size'] + 1)
    eye_y_off = -int(body_h * 0.18)

    blink = 0.0
    if frame % 12 == 0:
        blink = 0.7

    eye_mood = mood if mood in ('happy', 'sad', 'closed') else 'neutral'
    draw_eye_pair(hi, hcx, hcy, body_w, eye_y_off, eye_radius,
                  p['eye_spacing'], colors, mood=eye_mood, blink=blink,
                  iris_color=colors.get('eye_iris'))

    # Eyebrow ridges
    brow_color = (*palette['body_shadow'], 150)
    brow_mood = mood if mood in ('happy', 'sad', 'angry') else 'neutral'
    draw_eyebrow_ridges(hi, hcx, hcy, body_w, eye_y_off, p['eye_spacing'],
                        brow_color, mood=brow_mood)

    # Mouth
    mouth_y = hcy + int(body_h * 0.18)
    mouth_mood = mood if mood in ('happy', 'sad', 'open') else 'neutral'
    draw_mouth(hi, hcx, mouth_y, s(p['mouth_size'] + 2), s(2),
               color=(*palette['outline'], 180), mood=mouth_mood)

    # Outline
    hi = add_outline(hi, colors['outline'], inner_color=colors['inner'])

    result = downsample(hi)
    img.paste(result, (0, 0))
    return img


# ===== STAGE 3: Lali-ko (Child) =====

def draw_stage_3(img, dna_params, frame=0, mood='neutral'):
    """Draw Stage 3 - Lali-ko (Child).

    Personality emerging:
    - Elongated body with head/torso distinction
    - 4 developed appendages with individual movement
    - Expressive face: eyebrow ridges, smile/frown
    - Prominent core pulsing with mood colors
    """
    p = params_for_stage(dna_params, 3)
    palette = get_palette(p['palette_warmth'])
    if mood != 'neutral':
        palette = apply_mood_shift(palette, mood)
    colors = get_body_colors(palette, alpha_body=190)
    core_rgb = _hue_to_rgb(p['core_hue'])

    hi = create_hires_canvas()
    hcx, hcy = HCENTER_X, HCENTER_Y + s(1)

    body_w = s(int(14 * p['body_width']))
    body_h = s(int(21 * p['body_height']))

    # Body layers
    body_layer = Image.new('RGBA', (HSIZE, HSIZE), (0, 0, 0, 0))
    # Torso
    draw_body_blob(body_layer, hcx, hcy, body_w, body_h, colors['body'],
                   squash=0.12, irregularity=0.04, seed=p['symmetry_seed'])
    # Head (distinct from torso)
    head_y = hcy - int(body_h * 0.32)
    head_w = int(body_w * 0.85)
    head_h = int(body_h * 0.5)
    draw_body_blob(body_layer, hcx, head_y, head_w, head_h,
                   colors['body_light'], irregularity=0.03,
                   seed=p['symmetry_seed'] + 1)

    # Core behind body
    core_phase = (frame % 8) / 8.0
    hi = draw_core_behind_body(
        body_layer, (hcx, hcy + s(3)), int(body_w * 0.35),
        core_rgb, core_phase, body_alpha_factor=0.3
    )

    hi = add_glow(hi, (hcx, hcy), body_w + s(2), core_rgb, 0.25)

    # Membrane texture
    hi = apply_membrane_texture(hi, intensity=0.07, seed=p['symmetry_seed'])

    # 4 appendages with individual movement
    wave_phase = frame * 0.12
    app_count = min(4, max(2, p['appendage_count']))
    app_len = s(8 + p['appendage_length'] * 3)
    positions = [
        (-1, 0.05, -0.5, 0.0),
        (1, 0.05, 0.5, 0.3),
        (-1, 0.45, -0.9, 0.5),
        (1, 0.45, 0.9, 0.8),
    ]
    for i, (side, y_frac, base_angle, phase_off) in enumerate(positions[:app_count]):
        ax = hcx + side * body_w
        ay = hcy + int(body_h * y_frac)
        draw_appendage(hi, ax, ay, app_len, base_angle, s(2),
                       colors['appendage'], colors['appendage_tip'],
                       curl=0.35, wave_phase=wave_phase + phase_off)

    # Eyes
    eye_radius = s(2 + p['eye_size'] + 1)
    eye_y_off = -int(body_h * 0.25)
    blink = 0.0
    if frame % 14 == 0:
        blink = 0.6

    eye_mood = mood if mood in ('happy', 'sad', 'closed') else 'neutral'
    draw_eye_pair(hi, hcx, hcy, body_w, eye_y_off, eye_radius,
                  p['eye_spacing'], colors, mood=eye_mood, blink=blink,
                  iris_color=colors.get('eye_iris'))

    # Eyebrow ridges
    brow_color = (*palette['body_shadow'], 140)
    brow_mood = mood if mood in ('happy', 'sad', 'angry') else 'neutral'
    draw_eyebrow_ridges(hi, hcx, hcy, body_w, eye_y_off, p['eye_spacing'],
                        brow_color, mood=brow_mood)

    # Mouth
    mouth_y = hcy + int(body_h * 0.02)
    mouth_mood = mood if mood in ('happy', 'sad', 'open') else 'neutral'
    draw_mouth(hi, hcx, mouth_y, s(p['mouth_size'] + 3), s(2),
               color=(*palette['outline'], 170), mood=mouth_mood)

    hi = add_outline(hi, colors['outline'], inner_color=colors['inner'])

    result = downsample(hi)
    img.paste(result, (0, 0))
    return img


# ===== STAGE 4: Lali-ren (Teen) =====

def draw_stage_4(img, dna_params, frame=0, mood='neutral'):
    """Draw Stage 4 - Lali-ren (Teen).

    Awkward grace:
    - Taller, slimmer proportions
    - Long flowing appendages (tentacle-fins)
    - Core sends light pulses through translucent body
    - Body patterns emerge from DNA
    """
    p = params_for_stage(dna_params, 4)
    palette = get_palette(p['palette_warmth'])
    if mood != 'neutral':
        palette = apply_mood_shift(palette, mood)
    colors = get_body_colors(palette, alpha_body=185)
    core_rgb = _hue_to_rgb(p['core_hue'])

    hi = create_hires_canvas()
    hcx, hcy = HCENTER_X, HCENTER_Y

    body_w = s(int(13 * p['body_width']))
    body_h = s(int(24 * p['body_height']))

    # Taller slimmer body
    body_layer = Image.new('RGBA', (HSIZE, HSIZE), (0, 0, 0, 0))
    draw_body_blob(body_layer, hcx, hcy, body_w, body_h, colors['body'],
                   squash=0.15, irregularity=0.03, seed=p['symmetry_seed'])
    # Head region
    head_y = hcy - int(body_h * 0.3)
    draw_body_blob(body_layer, hcx, head_y, int(body_w * 0.85),
                   int(body_h * 0.42), colors['body_light'],
                   irregularity=0.02, seed=p['symmetry_seed'] + 1)

    # Body patterns (stripes/spots/swirls from DNA)
    pattern_type = p['core_pattern']
    pattern_color = (*palette['pattern_color'], 80)
    draw_body_pattern(body_layer, hcx, hcy, body_w, body_h,
                      pattern_type, pattern_color, seed=p['symmetry_seed'])

    # Core behind body with stronger translucency
    core_phase = (frame % 8) / 8.0
    hi = draw_core_behind_body(
        body_layer, (hcx, hcy + s(4)), int(body_w * 0.4),
        core_rgb, core_phase, body_alpha_factor=0.35
    )

    hi = add_glow(hi, (hcx, hcy), body_w + s(4), core_rgb, 0.35)

    hi = apply_membrane_texture(hi, intensity=0.07, seed=p['symmetry_seed'])

    # Long flowing appendages with tip glow
    wave_phase = frame * 0.1
    app_len = s(12 + p['appendage_length'] * 4)
    positions = [
        (-1, -0.05, -0.4, 0.0),
        (1, -0.05, 0.4, 0.25),
        (-1, 0.2, -0.7, 0.5),
        (1, 0.2, 0.7, 0.75),
        (-1, 0.45, -1.0, 0.33),
        (1, 0.45, 1.0, 0.66),
    ]
    for i, (side, y_frac, base_angle, phase_off) in enumerate(
            positions[:p['appendage_count']]):
        ax = hcx + side * body_w
        ay = hcy + int(body_h * y_frac)
        draw_appendage(hi, ax, ay, app_len, base_angle, s(2),
                       colors['appendage'], colors['appendage_tip'],
                       curl=0.4, wave_phase=wave_phase + phase_off,
                       tip_glow_color=colors.get('tip_glow'))

    # Eyes (more complex)
    eye_radius = s(2 + p['eye_size'] + 1)
    eye_y_off = -int(body_h * 0.27)
    blink = 0.8 if frame % 16 == 0 else 0.0
    eye_mood = mood if mood in ('happy', 'sad', 'closed') else 'neutral'
    draw_eye_pair(hi, hcx, hcy, body_w, eye_y_off, eye_radius,
                  p['eye_spacing'], colors, mood=eye_mood, blink=blink,
                  iris_color=colors.get('eye_iris'))

    # Eyebrow ridges
    brow_color = (*palette['body_shadow'], 130)
    brow_mood = mood if mood in ('happy', 'sad', 'angry') else 'neutral'
    draw_eyebrow_ridges(hi, hcx, hcy, body_w, eye_y_off, p['eye_spacing'],
                        brow_color, mood=brow_mood)

    # Mouth
    mouth_y = hcy - int(body_h * 0.02)
    mouth_mood = mood if mood in ('happy', 'sad', 'open') else 'neutral'
    draw_mouth(hi, hcx, mouth_y, s(p['mouth_size'] + 3), s(3),
               color=(*palette['outline'], 160), mood=mouth_mood)

    hi = add_outline(hi, colors['outline'], inner_color=colors['inner'])

    result = downsample(hi)
    img.paste(result, (0, 0))
    return img


# ===== STAGE 5: Lali-vox (Adult) =====

def draw_stage_5(img, dna_params, frame=0, mood='neutral'):
    """Draw Stage 5 - Lali-vox (Adult).

    Full beauty:
    - Elegant, balanced form
    - All DNA features at maximum expression
    - Flowing appendages with bioluminescent tip dots
    - Rich saturated palette, complex core patterns
    """
    p = params_for_stage(dna_params, 5)
    palette = get_palette(p['palette_warmth'])
    if mood != 'neutral':
        palette = apply_mood_shift(palette, mood)
    colors = get_body_colors(palette, alpha_body=190)
    core_rgb = _hue_to_rgb(p['core_hue'])

    hi = create_hires_canvas()
    hcx, hcy = HCENTER_X, HCENTER_Y

    body_w = s(int(14 * p['body_width']))
    body_h = s(int(25 * p['body_height']))

    # Layered body for depth
    body_layer = Image.new('RGBA', (HSIZE, HSIZE), (0, 0, 0, 0))
    draw_body_blob(body_layer, hcx, hcy, body_w, body_h, colors['body_dark'],
                   squash=0.12, irregularity=0.03, seed=p['symmetry_seed'])
    draw_body_blob(body_layer, hcx, hcy, int(body_w * 0.93),
                   int(body_h * 0.93), colors['body'],
                   irregularity=0.02, seed=p['symmetry_seed'])
    # Head
    head_y = hcy - int(body_h * 0.27)
    draw_body_blob(body_layer, hcx, head_y, int(body_w * 0.82),
                   int(body_h * 0.43), colors['body_light'],
                   irregularity=0.02, seed=p['symmetry_seed'] + 1)

    # Body patterns at full expression
    pattern_type = p['core_pattern']
    pattern_color = (*palette['pattern_color'], 90)
    draw_body_pattern(body_layer, hcx, hcy, body_w, body_h,
                      pattern_type, pattern_color, seed=p['symmetry_seed'])

    # Strong core with translucency
    core_phase = (frame % 8) / 8.0
    hi = draw_core_behind_body(
        body_layer, (hcx, hcy + s(3)), int(body_w * 0.45),
        core_rgb, core_phase, body_alpha_factor=0.4
    )

    hi = add_glow(hi, (hcx, hcy), body_w + s(5), core_rgb, 0.4)

    hi = apply_membrane_texture(hi, intensity=0.08, seed=p['symmetry_seed'])

    # Full appendages with bioluminescent tips
    wave_phase = frame * 0.1
    app_len = s(14 + p['appendage_length'] * 4)
    positions = [
        (-1, -0.1, -0.35, 0.0),
        (1, -0.1, 0.35, 0.2),
        (-1, 0.12, -0.6, 0.4),
        (1, 0.12, 0.6, 0.6),
        (-1, 0.35, -0.9, 0.3),
        (1, 0.35, 0.9, 0.7),
    ]
    for i, (side, y_frac, base_angle, phase_off) in enumerate(
            positions[:p['appendage_count']]):
        ax = hcx + side * body_w
        ay = hcy + int(body_h * y_frac)
        draw_appendage(hi, ax, ay, app_len, base_angle, s(2),
                       colors['appendage'], colors['appendage_tip'],
                       curl=0.4, wave_phase=wave_phase + phase_off,
                       tip_glow_color=colors.get('tip_glow'))

    # Detailed eyes
    eye_radius = s(2 + p['eye_size'] + 1)
    eye_y_off = -int(body_h * 0.27)
    blink = 0.7 if frame % 18 == 0 else 0.0
    eye_mood = mood if mood in ('happy', 'sad', 'closed') else 'neutral'
    draw_eye_pair(hi, hcx, hcy, body_w, eye_y_off, eye_radius,
                  p['eye_spacing'], colors, mood=eye_mood, blink=blink,
                  iris_color=colors.get('eye_iris'))

    # Eyebrow ridges
    brow_color = (*palette['body_shadow'], 120)
    brow_mood = mood if mood in ('happy', 'sad', 'angry') else 'neutral'
    draw_eyebrow_ridges(hi, hcx, hcy, body_w, eye_y_off, p['eye_spacing'],
                        brow_color, mood=brow_mood)

    # Mouth
    mouth_y = hcy - int(body_h * 0.03)
    mouth_mood = mood if mood in ('happy', 'sad', 'open') else 'neutral'
    draw_mouth(hi, hcx, mouth_y, s(p['mouth_size'] + 3), s(3),
               color=(*palette['outline'], 150), mood=mouth_mood)

    hi = add_outline(hi, colors['outline'], inner_color=colors['inner'])

    result = downsample(hi)
    img.paste(result, (0, 0))
    return img


# ===== STAGE 6: Lali-mere (Sage) =====

def draw_stage_6(img, dna_params, frame=0, mood='neutral'):
    """Draw Stage 6 - Lali-mere (Sage).

    Noble wisdom:
    - Slightly smaller, more compact
    - Deep reflective eyes
    - Desaturated noble palette (silver, deep blue, muted gold)
    - Luminous aura around body
    - Slow deliberate appendage movement
    """
    p = params_for_stage(dna_params, 6)
    palette = sage_palette(get_palette(p['palette_warmth']))
    if mood != 'neutral':
        palette = apply_mood_shift(palette, mood)
    colors = get_body_colors(palette, alpha_body=200)
    core_rgb = _hue_to_rgb(p['core_hue'])

    hi = create_hires_canvas()
    hcx, hcy = HCENTER_X, HCENTER_Y

    body_w = s(int(13 * p['body_width']))
    body_h = s(int(22 * p['body_height']))

    # Luminous aura (drawn first, behind everything)
    aura_color = tuple(min(255, c + 60) for c in core_rgb)
    hi = add_background_glow(hi, (hcx, hcy), body_w + s(10), aura_color, 0.12)

    # Compact body
    body_layer = Image.new('RGBA', (HSIZE, HSIZE), (0, 0, 0, 0))
    draw_body_blob(body_layer, hcx, hcy, body_w, body_h, colors['body'],
                   irregularity=0.02, seed=p['symmetry_seed'])
    draw_body_blob(body_layer, hcx, hcy - int(body_h * 0.25),
                   int(body_w * 0.8), int(body_h * 0.42),
                   colors['body_light'], irregularity=0.02,
                   seed=p['symmetry_seed'] + 1)

    # Subtle patterns
    pattern_type = p['core_pattern']
    pattern_color = (*palette['pattern_color'], 60)
    draw_body_pattern(body_layer, hcx, hcy, body_w, body_h,
                      pattern_type, pattern_color, seed=p['symmetry_seed'])

    # Steady warm core
    core_phase = (frame % 12) / 12.0  # slower pulse
    hi = draw_core_behind_body(
        body_layer, (hcx, hcy + s(2)), int(body_w * 0.35),
        core_rgb, core_phase, body_alpha_factor=0.3
    )

    hi = apply_membrane_texture(hi, intensity=0.05, seed=p['symmetry_seed'])

    # Graceful, slow appendages
    wave_phase = frame * 0.06  # very slow
    app_len = s(10 + p['appendage_length'] * 3)
    positions = [
        (-1, -0.02, -0.45, 0.0),
        (1, -0.02, 0.45, 0.5),
        (-1, 0.3, -0.8, 0.25),
        (1, 0.3, 0.8, 0.75),
    ]
    for i, (side, y_frac, base_angle, phase_off) in enumerate(
            positions[:min(4, p['appendage_count'])]):
        ax = hcx + side * body_w
        ay = hcy + int(body_h * y_frac)
        draw_appendage(hi, ax, ay, app_len, base_angle, s(2),
                       colors['appendage'], colors['appendage_tip'],
                       curl=0.25, wave_phase=wave_phase + phase_off,
                       tip_glow_color=colors.get('tip_glow'))

    # Deep reflective eyes (slightly larger, with double highlight)
    eye_radius = s(3 + p['eye_size'] + 1)
    eye_y_off = -int(body_h * 0.24)
    blink = 0.5 if frame % 20 == 0 else 0.0
    eye_mood = mood if mood in ('happy', 'sad', 'closed') else 'neutral'
    draw_eye_pair(hi, hcx, hcy, body_w, eye_y_off, eye_radius,
                  p['eye_spacing'], colors, mood=eye_mood, blink=blink,
                  iris_color=colors.get('eye_iris'))

    # Second catch-light for reflective look
    draw = ImageDraw.Draw(hi)
    spacing = int(body_w * p['eye_spacing'])
    for side_val in [-1, 1]:
        hx = hcx + side_val * spacing + side_val * s(1)
        hy = hcy + eye_y_off + s(1)
        draw.ellipse((hx - 1, hy - 1, hx + 1, hy + 1),
                      fill=(255, 255, 255, 180))

    # Mouth
    mouth_y = hcy + int(body_h * 0.04)
    mouth_mood = mood if mood in ('happy', 'sad', 'open') else 'neutral'
    draw_mouth(hi, hcx, mouth_y, s(p['mouth_size'] + 2), s(2),
               color=(*palette['outline'], 140), mood=mouth_mood)

    hi = add_outline(hi, colors['outline'], inner_color=colors['inner'])

    result = downsample(hi)
    img.paste(result, (0, 0))
    return img


# ===== STAGE 7: Lali-thishi (Transcendence) =====

def draw_stage_7(img, dna_params, frame=0, mood='neutral'):
    """Draw Stage 7 - Lali-thishi (Transcendence).

    Ethereal:
    - Body becoming translucent/dissolving at edges
    - Particles of light detaching constantly
    - Iridescent shifting colors
    - Eyes are pure light
    - Shape is fluid, almost formless
    """
    p = params_for_stage(dna_params, 7)
    base_palette = get_palette(p['palette_warmth'])
    palette = transcendence_palette(base_palette, phase=frame * 0.1)
    colors = get_body_colors(palette, alpha_body=100)  # very translucent
    core_rgb = _hue_to_rgb((p['core_hue'] + frame * 12) % 360)

    hi = create_hires_canvas()
    hcx, hcy = HCENTER_X, HCENTER_Y

    body_w = s(int(12 * p['body_width']))
    body_h = s(int(21 * p['body_height']))

    # Ethereal aura
    hi = add_background_glow(hi, (hcx, hcy), body_w + s(12),
                             core_rgb, 0.2)

    # Translucent dissolving body
    body_col = (*palette['body_base'], 90)
    body_light = (*palette['body_highlight'], 70)
    draw_body_blob(hi, hcx, hcy, body_w, body_h, body_col,
                   irregularity=0.1 + frame * 0.005,
                   seed=p['symmetry_seed'] + frame)
    draw_body_blob(hi, hcx, hcy - int(body_h * 0.2),
                   int(body_w * 0.8), int(body_h * 0.4), body_light,
                   irregularity=0.08, seed=p['symmetry_seed'] + 1 + frame)

    # Intense iridescent core
    core_phase = (frame % 12) / 12.0
    hi = pulse_core(hi, (hcx, hcy), int(body_w * 0.5),
                    core_rgb, core_phase, intensity=1.0)
    hi = add_glow(hi, (hcx, hcy), body_w + s(8), core_rgb, 0.5)

    # Ethereal eyes (pure light)
    eye_radius = s(2 + p['eye_size'])
    eye_y_off = -int(body_h * 0.18)
    spacing = int(body_w * p['eye_spacing'])
    draw = ImageDraw.Draw(hi)
    for side_val in [-1, 1]:
        ex = hcx + side_val * spacing
        ey = hcy + eye_y_off
        # Glowing orb eyes
        for ring in range(eye_radius, 0, -1):
            alpha = int(255 * (1.0 - ring / eye_radius) * 0.8)
            c = lerp_color((*core_rgb, 255), (255, 255, 255, 255),
                           1.0 - ring / eye_radius)
            draw.ellipse(
                (ex - ring, ey - ring, ex + ring, ey + ring),
                fill=c[:4] if len(c) >= 4 else (*c[:3], alpha)
            )

    # Fluid appendages (dissolving)
    wave_phase = frame * 0.08
    app_len = s(8 + p['appendage_length'] * 2)
    positions = [
        (-1, 0.0, -0.5, 0.0),
        (1, 0.0, 0.5, 0.5),
        (-1, 0.3, -0.9, 0.25),
        (1, 0.3, 0.9, 0.75),
    ]
    translucent_app = (*palette['appendage_base'], 80)
    translucent_tip = (*palette['appendage_tip'], 50)
    for i, (side, y_frac, base_angle, phase_off) in enumerate(
            positions[:min(4, p['appendage_count'])]):
        ax = hcx + side * body_w
        ay = hcy + int(body_h * y_frac)
        draw_appendage(hi, ax, ay, app_len, base_angle, s(1),
                       translucent_app, translucent_tip,
                       curl=0.5, wave_phase=wave_phase + phase_off)

    # Very soft outline
    hi = add_outline(hi, (*palette['outline'], 80))

    result = downsample(hi)

    # Abundant light particles (at final resolution)
    particle_count = 12 + frame * 2
    particle_color = (*palette['particle_color'], 200)
    particles = generate_particles(
        (CENTER_X, CENTER_Y), particle_count,
        int(12 * p['body_width']) + 8,
        particle_color, seed=p['symmetry_seed'] + frame,
        upward_bias=0.5
    )
    result = draw_particles(result, particles, phase=(frame % 6) / 6.0)

    img.paste(result, (0, 0))
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


def draw_stage(stage, img, dna_params, frame=0, mood='neutral'):
    """Draw a specific stage on the given image.

    Args:
        stage: int 0-7
        img: PIL Image (RGBA, 64x64)
        dna_params: dict from dna_to_params
        frame: animation frame index
        mood: 'neutral', 'happy', 'sad', 'sick', etc.
    """
    func = STAGE_FUNCTIONS.get(stage)
    if func is None:
        raise ValueError(f"Unknown stage: {stage}")
    return func(img, dna_params, frame, mood=mood)
