"""
primitives.py - Drawing helper functions for Lalien sprite generation.
Advanced pixel-art rendering with 2x supersampling, bezier curves,
particle systems, bioluminescent glow, and translucency effects.
"""

import math
from PIL import Image, ImageDraw, ImageFilter
import numpy as np


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
RENDER_SCALE = 2  # Draw at 2x, downsample for anti-aliased look


# ---------------------------------------------------------------------------
# Supersampling helpers
# ---------------------------------------------------------------------------

def create_hires_canvas(size=64):
    """Create a 2x resolution canvas for supersampled rendering."""
    s = size * RENDER_SCALE
    return Image.new('RGBA', (s, s), (0, 0, 0, 0))


def downsample(hires_img, target_size=64):
    """Downsample a 2x image to target size using area averaging (anti-alias)."""
    return hires_img.resize((target_size, target_size), Image.LANCZOS)


def s(val):
    """Scale a coordinate or size to hires space."""
    if isinstance(val, (tuple, list)):
        return tuple(int(v * RENDER_SCALE) for v in val)
    return int(val * RENDER_SCALE)


# ---------------------------------------------------------------------------
# Basic shapes (operate on hires canvas)
# ---------------------------------------------------------------------------

def draw_oval(img, bbox, color, outline_color=None):
    """Draw a filled oval with optional outline."""
    draw = ImageDraw.Draw(img)
    if outline_color:
        draw.ellipse(bbox, fill=color, outline=outline_color)
    else:
        draw.ellipse(bbox, fill=color)


def draw_body_blob(img, cx, cy, width, height, color, outline_col=None,
                   squash=0.0, irregularity=0.0, seed=0):
    """Draw an organic blob shape using polygon for more natural look.

    Args:
        img: PIL Image (RGBA)
        cx, cy: center
        width, height: half-extents
        color: RGBA fill
        outline_col: RGBA outline or None
        squash: vertical squash factor (-1 to 1), positive = bottom wider
        irregularity: 0-1, adds organic wobble
        seed: seed for wobble reproducibility
    """
    draw = ImageDraw.Draw(img)
    rng = np.random.RandomState(seed)
    points = []
    num_pts = 32

    for i in range(num_pts):
        angle = (i / num_pts) * 2 * math.pi
        # Base ellipse
        rx = width
        ry = height
        # Squash: make bottom wider or narrower
        if math.sin(angle) > 0:  # bottom half
            rx *= (1.0 + squash * 0.15)
        # Organic irregularity
        wobble = 1.0
        if irregularity > 0:
            wobble = 1.0 + rng.uniform(-irregularity, irregularity) * 0.12
        px = cx + math.cos(angle) * rx * wobble
        py = cy + math.sin(angle) * ry * wobble
        points.append((int(px), int(py)))

    draw.polygon(points, fill=color, outline=outline_col)


def draw_symmetric(img, draw_func):
    """Draw with bilateral symmetry: draw on left half, mirror to right."""
    w, h = img.size
    mid = w // 2
    work = img.copy()
    draw = ImageDraw.Draw(work)
    draw_func(work, draw)
    pixels = np.array(work)
    left_half = pixels[:, :mid, :]
    right_half = np.flip(left_half, axis=1)
    if w % 2 == 0:
        pixels[:, mid:, :] = right_half
    else:
        pixels[:, mid + 1:, :] = right_half
    result = Image.fromarray(pixels, 'RGBA')
    return result


# ---------------------------------------------------------------------------
# Glow and luminescence
# ---------------------------------------------------------------------------

def add_glow(img, center, radius, color, intensity=0.6, falloff=2.0):
    """Add a radial glow with gaussian-like falloff.

    Args:
        img: PIL Image (RGBA)
        center: (cx, cy)
        radius: glow radius
        color: RGB tuple
        intensity: 0-1 strength
        falloff: exponent for falloff curve (higher = tighter glow)
    """
    pixels = np.array(img, dtype=np.float64)
    h, w, _ = pixels.shape
    cx, cy = center

    y_coords, x_coords = np.mgrid[0:h, 0:w]
    dist = np.sqrt((x_coords - cx) ** 2 + (y_coords - cy) ** 2)

    # Gaussian-like falloff
    sigma = radius / 2.0
    glow_strength = np.exp(-(dist ** 2) / (2 * sigma ** 2)) * intensity

    mask = pixels[:, :, 3] > 0

    for i in range(3):
        pixels[:, :, i] = np.where(
            mask,
            np.clip(pixels[:, :, i] + glow_strength * color[i], 0, 255),
            pixels[:, :, i]
        )

    return Image.fromarray(pixels.astype(np.uint8), 'RGBA')


def add_background_glow(img, center, radius, color, intensity=0.3):
    """Add glow that also appears on transparent pixels (aura behind body).

    Creates visible halo even where body is not drawn.
    """
    pixels = np.array(img, dtype=np.float64)
    h, w, _ = pixels.shape
    cx, cy = center

    y_coords, x_coords = np.mgrid[0:h, 0:w]
    dist = np.sqrt((x_coords - cx) ** 2 + (y_coords - cy) ** 2)
    sigma = radius / 2.0
    glow_strength = np.exp(-(dist ** 2) / (2 * sigma ** 2)) * intensity

    # Apply to transparent pixels too
    for i in range(3):
        pixels[:, :, i] = np.clip(pixels[:, :, i] + glow_strength * color[i], 0, 255)
    # Set alpha where glow is visible
    glow_alpha = np.clip(glow_strength * 255, 0, 255)
    pixels[:, :, 3] = np.clip(pixels[:, :, 3] + glow_alpha * 0.5, 0, 255)

    return Image.fromarray(pixels.astype(np.uint8), 'RGBA')


def pulse_core(img, center, radius, color, phase=0.0, intensity=0.8):
    """Draw a pulsating luminous core with soft radial gradient.

    The core shows through semi-transparent body for translucency effect.
    """
    pulse_factor = 0.7 + 0.3 * math.sin(phase * 2 * math.pi)
    actual_radius = radius * pulse_factor
    brightness = 0.5 + 0.5 * math.sin(phase * 2 * math.pi)

    pixels = np.array(img, dtype=np.float64)
    h, w, _ = pixels.shape
    cx, cy = center

    y_coords, x_coords = np.mgrid[0:h, 0:w]
    dist = np.sqrt((x_coords - cx) ** 2 + (y_coords - cy) ** 2)

    # Soft gaussian core
    sigma = actual_radius / 1.8
    core_strength = np.exp(-(dist ** 2) / (2 * sigma ** 2)) * brightness * intensity

    # Inner bright center (small, very bright)
    inner_sigma = actual_radius / 4.0
    inner_strength = np.exp(-(dist ** 2) / (2 * inner_sigma ** 2)) * brightness

    for i in range(3):
        # Outer glow tinted by color
        pixels[:, :, i] = np.clip(
            pixels[:, :, i] + core_strength * color[i] * 0.7, 0, 255
        )
        # Inner bright white-ish center
        bright = min(255, color[i] + 80)
        pixels[:, :, i] = np.clip(
            pixels[:, :, i] + inner_strength * bright * 0.4, 0, 255
        )

    # Boost alpha where core is visible
    pixels[:, :, 3] = np.where(
        (dist < actual_radius * 1.5) & (pixels[:, :, 3] > 0),
        np.clip(pixels[:, :, 3] + core_strength * 60, 0, 255),
        pixels[:, :, 3]
    )

    return Image.fromarray(pixels.astype(np.uint8), 'RGBA')


def draw_core_behind_body(body_img, center, radius, color, phase=0.0, body_alpha_factor=0.5):
    """Draw the core glow on a separate layer behind the body, then composite
    so the core 'shows through' translucent body membrane."""
    w, h = body_img.size
    core_layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    core_layer = pulse_core(core_layer, center, radius, color, phase, intensity=1.0)

    # Composite: core behind, body on top with translucency
    result = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    result = Image.alpha_composite(result, core_layer)
    result = Image.alpha_composite(result, body_img)

    # Blend some core light through body pixels (translucency simulation)
    r_pixels = np.array(result, dtype=np.float64)
    c_pixels = np.array(core_layer, dtype=np.float64)
    b_pixels = np.array(body_img, dtype=np.float64)

    body_mask = b_pixels[:, :, 3] > 30
    core_visible = c_pixels[:, :, 3] > 10

    bleed = body_mask & core_visible
    for i in range(3):
        r_pixels[:, :, i] = np.where(
            bleed,
            np.clip(r_pixels[:, :, i] + c_pixels[:, :, i] * body_alpha_factor * 0.3, 0, 255),
            r_pixels[:, :, i]
        )

    return Image.fromarray(r_pixels.astype(np.uint8), 'RGBA')


# ---------------------------------------------------------------------------
# Eyes (detailed with iris, pupil, catch-light)
# ---------------------------------------------------------------------------

def draw_eye(img, cx, cy, radius, pupil_ratio=0.4,
             eye_color=(220, 240, 255, 255),
             pupil_color=(10, 10, 30, 255),
             highlight_color=(255, 255, 255, 255),
             iris_color=None, mood='neutral', blink=0.0):
    """Draw a detailed eye with iris ring, pupil, and catch-lights.

    Args:
        iris_color: RGBA for iris ring. If None, uses eye_color darkened.
        mood: 'neutral', 'happy' (crescent), 'sad' (droopy), 'closed'
        blink: 0.0 (open) to 1.0 (closed). Overrides mood for partial blink.
    """
    draw = ImageDraw.Draw(img)

    if mood == 'closed' or blink >= 0.95:
        # Draw as curved line (sleeping/closed)
        draw.arc(
            (cx - radius, cy - radius // 2, cx + radius, cy + radius // 2),
            0, 180, fill=pupil_color, width=max(1, radius // 3)
        )
        return

    if mood == 'happy':
        # Crescent-shaped smiling eyes (upside-down arc)
        draw.arc(
            (cx - radius, cy - radius, cx + radius, cy + radius),
            200, 340, fill=pupil_color, width=max(1, radius // 2)
        )
        # Small highlight
        hr = max(1, radius // 4)
        draw.ellipse((cx - hr, cy - radius // 2 - hr,
                       cx + hr, cy - radius // 2 + hr),
                      fill=highlight_color)
        return

    # Blink: reduce visible height
    effective_h = radius
    if blink > 0:
        effective_h = max(1, int(radius * (1.0 - blink)))

    # Sclera (white of eye)
    draw.ellipse(
        (cx - radius, cy - effective_h, cx + radius, cy + effective_h),
        fill=eye_color
    )

    # Iris ring
    if iris_color is None:
        iris_color = tuple(max(0, c - 60) for c in eye_color[:3]) + (eye_color[3],)
    ir = max(1, int(radius * 0.7))
    ir_h = max(1, int(effective_h * 0.7))
    draw.ellipse(
        (cx - ir, cy - ir_h, cx + ir, cy + ir_h),
        fill=iris_color
    )

    # Pupil
    pr = max(1, int(radius * pupil_ratio))
    pr_h = max(1, int(min(pr, effective_h * 0.5)))
    draw.ellipse((cx - pr, cy - pr_h, cx + pr, cy + pr_h), fill=pupil_color)

    # Catch-light highlights (two: one large, one small)
    # Main highlight (upper-left)
    hr = max(1, int(radius * 0.25))
    hx = cx - int(radius * 0.25)
    hy = cy - int(effective_h * 0.3)
    draw.ellipse((hx - hr, hy - hr, hx + hr, hy + hr), fill=highlight_color)

    # Secondary small highlight (lower-right)
    sr = max(1, hr // 2)
    sx = cx + int(radius * 0.2)
    sy = cy + int(effective_h * 0.15)
    draw.ellipse((sx - sr, sy - sr, sx + sr, sy + sr),
                  fill=(*highlight_color[:3], highlight_color[3] // 2))

    # Sad: add heavy upper lid
    if mood == 'sad':
        lid_y = cy - effective_h
        # Draw a thick arc for droopy eyelid
        for dy in range(max(1, effective_h // 2)):
            alpha = max(0, 200 - dy * 60)
            if alpha > 0:
                draw.line(
                    (cx - radius, lid_y + dy, cx + radius, lid_y + dy),
                    fill=(*pupil_color[:3], alpha), width=1
                )


def draw_eye_pair(img, cx, cy, body_w, eye_y_offset, eye_radius,
                  eye_spacing_frac, colors, mood='neutral', blink=0.0,
                  iris_color=None):
    """Draw a symmetric pair of eyes."""
    eye_y = cy + eye_y_offset
    spacing = int(body_w * eye_spacing_frac)

    for side in [-1, 1]:
        ex = cx + side * spacing
        draw_eye(
            img, ex, eye_y, eye_radius,
            pupil_ratio=0.4,
            eye_color=colors.get('eye_white', (220, 240, 255, 255)),
            pupil_color=colors.get('eye_pupil', (10, 10, 30, 255)),
            highlight_color=(255, 255, 255, 255),
            iris_color=iris_color or colors.get('eye_iris'),
            mood=mood, blink=blink
        )


# ---------------------------------------------------------------------------
# Bezier curves for appendages
# ---------------------------------------------------------------------------

def _bezier_point(p0, p1, p2, p3, t):
    """Cubic bezier curve point at parameter t."""
    u = 1.0 - t
    return (
        u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0],
        u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1],
    )


def draw_appendage(img, base_x, base_y, length, angle, thickness, color,
                   tip_color=None, curl=0.3, wave_phase=0.0,
                   tip_glow_color=None):
    """Draw a tentacle/appendage using bezier curve with taper.

    Args:
        curl: 0-1, how much the appendage curls
        wave_phase: animation phase for dynamic curl
        tip_glow_color: if set, draw a small glow dot at the tip
    """
    draw = ImageDraw.Draw(img)

    # Bezier control points
    wave = math.sin(wave_phase * math.pi * 2) * curl
    end_angle = angle + wave * 1.5

    p0 = (base_x, base_y)
    p1 = (
        base_x + math.sin(angle) * length * 0.3,
        base_y + math.cos(angle) * length * 0.3
    )
    p2 = (
        base_x + math.sin(angle + wave * 0.5) * length * 0.7,
        base_y + math.cos(angle + wave * 0.5) * length * 0.7
    )
    p3 = (
        base_x + math.sin(end_angle) * length,
        base_y + math.cos(end_angle) * length
    )

    segments = max(8, length * 2)
    prev_x, prev_y = p0

    for i in range(1, int(segments) + 1):
        t = i / segments
        bx, by = _bezier_point(p0, p1, p2, p3, t)

        # Taper thickness from base to tip
        seg_thick = max(1, int(thickness * (1.0 - t * 0.85)))

        # Color gradient along appendage
        if tip_color:
            c = lerp_color(color, tip_color, t)
        else:
            c = color

        draw.ellipse(
            (int(bx - seg_thick), int(by - seg_thick),
             int(bx + seg_thick), int(by + seg_thick)),
            fill=c
        )

    # Tip glow (bioluminescent dot)
    if tip_glow_color:
        tx, ty = _bezier_point(p0, p1, p2, p3, 1.0)
        gr = max(1, thickness)
        draw.ellipse(
            (int(tx - gr), int(ty - gr), int(tx + gr), int(ty + gr)),
            fill=tip_glow_color
        )
        # Subtle glow halo around tip
        for ring in range(1, 3):
            alpha = max(0, tip_glow_color[3] - ring * 80)
            if alpha > 0:
                rr = gr + ring
                draw.ellipse(
                    (int(tx - rr), int(ty - rr), int(tx + rr), int(ty + rr)),
                    outline=(*tip_glow_color[:3], alpha)
                )


# ---------------------------------------------------------------------------
# Mouth
# ---------------------------------------------------------------------------

def draw_mouth(img, cx, cy, width, height, color=(40, 20, 40, 255),
               open_amount=0.0, mood='neutral'):
    """Draw mouth with mood expressions.

    mood: 'neutral', 'happy' (smile), 'sad' (frown), 'open' (eating)
    """
    draw = ImageDraw.Draw(img)
    hw = width // 2

    if mood == 'happy' or (mood == 'neutral' and open_amount < 0.1):
        # Smile: upward arc
        if mood == 'happy':
            draw.arc(
                (cx - hw, cy - height, cx + hw, cy + height),
                10, 170, fill=color, width=max(1, height // 2)
            )
        else:
            # Neutral: small line
            draw.line((cx - hw, cy, cx + hw, cy), fill=color, width=1)
    elif mood == 'sad':
        # Frown: downward arc
        draw.arc(
            (cx - hw, cy - height, cx + hw, cy + height),
            190, 350, fill=color, width=max(1, height // 2)
        )
    elif mood == 'open' or open_amount > 0.2:
        # Open mouth
        actual_h = max(1, int(height * (0.3 + 0.7 * open_amount)))
        draw.ellipse(
            (cx - hw, cy - actual_h // 2, cx + hw, cy + actual_h // 2),
            fill=color
        )
        # Inner highlight (darker inside)
        inner_hw = max(1, hw - 1)
        inner_h = max(1, actual_h // 2 - 1)
        if inner_hw > 0 and inner_h > 0:
            darker = tuple(max(0, c - 30) for c in color[:3]) + (color[3],)
            draw.ellipse(
                (cx - inner_hw, cy - inner_h, cx + inner_hw, cy + inner_h),
                fill=darker
            )


# ---------------------------------------------------------------------------
# Eyebrow ridges (emotional expression)
# ---------------------------------------------------------------------------

def draw_eyebrow_ridges(img, cx, cy, body_w, eye_y_offset, eye_spacing_frac,
                        color, mood='neutral'):
    """Draw small eyebrow ridges above eyes for expression."""
    draw = ImageDraw.Draw(img)
    spacing = int(body_w * eye_spacing_frac)
    brow_y = cy + eye_y_offset - 3  # slightly above eyes
    brow_len = max(2, int(body_w * 0.2))

    for side in [-1, 1]:
        bx = cx + side * spacing
        if mood == 'sad':
            # Inner end higher (worried look)
            draw.line(
                (bx - side * brow_len, brow_y + 1, bx + side * brow_len, brow_y - 1),
                fill=color, width=1
            )
        elif mood == 'happy':
            # Arched up
            draw.arc(
                (bx - brow_len, brow_y - 2, bx + brow_len, brow_y + 2),
                200, 340, fill=color, width=1
            )
        elif mood == 'angry':
            # Inner end lower (angry V)
            draw.line(
                (bx - side * brow_len, brow_y - 1, bx + side * brow_len, brow_y + 1),
                fill=color, width=1
            )
        else:
            # Neutral: small flat line
            draw.line(
                (bx - brow_len, brow_y, bx + brow_len, brow_y),
                fill=color, width=1
            )


# ---------------------------------------------------------------------------
# Particle system
# ---------------------------------------------------------------------------

class Particle:
    """A single luminous particle."""
    __slots__ = ('x', 'y', 'vx', 'vy', 'life', 'max_life', 'color', 'size')

    def __init__(self, x, y, vx, vy, life, color, size=1):
        self.x = x
        self.y = y
        self.vx = vx
        self.vy = vy
        self.life = life
        self.max_life = life
        self.color = color
        self.size = size


def generate_particles(center, count, radius, color, seed=42,
                       velocity_range=0.5, life_range=(0.3, 1.0),
                       upward_bias=0.0):
    """Generate a list of particles around a center point.

    Args:
        upward_bias: negative vy bias (particles float up)
    """
    rng = np.random.RandomState(seed)
    particles = []
    for _ in range(count):
        angle = rng.uniform(0, 2 * math.pi)
        dist = rng.uniform(0, radius)
        px = center[0] + math.cos(angle) * dist
        py = center[1] + math.sin(angle) * dist
        vx = rng.uniform(-velocity_range, velocity_range)
        vy = rng.uniform(-velocity_range, velocity_range) - upward_bias
        life = rng.uniform(*life_range)
        brightness = rng.uniform(0.5, 1.0)
        c = tuple(int(min(255, v * brightness)) for v in color[:3])
        alpha = int(color[3] * rng.uniform(0.3, 1.0)) if len(color) > 3 else 255
        sz = rng.choice([1, 1, 1, 2])  # mostly 1px, occasionally 2px
        particles.append(Particle(px, py, vx, vy, life, (*c, alpha), sz))
    return particles


def draw_particles(img, particles, phase=0.0):
    """Draw particles on image at a given animation phase.

    Phase 0-1 represents the particle's position in its lifetime.
    """
    pixels = np.array(img)
    h, w, _ = pixels.shape

    for p in particles:
        # Animate position
        t = phase
        px = int(p.x + p.vx * t * 20)
        py = int(p.y + p.vy * t * 20)

        # Fade based on life
        life_t = min(1.0, t / p.life) if p.life > 0 else 1.0
        alpha = int(p.color[3] * (1.0 - life_t * 0.7))

        if alpha <= 0:
            continue

        sz = p.size
        for dy in range(-sz + 1, sz):
            for dx in range(-sz + 1, sz):
                ppx = px + dx
                ppy = py + dy
                if 0 <= ppx < w and 0 <= ppy < h:
                    # Alpha blend
                    a = alpha / 255.0
                    for c in range(3):
                        pixels[ppy, ppx, c] = int(
                            pixels[ppy, ppx, c] * (1 - a) + p.color[c] * a
                        )
                    pixels[ppy, ppx, 3] = min(255, pixels[ppy, ppx, 3] + alpha)

    return Image.fromarray(pixels, 'RGBA')


def draw_pixel_particles(img, center, count, radius, color, seed=42):
    """Simple scattered pixel particles (legacy-compatible wrapper)."""
    particles = generate_particles(center, count, radius, color, seed)
    result = draw_particles(img, particles, phase=0.0)
    img.paste(result, (0, 0))


# ---------------------------------------------------------------------------
# Concentric rings (for sing animation)
# ---------------------------------------------------------------------------

def draw_concentric_rings(img, center, radius, color, count=3, thickness=1,
                          phase=0.0):
    """Draw expanding concentric rings (sound waves)."""
    draw = ImageDraw.Draw(img)
    cx, cy = center

    for i in range(count):
        ring_phase = (phase + i / count) % 1.0
        r = int(radius * ring_phase)
        alpha = int(200 * (1.0 - ring_phase))
        if alpha > 10 and r > 2:
            ring_color = (*color[:3], alpha)
            draw.ellipse(
                (cx - r, cy - r, cx + r, cy + r),
                outline=ring_color, width=thickness
            )


def draw_concentric_circles(img, center, radii, colors):
    """Draw concentric filled circles."""
    draw = ImageDraw.Draw(img)
    cx, cy = center
    for r, c in zip(radii, colors):
        bbox = (cx - r, cy - r, cx + r, cy + r)
        draw.ellipse(bbox, fill=c)


# ---------------------------------------------------------------------------
# Membrane texture (organic skin look)
# ---------------------------------------------------------------------------

def apply_membrane_texture(img, intensity=0.08, seed=0):
    """Apply subtle noise pattern to simulate organic translucent skin.

    Only affects existing opaque pixels.
    """
    pixels = np.array(img, dtype=np.float64)
    h, w, _ = pixels.shape
    rng = np.random.RandomState(seed)

    # Generate smooth noise (upscale small noise)
    small_h, small_w = max(1, h // 4), max(1, w // 4)
    noise_small = rng.uniform(-1, 1, (small_h, small_w))
    # Upscale with bilinear interpolation
    noise_img = Image.fromarray(
        ((noise_small + 1) * 127.5).astype(np.uint8), 'L'
    ).resize((w, h), Image.BILINEAR)
    noise = (np.array(noise_img, dtype=np.float64) / 127.5 - 1.0) * intensity * 255

    mask = pixels[:, :, 3] > 30
    for i in range(3):
        pixels[:, :, i] = np.where(
            mask,
            np.clip(pixels[:, :, i] + noise, 0, 255),
            pixels[:, :, i]
        )

    return Image.fromarray(pixels.astype(np.uint8), 'RGBA')


# ---------------------------------------------------------------------------
# Spiral pattern (for egg)
# ---------------------------------------------------------------------------

def draw_spiral(img, cx, cy, max_radius, color, turns=3, phase=0.0,
                point_count=40, width_range=(0.8, 1.0)):
    """Draw a spiral energy pattern (galaxy swirl inside egg)."""
    draw = ImageDraw.Draw(img)

    for arm in range(2):  # Two spiral arms
        arm_offset = arm * math.pi
        for i in range(point_count):
            t = i / point_count
            angle = t * math.pi * 2 * turns + phase + arm_offset
            r = t * max_radius * 0.85
            # Slight width variation
            w_factor = width_range[0] + (width_range[1] - width_range[0]) * (1 - t)

            sx = int(cx + math.cos(angle) * r * 0.7)
            sy = int(cy + math.sin(angle) * r * 0.95)

            # Fade along spiral
            alpha = int(color[3] * (0.3 + 0.7 * (1 - t)))
            if alpha > 10:
                sz = max(1, int(2 * w_factor))
                c = (*color[:3], alpha)
                draw.ellipse(
                    (sx - sz, sy - sz, sx + sz, sy + sz),
                    fill=c
                )


def draw_veins(img, cx, cy, width, height, color, count=5, seed=0):
    """Draw faint bioluminescent veins on a surface."""
    draw = ImageDraw.Draw(img)
    rng = np.random.RandomState(seed)

    for _ in range(count):
        # Start from a random point near the surface
        angle = rng.uniform(0, 2 * math.pi)
        start_r = rng.uniform(0.5, 0.85)
        sx = cx + math.cos(angle) * width * start_r
        sy = cy + math.sin(angle) * height * start_r

        # Branch inward
        branch_len = rng.randint(3, 8)
        cur_x, cur_y = sx, sy
        for j in range(branch_len):
            t = j / branch_len
            # Move toward center with some randomness
            dx = (cx - cur_x) * 0.3 + rng.uniform(-2, 2)
            dy = (cy - cur_y) * 0.3 + rng.uniform(-2, 2)
            next_x = cur_x + dx
            next_y = cur_y + dy

            alpha = int(color[3] * (0.5 + 0.5 * (1 - t)))
            if alpha > 10:
                draw.line(
                    (int(cur_x), int(cur_y), int(next_x), int(next_y)),
                    fill=(*color[:3], alpha), width=1
                )
            cur_x, cur_y = next_x, next_y


# ---------------------------------------------------------------------------
# Body patterns (stripes, spots, swirls from DNA)
# ---------------------------------------------------------------------------

def draw_body_pattern(img, cx, cy, body_w, body_h, pattern_type, color, seed=0):
    """Draw DNA-derived body patterns.

    pattern_type: 0-2 = stripes, 3-5 = spots, 6-7 = swirls
    """
    draw = ImageDraw.Draw(img)
    pixels = np.array(img)
    rng = np.random.RandomState(seed)

    if pattern_type < 3:
        # Stripes (horizontal)
        stripe_count = 3 + pattern_type
        for i in range(stripe_count):
            t = (i + 0.5) / stripe_count
            sy = int(cy - body_h + t * body_h * 2)
            alpha = int(color[3] * 0.4)
            draw.line(
                (cx - int(body_w * 0.6), sy, cx + int(body_w * 0.6), sy),
                fill=(*color[:3], alpha), width=1
            )
    elif pattern_type < 6:
        # Spots
        spot_count = 4 + (pattern_type - 3) * 2
        for _ in range(spot_count):
            angle = rng.uniform(0, 2 * math.pi)
            dist = rng.uniform(0.2, 0.7)
            sx = int(cx + math.cos(angle) * body_w * dist)
            sy = int(cy + math.sin(angle) * body_h * dist)
            sr = rng.randint(1, 3)
            alpha = int(color[3] * 0.5)
            draw.ellipse(
                (sx - sr, sy - sr, sx + sr, sy + sr),
                fill=(*color[:3], alpha)
            )
    else:
        # Swirls (small spiral marks)
        for side in [-1, 1]:
            scx = cx + side * int(body_w * 0.3)
            scy = cy
            for i in range(12):
                t = i / 12
                angle = t * math.pi * 2
                r = t * body_w * 0.25
                px = int(scx + math.cos(angle) * r)
                py = int(scy + math.sin(angle) * r * 0.8)
                if 0 <= px < img.size[0] and 0 <= py < img.size[1]:
                    alpha = int(color[3] * 0.3 * (1 - t))
                    if alpha > 5:
                        draw.point((px, py), fill=(*color[:3], alpha))


# ---------------------------------------------------------------------------
# Outline (SNES-style)
# ---------------------------------------------------------------------------

def add_outline(img, outline_color=(10, 10, 20, 255), inner_color=None):
    """Add a dark outline and optional lighter inner contour."""
    pixels = np.array(img)
    h, w, _ = pixels.shape
    alpha = pixels[:, :, 3]
    result = pixels.copy()

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

        for i in range(4):
            result[:, :, i] = np.where(
                inner_mask & (alpha >= 128) & ~outline_mask,
                np.clip(
                    result[:, :, i].astype(np.int16) * 0.6 + inner_color[i] * 0.4,
                    0, 255
                ).astype(np.uint8),
                result[:, :, i]
            )

    return Image.fromarray(result, 'RGBA')


# ---------------------------------------------------------------------------
# Dithering (kept for compatibility)
# ---------------------------------------------------------------------------

def apply_dithering(img, palette):
    """Apply Floyd-Steinberg dithering to reduce image to a limited palette."""
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
            if x + 1 < w:
                pixels[y, x + 1, :3] += [err_r * 7/16, err_g * 7/16, err_b * 7/16]
            if y + 1 < h:
                if x - 1 >= 0:
                    pixels[y+1, x-1, :3] += [err_r * 3/16, err_g * 3/16, err_b * 3/16]
                pixels[y+1, x, :3] += [err_r * 5/16, err_g * 5/16, err_b * 5/16]
                if x + 1 < w:
                    pixels[y+1, x+1, :3] += [err_r * 1/16, err_g * 1/16, err_b * 1/16]

    pixels = np.clip(pixels, 0, 255).astype(np.uint8)
    return Image.fromarray(pixels, 'RGBA')


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def lerp_color(c1, c2, t):
    """Linearly interpolate between two RGB or RGBA tuples."""
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


def tint_toward(color, target, amount):
    """Shift a color toward a target color by amount (0-1)."""
    return tuple(int(c + (t - c) * amount) for c, t in zip(color, target))
