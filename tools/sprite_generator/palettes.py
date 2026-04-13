"""
palettes.py - Semantic color palettes for Lalien sprite generation.
Each palette provides named color slots for body, core, eyes, appendages, etc.
Supports mood-based palette shifting, stage-based desaturation, and
emotionally resonant mood overlays.
"""

import math


# ---------------------------------------------------------------------------
# Base palette definitions with semantic color slots
# Each entry is RGB (alpha added contextually)
# ---------------------------------------------------------------------------

WARM_PALETTE = {
    'body_base':       (240, 130, 90),
    'body_highlight':  (255, 195, 150),
    'body_shadow':     (170, 70, 45),
    'body_mid':        (250, 165, 115),
    'core_inner':      (255, 245, 210),
    'core_outer':      (255, 160, 80),
    'eye_iris':        (255, 185, 65),
    'eye_white':       (255, 248, 240),
    'eye_pupil':       (25, 12, 8),
    'appendage_base':  (240, 145, 105),
    'appendage_tip':   (255, 210, 110),
    'glow_color':      (255, 185, 105),
    'particle_color':  (255, 225, 150),
    'pattern_color':   (195, 95, 55),
    'outline':         (55, 22, 12),
    'inner_highlight': (255, 205, 165),
    'cheek_blush':     (255, 140, 120),
    'tear_color':      (180, 210, 255),
    'sparkle_color':   (255, 255, 220),
}

COOL_PALETTE = {
    'body_base':       (80, 155, 205),
    'body_highlight':  (145, 205, 235),
    'body_shadow':     (25, 75, 140),
    'body_mid':        (105, 175, 215),
    'core_inner':      (205, 235, 255),
    'core_outer':      (80, 165, 225),
    'eye_iris':        (100, 205, 225),
    'eye_white':       (235, 248, 255),
    'eye_pupil':       (8, 12, 28),
    'appendage_base':  (70, 145, 195),
    'appendage_tip':   (125, 215, 235),
    'glow_color':      (105, 185, 245),
    'particle_color':  (165, 225, 255),
    'pattern_color':   (45, 108, 168),
    'outline':         (8, 18, 38),
    'inner_highlight': (165, 215, 245),
    'cheek_blush':     (180, 160, 220),
    'tear_color':      (160, 200, 255),
    'sparkle_color':   (220, 240, 255),
}

IRIDESCENT_PALETTE = {
    'body_base':       (145, 105, 185),
    'body_highlight':  (185, 165, 225),
    'body_shadow':     (75, 45, 118),
    'body_mid':        (155, 125, 195),
    'core_inner':      (235, 215, 255),
    'core_outer':      (165, 105, 205),
    'eye_iris':        (125, 205, 175),
    'eye_white':       (242, 238, 255),
    'eye_pupil':       (12, 8, 22),
    'appendage_base':  (135, 105, 175),
    'appendage_tip':   (105, 205, 165),
    'glow_color':      (165, 125, 225),
    'particle_color':  (185, 205, 255),
    'pattern_color':   (95, 65, 148),
    'outline':         (18, 8, 32),
    'inner_highlight': (185, 165, 225),
    'cheek_blush':     (220, 150, 200),
    'tear_color':      (170, 190, 255),
    'sparkle_color':   (230, 220, 255),
}

NEUTRAL_PALETTE = {
    'body_base':       (155, 165, 175),
    'body_highlight':  (205, 210, 215),
    'body_shadow':     (95, 102, 112),
    'body_mid':        (175, 180, 190),
    'core_inner':      (225, 230, 240),
    'core_outer':      (165, 175, 195),
    'eye_iris':        (145, 175, 195),
    'eye_white':       (238, 242, 248),
    'eye_pupil':       (12, 12, 18),
    'appendage_base':  (145, 155, 170),
    'appendage_tip':   (185, 200, 215),
    'glow_color':      (165, 180, 205),
    'particle_color':  (205, 215, 230),
    'pattern_color':   (118, 122, 138),
    'outline':         (18, 18, 22),
    'inner_highlight': (195, 205, 215),
    'cheek_blush':     (200, 170, 180),
    'tear_color':      (170, 200, 240),
    'sparkle_color':   (230, 235, 245),
}


# ---------------------------------------------------------------------------
# Mood-specific accent colors (for overlays, particles, effects)
# ---------------------------------------------------------------------------

MOOD_ACCENTS = {
    'neutral':      {'accent': (200, 200, 210), 'particle': (220, 220, 230)},
    'happy':        {'accent': (255, 220, 100), 'particle': (255, 255, 180),
                     'blush': (255, 160, 130)},
    'sad':          {'accent': (100, 130, 200), 'particle': (140, 170, 220),
                     'tear': (160, 200, 255)},
    'sick':         {'accent': (140, 200, 100), 'particle': (160, 210, 130),
                     'tint': (120, 180, 80)},
    'sleep':        {'accent': (100, 100, 160), 'particle': (160, 160, 220),
                     'z_color': (180, 180, 240)},
    'play':         {'accent': (255, 180, 80), 'particle': (255, 220, 140)},
    'sing':         {'accent': (200, 160, 255), 'particle': (220, 190, 255)},
    'eat':          {'accent': (255, 200, 120), 'particle': (255, 230, 160)},
    'love':         {'accent': (255, 120, 160), 'particle': (255, 180, 200),
                     'heart': (255, 80, 120)},
    'hungry':       {'accent': (220, 180, 100), 'particle': (240, 210, 140)},
    'dying':        {'accent': (100, 80, 100), 'particle': (140, 120, 140)},
    'evolving':     {'accent': (255, 240, 200), 'particle': (255, 255, 220)},
    'transcending': {'accent': (200, 220, 255), 'particle': (220, 240, 255)},
    'hatching':     {'accent': (255, 240, 200), 'particle': (255, 250, 220)},
}


# ---------------------------------------------------------------------------
# Mood color shift targets (RGB offsets applied to the active palette)
# ---------------------------------------------------------------------------

MOOD_SHIFTS = {
    'neutral':      {'r': 0,   'g': 0,   'b': 0,   'sat': 0.0},
    'happy':        {'r': 25,  'g': 15,  'b': -10, 'sat': 0.15},
    'sad':          {'r': -25, 'g': -15, 'b': 20,  'sat': -0.35},
    'sick':         {'r': -20, 'g': 25,  'b': -15, 'sat': -0.25},
    'sleep':        {'r': -15, 'g': -10, 'b': 20,  'sat': -0.2},
    'play':         {'r': 20,  'g': 20,  'b': 5,   'sat': 0.2},
    'sing':         {'r': 12,  'g': 8,   'b': 15,  'sat': 0.12},
    'eat':          {'r': 12,  'g': 8,   'b': -5,  'sat': 0.08},
    'love':         {'r': 30,  'g': -5,  'b': 10,  'sat': 0.15},
    'hungry':       {'r': -5,  'g': -10, 'b': -10, 'sat': -0.1},
    'dying':        {'r': -35, 'g': -25, 'b': -15, 'sat': -0.55},
    'evolving':     {'r': 25,  'g': 25,  'b': 25,  'sat': 0.25},
    'transcending': {'r': 12,  'g': 12,  'b': 25,  'sat': -0.1},
    'hatching':     {'r': 15,  'g': 10,  'b': 5,   'sat': 0.1},
}


# ---------------------------------------------------------------------------
# Palette interpolation and retrieval
# ---------------------------------------------------------------------------

def _lerp_semantic(p1, p2, t):
    """Interpolate between two semantic palettes slot by slot."""
    result = {}
    for key in p1:
        if key not in p2:
            result[key] = p1[key]
            continue
        c1 = p1[key]
        c2 = p2[key]
        result[key] = tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))
    return result


def get_palette(warmth_value):
    """Get an interpolated semantic palette based on warmth (0-255).

    0 = COOL, 85 = NEUTRAL, 170 = IRIDESCENT, 255 = WARM.

    Returns:
        dict with semantic color slots (RGB tuples)
    """
    warmth = warmth_value / 255.0

    if warmth < 0.33:
        t = warmth / 0.33
        return _lerp_semantic(COOL_PALETTE, NEUTRAL_PALETTE, t)
    elif warmth < 0.66:
        t = (warmth - 0.33) / 0.33
        return _lerp_semantic(NEUTRAL_PALETTE, IRIDESCENT_PALETTE, t)
    else:
        t = (warmth - 0.66) / 0.34
        return _lerp_semantic(IRIDESCENT_PALETTE, WARM_PALETTE, t)


def get_body_colors(palette, alpha_body=200, alpha_core=240):
    """Convert semantic palette to RGBA body colors dict."""
    colors = {
        'body':           (*palette['body_base'], alpha_body),
        'body_dark':      (*palette['body_shadow'], min(255, alpha_body + 20)),
        'body_light':     (*palette['body_highlight'], max(0, alpha_body - 20)),
        'body_mid':       (*palette['body_mid'], alpha_body),
        'core':           (*palette['core_outer'], alpha_core),
        'core_bright':    (*palette['core_inner'], 255),
        'core_rgb':       palette['core_outer'],
        'core_inner_rgb': palette['core_inner'],
        'eye_white':      (*palette['eye_white'], 255),
        'eye_iris':       (*palette['eye_iris'], 255),
        'eye_pupil':      (*palette['eye_pupil'], 255),
        'eyes':           (*palette['eye_white'], 255),
        'outline':        (*palette['outline'], 255),
        'inner':          (*palette['inner_highlight'], 160),
        'appendage':      (*palette['appendage_base'], 200),
        'appendage_tip':  (*palette['appendage_tip'], 180),
        'glow':           palette['glow_color'],
        'particle':       (*palette['particle_color'], 200),
        'pattern':        (*palette['pattern_color'], 100),
        'tip_glow':       (*palette['appendage_tip'], 220),
    }
    # Add mood-specific colors if present in palette
    if 'cheek_blush' in palette:
        colors['cheek_blush'] = (*palette['cheek_blush'], 100)
    if 'tear_color' in palette:
        colors['tear_color'] = (*palette['tear_color'], 200)
    if 'sparkle_color' in palette:
        colors['sparkle_color'] = (*palette['sparkle_color'], 230)
    return colors


def get_mood_accents(mood='neutral'):
    """Get mood-specific accent colors for effects."""
    return MOOD_ACCENTS.get(mood, MOOD_ACCENTS['neutral'])


def apply_mood_shift(palette, mood='neutral'):
    """Apply mood-based color shift to a semantic palette."""
    shift = MOOD_SHIFTS.get(mood, MOOD_SHIFTS['neutral'])
    dr, dg, db = shift['r'], shift['g'], shift['b']
    sat_shift = shift['sat']

    result = {}
    for key, val in palette.items():
        if not isinstance(val, tuple) or len(val) < 3:
            result[key] = val
            continue
        r, g, b = val[:3]
        # Apply RGB shift
        nr = max(0, min(255, r + dr))
        ng = max(0, min(255, g + dg))
        nb = max(0, min(255, b + db))

        # Apply saturation shift
        if sat_shift != 0:
            gray = int(0.299 * nr + 0.587 * ng + 0.114 * nb)
            if sat_shift > 0:
                nr = int(nr + (nr - gray) * sat_shift)
                ng = int(ng + (ng - gray) * sat_shift)
                nb = int(nb + (nb - gray) * sat_shift)
            else:
                amt = abs(sat_shift)
                nr = int(nr + (gray - nr) * amt)
                ng = int(ng + (gray - ng) * amt)
                nb = int(nb + (gray - nb) * amt)

        result[key] = (max(0, min(255, nr)),
                       max(0, min(255, ng)),
                       max(0, min(255, nb)))
    return result


def desaturate_palette(palette, amount=0.4):
    """Desaturate a semantic palette by blending toward gray."""
    if isinstance(palette, dict):
        result = {}
        for key, val in palette.items():
            if not isinstance(val, tuple) or len(val) < 3:
                result[key] = val
                continue
            r, g, b = val[:3]
            gray = int(0.299 * r + 0.587 * g + 0.114 * b)
            nr = int(r + (gray - r) * amount)
            ng = int(g + (gray - g) * amount)
            nb = int(b + (gray - b) * amount)
            result[key] = (nr, ng, nb)
        return result
    else:
        result = []
        for r, g, b in palette:
            gray = int(0.299 * r + 0.587 * g + 0.114 * b)
            nr = int(r + (gray - r) * amount)
            ng = int(g + (gray - g) * amount)
            nb = int(b + (gray - b) * amount)
            result.append((nr, ng, nb))
        return result


def sage_palette(palette):
    """Create the noble sage-stage palette: desaturated with silver/deep-blue tones."""
    shifted = desaturate_palette(palette, 0.35)
    result = {}
    for key, val in shifted.items():
        if not isinstance(val, tuple) or len(val) < 3:
            result[key] = val
            continue
        r, g, b = val[:3]
        nr = int(r * 0.88 + 25)
        ng = int(g * 0.90 + 20)
        nb = int(b * 0.93 + 30)
        result[key] = (max(0, min(255, nr)),
                       max(0, min(255, ng)),
                       max(0, min(255, nb)))
    return result


def transcendence_palette(palette, phase=0.0):
    """Create iridescent shifting palette for transcendence stage."""
    result = {}
    shift = int(phase * 60)

    for key, val in palette.items():
        if not isinstance(val, tuple) or len(val) < 3:
            result[key] = val
            continue
        r, g, b = val[:3]
        nr = int((r * math.cos(shift * 0.02) + g * math.sin(shift * 0.02)))
        ng = int((g * math.cos(shift * 0.025) + b * math.sin(shift * 0.025)))
        nb = int((b * math.cos(shift * 0.03) + r * math.sin(shift * 0.03)))
        nr = int(nr * 0.65 + 90)
        ng = int(ng * 0.65 + 90)
        nb = int(nb * 0.65 + 90)
        result[key] = (max(0, min(255, nr)),
                       max(0, min(255, ng)),
                       max(0, min(255, nb)))
    return result


def stage_color_warmth(stage, base_warmth):
    """Adjust palette warmth based on developmental stage.

    Young stages -> cooler/simpler, mature -> warmer/richer,
    elder/transcendent -> ethereal/luminous.
    """
    stage_shifts = {
        0: -30,   # egg: cooler
        1: -20,   # newborn: slightly cool
        2: -10,   # infant: neutral-cool
        3: 0,     # child: base
        4: 10,    # teen: warming
        5: 20,    # adult: warm, rich
        6: -15,   # elder: desaturated noble
        7: 5,     # transcendent: ethereal
    }
    shift = stage_shifts.get(stage, 0)
    return max(0, min(255, base_warmth + shift))
