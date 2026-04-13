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

Each stage now accepts a mood parameter that affects:
  - Eye expression (happy=^_^, sad=droopy+tear, sick=spiral, love=hearts)
  - Body posture (happy=lifted, sad=drooping, sick=swaying)
  - Appendage behavior (happy=waving up, sad=drooping down)
  - Color tinting (mood-specific palette shifts)
  - Particle effects (sparkles, tears, hearts, Z's, sweat)
"""

import math
from PIL import Image, ImageDraw
import numpy as np

from primitives import (
    draw_body_blob, draw_eye, draw_eye_pair, draw_appendage,
    draw_mouth, draw_eyebrow_ridges,
    draw_cheek_blush, draw_z_particles, draw_heart_particles,
    draw_sparkle_particles, draw_sweat_drop, draw_music_notes,
    draw_egg_cracks,
    add_outline, add_rim_light, add_glow, add_background_glow,
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
    get_mood_accents, stage_color_warmth,
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


def _mood_to_eye_mood(mood):
    """Map animation/mood names to eye expression names."""
    eye_map = {
        'neutral': 'neutral',
        'happy': 'happy',
        'sad': 'sad',
        'sick': 'sick',
        'sleep': 'sleep',
        'play': 'happy',
        'sing': 'happy',
        'eat': 'hungry',
        'love': 'love',
        'hungry': 'hungry',
        'dying': 'sad',
        'evolving': 'neutral',
        'transcending': 'neutral',
        'hatching': 'neutral',
        'scared': 'scared',
        'closed': 'closed',
    }
    return eye_map.get(mood, 'neutral')


def _mood_to_mouth_mood(mood):
    """Map mood to mouth expression."""
    mouth_map = {
        'neutral': 'neutral',
        'happy': 'happy',
        'sad': 'sad',
        'sick': 'sick',
        'play': 'happy',
        'sing': 'sing',
        'eat': 'open',
        'love': 'love',
        'hungry': 'hungry',
        'dying': 'sad',
        'sleep': 'neutral',
    }
    return mouth_map.get(mood, 'neutral')


def _mood_posture_offset(mood):
    """Get vertical body offset based on mood (positive=down, negative=up)."""
    offsets = {
        'happy': -1,   # lifted up slightly
        'sad': 2,      # drooping down
        'sick': 1,     # sagging
        'play': -2,    # bouncy
        'love': -1,    # light, floating
        'dying': 3,    # sinking
        'sleep': 1,    # settled down
    }
    return offsets.get(mood, 0)


def _mood_appendage_droop(mood):
    """Get appendage droop factor for mood."""
    droop = {
        'sad': 0.6,
        'sick': 0.4,
        'dying': 0.8,
        'sleep': 0.5,
    }
    return droop.get(mood, 0.0)


def _draw_mood_effects(result, cx, cy, body_w, eye_y_off, eye_spacing,
                       mood, frame, palette):
    """Draw mood-specific particle effects on final-resolution image."""
    if mood == 'happy':
        draw_sparkle_particles(result, cx, cy - 5, count=4,
                               radius=int(body_w * 0.8 / RENDER_SCALE) + 8,
                               frame=frame,
                               color=(*palette.get('sparkle_color', (255, 255, 220)), 180))
        draw_cheek_blush(result, cx, cy, int(body_w / RENDER_SCALE),
                         int(eye_y_off / RENDER_SCALE), eye_spacing,
                         blush_color=(*palette.get('cheek_blush', (255, 140, 120)), 60),
                         intensity=0.6)

    elif mood == 'sad':
        # Tears are already drawn by eye function on hires canvas
        pass

    elif mood == 'sleep':
        draw_z_particles(result, cx + 8, cy - 8, frame=frame,
                         color=(*palette.get('glow_color', (180, 180, 240)), 160))

    elif mood == 'love':
        draw_heart_particles(result, cx, cy - 6, count=3,
                             radius=int(body_w * 0.7 / RENDER_SCALE) + 5,
                             frame=frame,
                             color=(255, 120, 160, 160))
        draw_cheek_blush(result, cx, cy, int(body_w / RENDER_SCALE),
                         int(eye_y_off / RENDER_SCALE), eye_spacing,
                         blush_color=(255, 130, 150, 70),
                         intensity=0.8)

    elif mood == 'sick':
        draw_sweat_drop(result, cx + int(body_w * 0.4 / RENDER_SCALE),
                        cy + int(eye_y_off / RENDER_SCALE) - 2,
                        color=(160, 210, 140, 150))

    elif mood == 'sing':
        draw_music_notes(result, cx + 6, cy - 4, frame=frame,
                         color=(*palette.get('glow_color', (200, 160, 255)), 160))

    elif mood == 'play':
        draw_sparkle_particles(result, cx, cy, count=2,
                               radius=int(body_w * 0.6 / RENDER_SCALE) + 6,
                               frame=frame,
                               color=(*palette.get('particle_color', (255, 220, 140)), 140))


# ===== STAGE 0: Syrma (Egg) =====

def draw_stage_0(img, dna_params, frame=0, mood='neutral'):
    """Draw Stage 0 - Syrma (Cosmic Egg).

    A smooth ovoid with:
    - Pulsing inner glow from forming core
    - Spiral galaxy energy pattern
    - Bioluminescent veins on shell surface
    - Sparkle particles floating around
    - Cracks appearing (for hatching mood)
    """
    p = params_for_stage(dna_params, 0)
    warmth = stage_color_warmth(0, p['palette_warmth'])
    palette = get_palette(warmth)
    if mood != 'neutral':
        palette = apply_mood_shift(palette, mood)
    colors = get_body_colors(palette)
    core_rgb = _hue_to_rgb(p['core_hue'])

    hi = create_hires_canvas()
    hcx, hcy = HCENTER_X, HCENTER_Y

    egg_w = s(int(15 * p['body_width']))
    egg_h = s(int(22 * p['body_height']))

    # Background aura
    hi = add_background_glow(hi, (hcx, hcy), egg_w + s(10), core_rgb, 0.18)

    # Egg shell layers for depth
    draw_body_blob(hi, hcx, hcy, egg_w, egg_h, colors['body_dark'],
                   irregularity=0.04, seed=p['symmetry_seed'])
    draw_body_blob(hi, hcx, hcy, egg_w - s(1), egg_h - s(1), colors['body'],
                   irregularity=0.02, seed=p['symmetry_seed'])
    # Upper highlight (rim light effect)
    draw_body_blob(hi, hcx, hcy - egg_h // 4, int(egg_w * 0.7),
                   int(egg_h * 0.45), colors['body_light'],
                   irregularity=0.02, seed=p['symmetry_seed'] + 1)

    # Bioluminescent veins
    vein_color = (*core_rgb, 65)
    draw_veins(hi, hcx, hcy, egg_w, egg_h, vein_color, count=7,
               seed=p['symmetry_seed'])

    # Spiral galaxy energy
    phase = frame * 0.3
    spiral_color = (*palette['core_inner'], 95)
    draw_spiral(hi, hcx, hcy, min(egg_w, egg_h) * 0.65, spiral_color,
                turns=2.5, phase=phase, point_count=35)

    # Pulsating core
    core_phase = (frame % 8) / 8.0
    hi = pulse_core(hi, (hcx, hcy + s(2)), int(egg_w * 0.38),
                    core_rgb, core_phase, intensity=0.65)
    hi = add_glow(hi, (hcx, hcy), egg_w, core_rgb, 0.28)

    # Hatching cracks
    if mood == 'hatching':
        crack_progress = min(1.0, frame / 8.0)
        draw_egg_cracks(hi, hcx, hcy, egg_w, egg_h, crack_progress,
                        seed=p['symmetry_seed'])

    # Membrane texture
    hi = apply_membrane_texture(hi, intensity=0.06, seed=p['symmetry_seed'])

    # Outline + rim light
    hi = add_outline(hi, colors['outline'], inner_color=colors['inner'])
    hi = add_rim_light(hi, light_dir=(0, -1), color=(255, 255, 240),
                       intensity=0.2)

    result = downsample(hi)

    # Sparkle particles
    sparkle_color = (*palette['particle_color'], 180)
    particles = generate_particles(
        (CENTER_X, CENTER_Y), 7, int(15 * p['body_width']) + 6,
        sparkle_color, seed=p['symmetry_seed'] + frame,
        upward_bias=0.3
    )
    result = draw_particles(result, particles, phase=(frame % 4) / 4.0)

    img.paste(result, (0, 0))
    return img


# ===== STAGE 1: Lali-na (Newborn) =====

def draw_stage_1(img, dna_params, frame=0, mood='neutral'):
    """Draw Stage 1 - Lali-na (Newborn).

    Baby proportions that trigger protective instinct:
    - HUGE eyes (35%+ of face) with mood-specific expressions
    - Tiny round body (head IS the body basically)
    - Translucent showing core
    - No appendages yet
    - Very soft, rounded
    """
    p = params_for_stage(dna_params, 1)
    warmth = stage_color_warmth(1, p['palette_warmth'])
    palette = get_palette(warmth)
    if mood != 'neutral':
        palette = apply_mood_shift(palette, mood)
    colors = get_body_colors(palette, alpha_body=165)
    core_rgb = _hue_to_rgb(p['core_hue'])

    hi = create_hires_canvas()
    posture_dy = s(_mood_posture_offset(mood))
    hcx = HCENTER_X
    hcy = HCENTER_Y + s(3) + posture_dy

    # Baby proportions: huge head-body ratio
    body_w = s(int(18 * p['body_width']))
    body_h = s(int(16 * p['body_height']))

    body_layer = Image.new('RGBA', (HSIZE, HSIZE), (0, 0, 0, 0))

    # Round blobby body (head = body)
    draw_body_blob(body_layer, hcx, hcy, body_w, body_h, colors['body'],
                   squash=0.08, irregularity=0.05, seed=p['symmetry_seed'])
    # Head highlight (big, bright - baby look)
    head_h = int(body_h * 0.6)
    head_w = int(body_w * 0.88)
    draw_body_blob(body_layer, hcx, hcy - int(body_h * 0.2), head_w, head_h,
                   colors['body_light'], irregularity=0.03,
                   seed=p['symmetry_seed'] + 1)

    # Core showing through
    core_phase = (frame % 8) / 8.0
    hi = draw_core_behind_body(
        body_layer, (hcx, hcy + s(2)), int(body_w * 0.4),
        core_rgb, core_phase, body_alpha_factor=0.4
    )
    hi = add_glow(hi, (hcx, hcy), body_w + s(4), core_rgb, 0.32)

    # Membrane
    hi = apply_membrane_texture(hi, intensity=0.04, seed=p['symmetry_seed'])

    # HUGE EXPRESSIVE EYES
    eye_radius = s(3 + p['eye_size'] + 2)  # extra large for baby
    eye_y = hcy - int(body_h * 0.15)

    blink = 0.0
    if mood not in ('happy', 'sad', 'sick', 'love', 'sleep', 'hungry', 'scared'):
        if frame % 16 == 0:
            blink = 0.8

    eye_mood = _mood_to_eye_mood(mood)
    draw_eye_pair(hi, hcx, eye_y, body_w, 0, eye_radius,
                  p['eye_spacing'], colors, mood=eye_mood, blink=blink,
                  iris_color=colors.get('eye_iris'))

    # Tiny mouth
    mouth_y = hcy + int(body_h * 0.2)
    mouth_mood = _mood_to_mouth_mood(mood)
    draw_mouth(hi, hcx, mouth_y, s(p['mouth_size'] + 2), s(2),
               color=(*palette['outline'], 170), mood=mouth_mood)

    # Outline + rim
    hi = add_outline(hi, colors['outline'], inner_color=colors['inner'])
    hi = add_rim_light(hi, light_dir=(0, -1), color=(255, 255, 245),
                       intensity=0.18)

    result = downsample(hi)

    # Mood effects
    _draw_mood_effects(result, CENTER_X, CENTER_Y + 2,
                       body_w, -int(body_h * 0.15), p['eye_spacing'],
                       mood, frame, palette)

    # Subtle sparkles
    if frame % 3 == 0 and mood not in ('sad', 'sick', 'dying'):
        sparkle = (*palette['particle_color'], 120)
        particles = generate_particles(
            (CENTER_X, CENTER_Y + 2), 3, int(18 * p['body_width']),
            sparkle, seed=p['symmetry_seed'] + frame, upward_bias=0.2
        )
        result = draw_particles(result, particles, phase=0.3)

    img.paste(result, (0, 0))
    return img


# ===== STAGE 2: Lali-shi (Infant) =====

def draw_stage_2(img, dna_params, frame=0, mood='neutral'):
    """Draw Stage 2 - Lali-shi (Infant).

    Growing curiosity:
    - Still huge eyes, visible iris colors
    - First tiny tentacle-appendages sprouting
    - More structured body (head + torso hint)
    - Expressive eyebrow-ridges
    - Mood-aware appendage droop
    """
    p = params_for_stage(dna_params, 2)
    warmth = stage_color_warmth(2, p['palette_warmth'])
    palette = get_palette(warmth)
    if mood != 'neutral':
        palette = apply_mood_shift(palette, mood)
    colors = get_body_colors(palette, alpha_body=175)
    core_rgb = _hue_to_rgb(p['core_hue'])

    hi = create_hires_canvas()
    posture_dy = s(_mood_posture_offset(mood))
    hcx = HCENTER_X
    hcy = HCENTER_Y + s(2) + posture_dy

    body_w = s(int(16 * p['body_width']))
    body_h = s(int(18 * p['body_height']))

    body_layer = Image.new('RGBA', (HSIZE, HSIZE), (0, 0, 0, 0))
    draw_body_blob(body_layer, hcx, hcy, body_w, body_h, colors['body'],
                   squash=0.1, irregularity=0.05, seed=p['symmetry_seed'])
    # Head region
    draw_body_blob(body_layer, hcx, hcy - int(body_h * 0.28),
                   int(body_w * 0.85), int(body_h * 0.52),
                   colors['body_light'], irregularity=0.03,
                   seed=p['symmetry_seed'] + 1)

    # Core behind body
    core_phase = (frame % 8) / 8.0
    hi = draw_core_behind_body(
        body_layer, (hcx, hcy + s(2)), int(body_w * 0.35),
        core_rgb, core_phase, body_alpha_factor=0.35
    )
    hi = add_glow(hi, (hcx, hcy), body_w + s(3), core_rgb, 0.3)
    hi = apply_membrane_texture(hi, intensity=0.05, seed=p['symmetry_seed'])

    # 2 small appendages with mood-aware droop
    wave_phase = frame * 0.15
    droop = _mood_appendage_droop(mood)
    for side_val in [-1, 1]:
        ax = hcx + side_val * body_w
        ay = hcy + int(body_h * 0.3)
        angle = side_val * 0.7
        if mood == 'happy':
            angle = side_val * 0.3  # arms up
        app_len = s(5 + p['appendage_length'] * 2)
        draw_appendage(hi, ax, ay, app_len, angle, s(2),
                       colors['appendage'], colors['appendage_tip'],
                       curl=0.3, wave_phase=wave_phase, droop=droop)

    # Huge eyes
    eye_radius = s(3 + p['eye_size'] + 1)
    eye_y_off = -int(body_h * 0.18)

    blink = 0.0
    if mood not in ('happy', 'sad', 'sick', 'love', 'sleep', 'hungry'):
        if frame % 12 == 0:
            blink = 0.7

    eye_mood = _mood_to_eye_mood(mood)
    draw_eye_pair(hi, hcx, hcy, body_w, eye_y_off, eye_radius,
                  p['eye_spacing'], colors, mood=eye_mood, blink=blink,
                  iris_color=colors.get('eye_iris'))

    # Eyebrow ridges
    brow_color = (*palette['body_shadow'], 150)
    brow_mood = mood if mood in ('happy', 'sad', 'angry', 'scared', 'sick') else 'neutral'
    draw_eyebrow_ridges(hi, hcx, hcy, body_w, eye_y_off, p['eye_spacing'],
                        brow_color, mood=brow_mood)

    # Mouth
    mouth_y = hcy + int(body_h * 0.18)
    mouth_mood = _mood_to_mouth_mood(mood)
    draw_mouth(hi, hcx, mouth_y, s(p['mouth_size'] + 2), s(2),
               color=(*palette['outline'], 175), mood=mouth_mood)

    # Outline + rim
    hi = add_outline(hi, colors['outline'], inner_color=colors['inner'])
    hi = add_rim_light(hi, light_dir=(0, -1), color=(255, 255, 245),
                       intensity=0.15)

    result = downsample(hi)

    # Mood effects
    _draw_mood_effects(result, CENTER_X, CENTER_Y + 1,
                       body_w, eye_y_off, p['eye_spacing'],
                       mood, frame, palette)

    img.paste(result, (0, 0))
    return img


# ===== STAGE 3: Lali-ko (Child) =====

def draw_stage_3(img, dna_params, frame=0, mood='neutral'):
    """Draw Stage 3 - Lali-ko (Child).

    Personality emerging:
    - Head/torso distinction
    - 4 appendages with mood-based posture
    - Prominent core pulsing
    - Expressive face with full mood range
    """
    p = params_for_stage(dna_params, 3)
    warmth = stage_color_warmth(3, p['palette_warmth'])
    palette = get_palette(warmth)
    if mood != 'neutral':
        palette = apply_mood_shift(palette, mood)
    colors = get_body_colors(palette, alpha_body=185)
    core_rgb = _hue_to_rgb(p['core_hue'])

    hi = create_hires_canvas()
    posture_dy = s(_mood_posture_offset(mood))
    hcx = HCENTER_X
    hcy = HCENTER_Y + s(1) + posture_dy

    body_w = s(int(14 * p['body_width']))
    body_h = s(int(21 * p['body_height']))

    body_layer = Image.new('RGBA', (HSIZE, HSIZE), (0, 0, 0, 0))
    # Torso
    draw_body_blob(body_layer, hcx, hcy, body_w, body_h, colors['body'],
                   squash=0.12, irregularity=0.04, seed=p['symmetry_seed'])
    # Head (distinct)
    head_y = hcy - int(body_h * 0.3)
    head_w = int(body_w * 0.85)
    head_h = int(body_h * 0.48)
    draw_body_blob(body_layer, hcx, head_y, head_w, head_h,
                   colors['body_light'], irregularity=0.03,
                   seed=p['symmetry_seed'] + 1)

    # Core
    core_phase = (frame % 8) / 8.0
    hi = draw_core_behind_body(
        body_layer, (hcx, hcy + s(3)), int(body_w * 0.35),
        core_rgb, core_phase, body_alpha_factor=0.3
    )
    hi = add_glow(hi, (hcx, hcy), body_w + s(3), core_rgb, 0.28)
    hi = apply_membrane_texture(hi, intensity=0.06, seed=p['symmetry_seed'])

    # 4 appendages with mood posture
    wave_phase = frame * 0.12
    if mood == 'happy':
        wave_phase = frame * 0.25  # faster waving when happy
    droop = _mood_appendage_droop(mood)
    app_count = min(4, max(2, p['appendage_count']))
    app_len = s(8 + p['appendage_length'] * 3)

    # Adjust angles based on mood
    if mood == 'happy':
        positions = [
            (-1, -0.05, -0.3, 0.0),    # arms up
            (1, -0.05, 0.3, 0.3),
            (-1, 0.4, -0.7, 0.5),
            (1, 0.4, 0.7, 0.8),
        ]
    elif mood == 'play':
        positions = [
            (-1, -0.1, -0.2, 0.0),     # reaching out
            (1, -0.1, 0.2, 0.2),
            (-1, 0.35, -0.9, 0.5),
            (1, 0.35, 0.9, 0.7),
        ]
    else:
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
                       curl=0.35, wave_phase=wave_phase + phase_off,
                       droop=droop)

    # Eyes
    eye_radius = s(2 + p['eye_size'] + 1)
    eye_y_off = -int(body_h * 0.25)
    blink = 0.0
    if mood not in ('happy', 'sad', 'sick', 'love', 'sleep', 'hungry'):
        if frame % 14 == 0:
            blink = 0.6

    eye_mood = _mood_to_eye_mood(mood)
    draw_eye_pair(hi, hcx, hcy, body_w, eye_y_off, eye_radius,
                  p['eye_spacing'], colors, mood=eye_mood, blink=blink,
                  iris_color=colors.get('eye_iris'))

    # Eyebrows
    brow_color = (*palette['body_shadow'], 140)
    brow_mood = mood if mood in ('happy', 'sad', 'angry', 'scared', 'sick') else 'neutral'
    draw_eyebrow_ridges(hi, hcx, hcy, body_w, eye_y_off, p['eye_spacing'],
                        brow_color, mood=brow_mood)

    # Mouth
    mouth_y = hcy + int(body_h * 0.02)
    mouth_mood = _mood_to_mouth_mood(mood)
    draw_mouth(hi, hcx, mouth_y, s(p['mouth_size'] + 3), s(2),
               color=(*palette['outline'], 170), mood=mouth_mood)

    hi = add_outline(hi, colors['outline'], inner_color=colors['inner'])
    hi = add_rim_light(hi, light_dir=(0, -1), color=(255, 255, 240),
                       intensity=0.15)

    result = downsample(hi)

    _draw_mood_effects(result, CENTER_X, CENTER_Y,
                       body_w, eye_y_off, p['eye_spacing'],
                       mood, frame, palette)

    img.paste(result, (0, 0))
    return img


# ===== STAGE 4: Lali-ren (Teen) =====

def draw_stage_4(img, dna_params, frame=0, mood='neutral'):
    """Draw Stage 4 - Lali-ren (Teen).

    Awkward grace:
    - Taller, slimmer proportions (growth spurt)
    - Long flowing appendages with tip glow
    - Core sends light pulses through body
    - Body patterns emerge from DNA
    - Full emotional range
    """
    p = params_for_stage(dna_params, 4)
    warmth = stage_color_warmth(4, p['palette_warmth'])
    palette = get_palette(warmth)
    if mood != 'neutral':
        palette = apply_mood_shift(palette, mood)
    colors = get_body_colors(palette, alpha_body=182)
    core_rgb = _hue_to_rgb(p['core_hue'])

    hi = create_hires_canvas()
    posture_dy = s(_mood_posture_offset(mood))
    hcx = HCENTER_X
    hcy = HCENTER_Y + posture_dy

    body_w = s(int(13 * p['body_width']))
    body_h = s(int(24 * p['body_height']))

    # Taller slimmer body
    body_layer = Image.new('RGBA', (HSIZE, HSIZE), (0, 0, 0, 0))
    draw_body_blob(body_layer, hcx, hcy, body_w, body_h, colors['body'],
                   squash=0.15, irregularity=0.03, seed=p['symmetry_seed'])
    # Head region
    head_y = hcy - int(body_h * 0.28)
    draw_body_blob(body_layer, hcx, head_y, int(body_w * 0.85),
                   int(body_h * 0.4), colors['body_light'],
                   irregularity=0.02, seed=p['symmetry_seed'] + 1)

    # Body patterns from DNA
    pattern_type = p['core_pattern']
    pattern_color = (*palette['pattern_color'], 85)
    draw_body_pattern(body_layer, hcx, hcy, body_w, body_h,
                      pattern_type, pattern_color, seed=p['symmetry_seed'])

    # Core with translucency
    core_phase = (frame % 8) / 8.0
    hi = draw_core_behind_body(
        body_layer, (hcx, hcy + s(4)), int(body_w * 0.4),
        core_rgb, core_phase, body_alpha_factor=0.35
    )
    hi = add_glow(hi, (hcx, hcy), body_w + s(5), core_rgb, 0.35)
    hi = apply_membrane_texture(hi, intensity=0.06, seed=p['symmetry_seed'])

    # Long flowing appendages
    wave_phase = frame * 0.1
    if mood == 'happy':
        wave_phase = frame * 0.2
    droop = _mood_appendage_droop(mood)
    app_len = s(12 + p['appendage_length'] * 4)

    if mood == 'happy':
        positions = [
            (-1, -0.1, -0.25, 0.0),
            (1, -0.1, 0.25, 0.25),
            (-1, 0.15, -0.5, 0.5),
            (1, 0.15, 0.5, 0.75),
            (-1, 0.4, -0.8, 0.33),
            (1, 0.4, 0.8, 0.66),
        ]
    else:
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
                       tip_glow_color=colors.get('tip_glow'),
                       droop=droop)

    # Eyes
    eye_radius = s(2 + p['eye_size'] + 1)
    eye_y_off = -int(body_h * 0.27)
    blink = 0.0
    if mood not in ('happy', 'sad', 'sick', 'love', 'sleep', 'hungry'):
        blink = 0.8 if frame % 16 == 0 else 0.0

    eye_mood = _mood_to_eye_mood(mood)
    draw_eye_pair(hi, hcx, hcy, body_w, eye_y_off, eye_radius,
                  p['eye_spacing'], colors, mood=eye_mood, blink=blink,
                  iris_color=colors.get('eye_iris'))

    # Eyebrows
    brow_color = (*palette['body_shadow'], 130)
    brow_mood = mood if mood in ('happy', 'sad', 'angry', 'scared', 'sick') else 'neutral'
    draw_eyebrow_ridges(hi, hcx, hcy, body_w, eye_y_off, p['eye_spacing'],
                        brow_color, mood=brow_mood)

    # Mouth
    mouth_y = hcy - int(body_h * 0.02)
    mouth_mood = _mood_to_mouth_mood(mood)
    draw_mouth(hi, hcx, mouth_y, s(p['mouth_size'] + 3), s(3),
               color=(*palette['outline'], 160), mood=mouth_mood)

    hi = add_outline(hi, colors['outline'], inner_color=colors['inner'])
    hi = add_rim_light(hi, light_dir=(0, -1), color=(255, 255, 240),
                       intensity=0.12)

    result = downsample(hi)

    _draw_mood_effects(result, CENTER_X, CENTER_Y,
                       body_w, eye_y_off, p['eye_spacing'],
                       mood, frame, palette)

    img.paste(result, (0, 0))
    return img


# ===== STAGE 5: Lali-vox (Adult) =====

def draw_stage_5(img, dna_params, frame=0, mood='neutral'):
    """Draw Stage 5 - Lali-vox (Adult).

    Full beauty:
    - Elegant, balanced proportions
    - All DNA features at max expression
    - Flowing appendages with bioluminescent tips
    - Rich saturated palette, complex core
    - Full mood expressiveness
    """
    p = params_for_stage(dna_params, 5)
    warmth = stage_color_warmth(5, p['palette_warmth'])
    palette = get_palette(warmth)
    if mood != 'neutral':
        palette = apply_mood_shift(palette, mood)
    colors = get_body_colors(palette, alpha_body=188)
    core_rgb = _hue_to_rgb(p['core_hue'])

    hi = create_hires_canvas()
    posture_dy = s(_mood_posture_offset(mood))
    hcx = HCENTER_X
    hcy = HCENTER_Y + posture_dy

    body_w = s(int(14 * p['body_width']))
    body_h = s(int(25 * p['body_height']))

    # Layered body
    body_layer = Image.new('RGBA', (HSIZE, HSIZE), (0, 0, 0, 0))
    draw_body_blob(body_layer, hcx, hcy, body_w, body_h, colors['body_dark'],
                   squash=0.12, irregularity=0.03, seed=p['symmetry_seed'])
    draw_body_blob(body_layer, hcx, hcy, int(body_w * 0.93),
                   int(body_h * 0.93), colors['body'],
                   irregularity=0.02, seed=p['symmetry_seed'])
    # Head
    head_y = hcy - int(body_h * 0.25)
    draw_body_blob(body_layer, hcx, head_y, int(body_w * 0.82),
                   int(body_h * 0.42), colors['body_light'],
                   irregularity=0.02, seed=p['symmetry_seed'] + 1)

    # Full body patterns
    pattern_type = p['core_pattern']
    pattern_color = (*palette['pattern_color'], 90)
    draw_body_pattern(body_layer, hcx, hcy, body_w, body_h,
                      pattern_type, pattern_color, seed=p['symmetry_seed'])

    # Strong core
    core_phase = (frame % 8) / 8.0
    hi = draw_core_behind_body(
        body_layer, (hcx, hcy + s(3)), int(body_w * 0.45),
        core_rgb, core_phase, body_alpha_factor=0.4
    )
    hi = add_glow(hi, (hcx, hcy), body_w + s(6), core_rgb, 0.42)
    hi = apply_membrane_texture(hi, intensity=0.07, seed=p['symmetry_seed'])

    # Full appendages with bioluminescent tips
    wave_phase = frame * 0.1
    if mood == 'happy':
        wave_phase = frame * 0.18
    droop = _mood_appendage_droop(mood)
    app_len = s(14 + p['appendage_length'] * 4)

    if mood == 'happy':
        positions = [
            (-1, -0.12, -0.2, 0.0),
            (1, -0.12, 0.2, 0.2),
            (-1, 0.08, -0.45, 0.4),
            (1, 0.08, 0.45, 0.6),
            (-1, 0.3, -0.7, 0.3),
            (1, 0.3, 0.7, 0.7),
        ]
    else:
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
                       tip_glow_color=colors.get('tip_glow'),
                       droop=droop)

    # Detailed eyes
    eye_radius = s(2 + p['eye_size'] + 1)
    eye_y_off = -int(body_h * 0.25)
    blink = 0.0
    if mood not in ('happy', 'sad', 'sick', 'love', 'sleep', 'hungry'):
        blink = 0.7 if frame % 18 == 0 else 0.0

    eye_mood = _mood_to_eye_mood(mood)
    draw_eye_pair(hi, hcx, hcy, body_w, eye_y_off, eye_radius,
                  p['eye_spacing'], colors, mood=eye_mood, blink=blink,
                  iris_color=colors.get('eye_iris'))

    # Eyebrows
    brow_color = (*palette['body_shadow'], 120)
    brow_mood = mood if mood in ('happy', 'sad', 'angry', 'scared', 'sick') else 'neutral'
    draw_eyebrow_ridges(hi, hcx, hcy, body_w, eye_y_off, p['eye_spacing'],
                        brow_color, mood=brow_mood)

    # Mouth
    mouth_y = hcy - int(body_h * 0.02)
    mouth_mood = _mood_to_mouth_mood(mood)
    draw_mouth(hi, hcx, mouth_y, s(p['mouth_size'] + 3), s(3),
               color=(*palette['outline'], 150), mood=mouth_mood)

    hi = add_outline(hi, colors['outline'], inner_color=colors['inner'])
    hi = add_rim_light(hi, light_dir=(0, -1), color=(255, 255, 235),
                       intensity=0.12)

    result = downsample(hi)

    _draw_mood_effects(result, CENTER_X, CENTER_Y,
                       body_w, eye_y_off, p['eye_spacing'],
                       mood, frame, palette)

    img.paste(result, (0, 0))
    return img


# ===== STAGE 6: Lali-mere (Sage) =====

def draw_stage_6(img, dna_params, frame=0, mood='neutral'):
    """Draw Stage 6 - Lali-mere (Sage).

    Noble wisdom:
    - Compact, dignified form
    - Deep reflective eyes with double catchlight
    - Desaturated noble palette (silver, deep blue)
    - Luminous aura surrounding body
    - Slow, deliberate movement
    """
    p = params_for_stage(dna_params, 6)
    palette = sage_palette(get_palette(stage_color_warmth(6, p['palette_warmth'])))
    if mood != 'neutral':
        palette = apply_mood_shift(palette, mood)
    colors = get_body_colors(palette, alpha_body=198)
    core_rgb = _hue_to_rgb(p['core_hue'])

    hi = create_hires_canvas()
    posture_dy = s(_mood_posture_offset(mood))
    hcx = HCENTER_X
    hcy = HCENTER_Y + posture_dy

    body_w = s(int(13 * p['body_width']))
    body_h = s(int(22 * p['body_height']))

    # Luminous aura behind everything
    aura_color = tuple(min(255, c + 65) for c in core_rgb)
    hi = add_background_glow(hi, (hcx, hcy), body_w + s(12), aura_color, 0.14)

    # Compact dignified body
    body_layer = Image.new('RGBA', (HSIZE, HSIZE), (0, 0, 0, 0))
    draw_body_blob(body_layer, hcx, hcy, body_w, body_h, colors['body'],
                   irregularity=0.02, seed=p['symmetry_seed'])
    draw_body_blob(body_layer, hcx, hcy - int(body_h * 0.23),
                   int(body_w * 0.8), int(body_h * 0.42),
                   colors['body_light'], irregularity=0.02,
                   seed=p['symmetry_seed'] + 1)

    # Subtle patterns
    pattern_type = p['core_pattern']
    pattern_color = (*palette['pattern_color'], 55)
    draw_body_pattern(body_layer, hcx, hcy, body_w, body_h,
                      pattern_type, pattern_color, seed=p['symmetry_seed'])

    # Steady warm core (slower pulse)
    core_phase = (frame % 12) / 12.0
    hi = draw_core_behind_body(
        body_layer, (hcx, hcy + s(2)), int(body_w * 0.35),
        core_rgb, core_phase, body_alpha_factor=0.3
    )
    hi = apply_membrane_texture(hi, intensity=0.04, seed=p['symmetry_seed'])

    # Graceful slow appendages
    wave_phase = frame * 0.06
    droop = _mood_appendage_droop(mood)
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
                       tip_glow_color=colors.get('tip_glow'),
                       droop=droop)

    # Deep reflective eyes
    eye_radius = s(3 + p['eye_size'] + 1)
    eye_y_off = -int(body_h * 0.22)
    blink = 0.0
    if mood not in ('happy', 'sad', 'sick', 'love', 'sleep', 'hungry'):
        blink = 0.5 if frame % 20 == 0 else 0.0

    eye_mood = _mood_to_eye_mood(mood)
    draw_eye_pair(hi, hcx, hcy, body_w, eye_y_off, eye_radius,
                  p['eye_spacing'], colors, mood=eye_mood, blink=blink,
                  iris_color=colors.get('eye_iris'))

    # Second catchlight for extra reflective look (sage wisdom)
    if eye_mood == 'neutral':
        draw = ImageDraw.Draw(hi)
        spacing = int(body_w * p['eye_spacing'])
        for side_val in [-1, 1]:
            hx = hcx + side_val * spacing + side_val * s(1)
            hy = hcy + eye_y_off + s(1)
            draw.ellipse((hx - 1, hy - 1, hx + 1, hy + 1),
                          fill=(255, 255, 255, 160))

    # Mouth
    mouth_y = hcy + int(body_h * 0.04)
    mouth_mood = _mood_to_mouth_mood(mood)
    draw_mouth(hi, hcx, mouth_y, s(p['mouth_size'] + 2), s(2),
               color=(*palette['outline'], 140), mood=mouth_mood)

    hi = add_outline(hi, colors['outline'], inner_color=colors['inner'])
    hi = add_rim_light(hi, light_dir=(0, -1), color=(220, 225, 240),
                       intensity=0.15)

    result = downsample(hi)

    _draw_mood_effects(result, CENTER_X, CENTER_Y,
                       body_w, eye_y_off, p['eye_spacing'],
                       mood, frame, palette)

    img.paste(result, (0, 0))
    return img


# ===== STAGE 7: Lali-thishi (Transcendence) =====

def draw_stage_7(img, dna_params, frame=0, mood='neutral'):
    """Draw Stage 7 - Lali-thishi (Transcendence).

    Ethereal being:
    - Body becoming translucent/dissolving at edges
    - Particles of light detaching constantly
    - Iridescent shifting colors
    - Eyes are pure light orbs
    - Shape is fluid, almost formless
    - Cosmic background glow
    """
    p = params_for_stage(dna_params, 7)
    base_palette = get_palette(stage_color_warmth(7, p['palette_warmth']))
    palette = transcendence_palette(base_palette, phase=frame * 0.1)
    colors = get_body_colors(palette, alpha_body=95)
    core_rgb = _hue_to_rgb((p['core_hue'] + frame * 12) % 360)

    hi = create_hires_canvas()
    hcx, hcy = HCENTER_X, HCENTER_Y

    body_w = s(int(12 * p['body_width']))
    body_h = s(int(21 * p['body_height']))

    # Ethereal cosmic aura
    hi = add_background_glow(hi, (hcx, hcy), body_w + s(14),
                             core_rgb, 0.22)

    # Translucent dissolving body
    body_col = (*palette['body_base'], 85)
    body_light = (*palette['body_highlight'], 65)
    draw_body_blob(hi, hcx, hcy, body_w, body_h, body_col,
                   irregularity=0.1 + frame * 0.004,
                   seed=p['symmetry_seed'] + frame)
    draw_body_blob(hi, hcx, hcy - int(body_h * 0.2),
                   int(body_w * 0.78), int(body_h * 0.38), body_light,
                   irregularity=0.07, seed=p['symmetry_seed'] + 1 + frame)

    # Intense iridescent core
    core_phase = (frame % 12) / 12.0
    hi = pulse_core(hi, (hcx, hcy), int(body_w * 0.5),
                    core_rgb, core_phase, intensity=1.0)
    hi = add_glow(hi, (hcx, hcy), body_w + s(10), core_rgb, 0.5)

    # Ethereal eyes (pure light orbs)
    eye_radius = s(2 + p['eye_size'])
    eye_y_off = -int(body_h * 0.18)
    spacing = int(body_w * p['eye_spacing'])
    draw = ImageDraw.Draw(hi)
    for side_val in [-1, 1]:
        ex = hcx + side_val * spacing
        ey = hcy + eye_y_off
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
    translucent_app = (*palette['appendage_base'], 75)
    translucent_tip = (*palette['appendage_tip'], 50)
    for i, (side, y_frac, base_angle, phase_off) in enumerate(
            positions[:min(4, p['appendage_count'])]):
        ax = hcx + side * body_w
        ay = hcy + int(body_h * y_frac)
        draw_appendage(hi, ax, ay, app_len, base_angle, s(1),
                       translucent_app, translucent_tip,
                       curl=0.5, wave_phase=wave_phase + phase_off)

    # Very soft outline
    hi = add_outline(hi, (*palette['outline'], 70))

    result = downsample(hi)

    # Abundant light particles
    particle_count = 14 + frame * 2
    particle_color = (*palette['particle_color'], 200)
    particles = generate_particles(
        (CENTER_X, CENTER_Y), particle_count,
        int(12 * p['body_width']) + 10,
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
        mood: 'neutral', 'happy', 'sad', 'sick', 'sleep', 'play',
              'sing', 'eat', 'love', 'hungry', 'dying', 'evolving',
              'transcending', 'hatching', 'scared'
    """
    func = STAGE_FUNCTIONS.get(stage)
    if func is None:
        raise ValueError(f"Unknown stage: {stage}")
    return func(img, dna_params, frame, mood=mood)
