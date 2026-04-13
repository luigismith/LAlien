"""
palettes.py - Semantic color palettes for Lalien sprite generation.
Each palette provides named color slots for body, core, eyes, appendages, etc.
Supports mood-based palette shifting and stage-based desaturation.
"""


# ---------------------------------------------------------------------------
# Base palette definitions with semantic color slots
# Each entry is RGB (alpha added contextually)
# ---------------------------------------------------------------------------

WARM_PALETTE = {
    'body_base':       (240, 130, 90),    # warm coral-orange
    'body_highlight':  (255, 190, 140),   # light peach
    'body_shadow':     (180, 80, 50),     # deep rust
    'body_mid':        (250, 160, 110),   # medium coral
    'core_inner':      (255, 240, 200),   # warm white glow
    'core_outer':      (255, 160, 80),    # amber glow
    'eye_iris':        (255, 180, 60),    # golden amber
    'eye_white':       (255, 245, 235),   # warm white
    'eye_pupil':       (30, 15, 10),      # warm black
    'appendage_base':  (240, 140, 100),   # coral
    'appendage_tip':   (255, 200, 100),   # golden tip
    'glow_color':      (255, 180, 100),   # amber glow
    'particle_color':  (255, 220, 140),   # warm sparkle
    'pattern_color':   (200, 100, 60),    # darker pattern
    'outline':         (60, 25, 15),      # warm dark brown
    'inner_highlight': (255, 200, 160),   # warm inner contour
}

COOL_PALETTE = {
    'body_base':       (80, 150, 200),    # ocean blue
    'body_highlight':  (140, 200, 230),   # sky blue
    'body_shadow':     (30, 80, 140),     # deep ocean
    'body_mid':        (100, 170, 210),   # mid blue
    'core_inner':      (200, 230, 255),   # cool white
    'core_outer':      (80, 160, 220),    # blue glow
    'eye_iris':        (100, 200, 220),   # teal iris
    'eye_white':       (230, 245, 255),   # cool white
    'eye_pupil':       (10, 15, 30),      # cool black
    'appendage_base':  (70, 140, 190),    # blue
    'appendage_tip':   (120, 210, 230),   # cyan tip
    'glow_color':      (100, 180, 240),   # blue glow
    'particle_color':  (160, 220, 255),   # ice sparkle
    'pattern_color':   (50, 110, 170),    # darker blue pattern
    'outline':         (10, 20, 40),      # dark navy
    'inner_highlight': (160, 210, 240),   # cool inner contour
}

IRIDESCENT_PALETTE = {
    'body_base':       (140, 100, 180),   # violet
    'body_highlight':  (180, 160, 220),   # lavender
    'body_shadow':     (80, 50, 120),     # deep purple
    'body_mid':        (150, 120, 190),   # mid violet
    'core_inner':      (230, 210, 255),   # pale violet white
    'core_outer':      (160, 100, 200),   # violet glow
    'eye_iris':        (120, 200, 170),   # jade-green iris
    'eye_white':       (240, 235, 255),   # lavender white
    'eye_pupil':       (15, 10, 25),      # dark purple-black
    'appendage_base':  (130, 100, 170),   # purple
    'appendage_tip':   (100, 200, 160),   # jade tip
    'glow_color':      (160, 120, 220),   # purple glow
    'particle_color':  (180, 200, 255),   # opal sparkle
    'pattern_color':   (100, 70, 150),    # dark purple pattern
    'outline':         (20, 10, 35),      # very dark purple
    'inner_highlight': (180, 160, 220),   # lavender inner contour
}

NEUTRAL_PALETTE = {
    'body_base':       (150, 160, 170),   # blue-gray
    'body_highlight':  (200, 205, 210),   # light gray
    'body_shadow':     (100, 105, 115),   # dark gray
    'body_mid':        (170, 175, 185),   # mid gray
    'core_inner':      (220, 225, 235),   # cool white
    'core_outer':      (160, 170, 190),   # steel blue glow
    'eye_iris':        (140, 170, 190),   # steel blue
    'eye_white':       (235, 240, 245),   # neutral white
    'eye_pupil':       (15, 15, 20),      # dark gray
    'appendage_base':  (140, 150, 165),   # gray
    'appendage_tip':   (180, 195, 210),   # light steel
    'glow_color':      (160, 175, 200),   # steel glow
    'particle_color':  (200, 210, 225),   # silver sparkle
    'pattern_color':   (120, 125, 140),   # darker gray
    'outline':         (20, 20, 25),      # near-black
    'inner_highlight': (190, 200, 210),   # light inner contour
}


# ---------------------------------------------------------------------------
# Mood color shift targets (RGB offsets applied to the active palette)
# ---------------------------------------------------------------------------

MOOD_SHIFTS = {
    'neutral':  {'r': 0, 'g': 0, 'b': 0, 'sat': 0.0},
    'happy':    {'r': 20, 'g': 10, 'b': -10, 'sat': 0.1},
    'sad':      {'r': -20, 'g': -10, 'b': 15, 'sat': -0.3},
    'sick':     {'r': -15, 'g': 20, 'b': -10, 'sat': -0.2},
    'sleep':    {'r': -10, 'g': -5, 'b': 15, 'sat': -0.15},
    'play':     {'r': 15, 'g': 15, 'b': 0, 'sat': 0.15},
    'sing':     {'r': 10, 'g': 5, 'b': 10, 'sat': 0.1},
    'eat':      {'r': 10, 'g': 5, 'b': -5, 'sat': 0.05},
    'dying':    {'r': -30, 'g': -20, 'b': -10, 'sat': -0.5},
    'evolving': {'r': 20, 'g': 20, 'b': 20, 'sat': 0.2},
    'transcending': {'r': 10, 'g': 10, 'b': 20, 'sat': -0.1},
}


# ---------------------------------------------------------------------------
# Palette interpolation and retrieval
# ---------------------------------------------------------------------------

def _lerp_semantic(p1, p2, t):
    """Interpolate between two semantic palettes slot by slot."""
    result = {}
    for key in p1:
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
    """Convert semantic palette to RGBA body colors dict.

    Args:
        palette: semantic palette dict (RGB values)
        alpha_body: default body alpha (semi-translucent)
        alpha_core: core alpha

    Returns:
        dict with RGBA tuples ready for drawing
    """
    return {
        'body':           (*palette['body_base'], alpha_body),
        'body_dark':      (*palette['body_shadow'], alpha_body + 20),
        'body_light':     (*palette['body_highlight'], alpha_body - 20),
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


def apply_mood_shift(palette, mood='neutral'):
    """Apply mood-based color shift to a semantic palette.

    Returns a new shifted palette dict.
    """
    shift = MOOD_SHIFTS.get(mood, MOOD_SHIFTS['neutral'])
    dr, dg, db = shift['r'], shift['g'], shift['b']
    sat_shift = shift['sat']

    result = {}
    for key, (r, g, b) in palette.items():
        # Apply RGB shift
        nr = max(0, min(255, r + dr))
        ng = max(0, min(255, g + dg))
        nb = max(0, min(255, b + db))

        # Apply saturation shift
        if sat_shift != 0:
            gray = int(0.299 * nr + 0.587 * ng + 0.114 * nb)
            if sat_shift > 0:
                # Increase saturation (move away from gray)
                nr = int(nr + (nr - gray) * sat_shift)
                ng = int(ng + (ng - gray) * sat_shift)
                nb = int(nb + (nb - gray) * sat_shift)
            else:
                # Decrease saturation (move toward gray)
                amt = abs(sat_shift)
                nr = int(nr + (gray - nr) * amt)
                ng = int(ng + (gray - ng) * amt)
                nb = int(nb + (gray - nb) * amt)

        result[key] = (max(0, min(255, nr)),
                       max(0, min(255, ng)),
                       max(0, min(255, nb)))
    return result


def desaturate_palette(palette, amount=0.4):
    """Desaturate a semantic palette by blending toward gray.

    Works with both semantic dict palettes and legacy list palettes.
    """
    if isinstance(palette, dict):
        result = {}
        for key, (r, g, b) in palette.items():
            gray = int(0.299 * r + 0.587 * g + 0.114 * b)
            nr = int(r + (gray - r) * amount)
            ng = int(g + (gray - g) * amount)
            nb = int(b + (gray - b) * amount)
            result[key] = (nr, ng, nb)
        return result
    else:
        # Legacy list support
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
    # Push toward noble silver-blue
    result = {}
    for key, (r, g, b) in shifted.items():
        # Add slight blue-silver cast
        nr = int(r * 0.9 + 20)
        ng = int(g * 0.92 + 15)
        nb = int(b * 0.95 + 25)
        result[key] = (max(0, min(255, nr)),
                       max(0, min(255, ng)),
                       max(0, min(255, nb)))
    return result


def transcendence_palette(palette, phase=0.0):
    """Create iridescent shifting palette for transcendence stage."""
    # Shift hue based on phase
    result = {}
    shift = int(phase * 60)  # Rotate colors

    for key, (r, g, b) in palette.items():
        # Rotate through spectrum
        nr = int((r * math.cos(shift * 0.02) + g * math.sin(shift * 0.02)))
        ng = int((g * math.cos(shift * 0.025) + b * math.sin(shift * 0.025)))
        nb = int((b * math.cos(shift * 0.03) + r * math.sin(shift * 0.03)))
        # Brighten and saturate
        nr = int(nr * 0.7 + 80)
        ng = int(ng * 0.7 + 80)
        nb = int(nb * 0.7 + 80)
        result[key] = (max(0, min(255, nr)),
                       max(0, min(255, ng)),
                       max(0, min(255, nb)))
    return result


import math  # needed for transcendence_palette
