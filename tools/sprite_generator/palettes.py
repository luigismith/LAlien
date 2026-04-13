"""
palettes.py - Color palettes for Lalien sprite generation.
Each palette has 8-16 RGB colors suited to the creature's personality warmth.
"""


# WARM palette (affectionate): oranges, pinks, golds
WARM = [
    (255, 120, 60),   # bright orange
    (255, 160, 80),   # light orange
    (255, 90, 100),   # coral pink
    (255, 180, 120),  # peach
    (255, 200, 80),   # gold
    (220, 100, 60),   # deep orange
    (255, 140, 160),  # soft pink
    (200, 80, 40),    # burnt sienna
    (255, 220, 160),  # pale gold
    (180, 60, 40),    # dark rust
    (255, 100, 80),   # salmon
    (240, 180, 100),  # amber
]

# COOL palette (reserved): blues, teals, silvers
COOL = [
    (60, 140, 220),   # sky blue
    (40, 100, 180),   # ocean blue
    (80, 200, 200),   # teal
    (100, 160, 200),  # steel blue
    (160, 200, 220),  # ice blue
    (60, 180, 180),   # cyan
    (180, 200, 220),  # silver
    (30, 80, 140),    # deep blue
    (120, 180, 200),  # pale teal
    (200, 220, 240),  # frost
    (40, 120, 160),   # dark teal
    (140, 180, 220),  # periwinkle
]

# IRIDESCENT palette (wise): shifting purples, greens, opalescent
IRIDESCENT = [
    (160, 80, 200),   # violet
    (100, 200, 160),  # jade
    (180, 120, 220),  # lavender
    (80, 180, 140),   # emerald
    (200, 160, 240),  # opal pink
    (60, 160, 120),   # deep jade
    (220, 180, 255),  # pale violet
    (140, 220, 200),  # mint
    (120, 60, 160),   # deep purple
    (180, 240, 220),  # pale mint
    (100, 140, 200),  # blue-violet
    (160, 200, 180),  # sage
]

# NEUTRAL palette: balanced
NEUTRAL = [
    (140, 160, 180),  # blue-gray
    (180, 160, 140),  # warm gray
    (160, 180, 160),  # sage gray
    (160, 140, 180),  # lavender gray
    (200, 200, 200),  # light gray
    (120, 140, 160),  # steel
    (180, 180, 160),  # warm stone
    (140, 160, 140),  # moss
    (160, 160, 180),  # cool gray
    (200, 180, 160),  # sand
    (140, 140, 160),  # slate
    (180, 200, 180),  # pale sage
]


def _lerp_palette(p1, p2, t):
    """Interpolate between two palettes element-wise."""
    length = min(len(p1), len(p2))
    result = []
    for i in range(length):
        r = int(p1[i][0] + (p2[i][0] - p1[i][0]) * t)
        g = int(p1[i][1] + (p2[i][1] - p1[i][1]) * t)
        b = int(p1[i][2] + (p2[i][2] - p1[i][2]) * t)
        result.append((r, g, b))
    return result


def get_palette(warmth_value):
    """Get an interpolated palette based on warmth (0-255).

    0 = COOL, 85 = NEUTRAL, 170 = IRIDESCENT, 255 = WARM.

    Args:
        warmth_value: int 0-255

    Returns:
        list of RGB tuples
    """
    warmth = warmth_value / 255.0

    if warmth < 0.33:
        t = warmth / 0.33
        return _lerp_palette(COOL, NEUTRAL, t)
    elif warmth < 0.66:
        t = (warmth - 0.33) / 0.33
        return _lerp_palette(NEUTRAL, IRIDESCENT, t)
    else:
        t = (warmth - 0.66) / 0.34
        return _lerp_palette(IRIDESCENT, WARM, t)


def get_body_colors(palette):
    """Extract key body colors from a palette.

    Returns dict with: body, body_dark, body_light, core, eyes, outline, inner
    """
    return {
        'body': (*palette[0], 200),        # main body (semi-translucent)
        'body_dark': (*palette[7], 220),   # darker shade
        'body_light': (*palette[4], 180),  # highlight
        'core': (*palette[3], 240),        # core glow color
        'core_bright': (*palette[8], 255), # core bright center
        'eyes': (220, 240, 255, 255),      # eye sclera (always light)
        'outline': (10, 10, 20, 255),      # dark outline
        'inner': (*palette[4], 160),       # inner contour highlight
        'appendage': (*palette[1], 200),   # appendage base
        'appendage_tip': (*palette[4], 140), # appendage tip (lighter)
    }


def desaturate_palette(palette, amount=0.4):
    """Desaturate a palette by blending toward gray.

    Args:
        palette: list of RGB tuples
        amount: 0.0 = no change, 1.0 = fully gray

    Returns:
        Desaturated palette
    """
    result = []
    for r, g, b in palette:
        gray = int(0.299 * r + 0.587 * g + 0.114 * b)
        nr = int(r + (gray - r) * amount)
        ng = int(g + (gray - g) * amount)
        nb = int(b + (gray - b) * amount)
        result.append((nr, ng, nb))
    return result
