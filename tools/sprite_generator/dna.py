"""
dna.py - DNA hash to visual parameter mapping for Lalien creatures.
Parses a 32-byte hash into deterministic visual traits.
"""

import hashlib
import os
import struct


def generate_random_dna():
    """Generate a random 32-byte DNA hash for testing.

    Returns:
        bytes: 32-byte hash
    """
    return os.urandom(32)


def generate_dna_from_seed(seed_string):
    """Generate deterministic DNA from a string seed.

    Args:
        seed_string: any string

    Returns:
        bytes: 32-byte SHA-256 hash
    """
    return hashlib.sha256(seed_string.encode('utf-8')).digest()


def dna_to_params(hash_bytes):
    """Parse a 32-byte hash into visual parameters.

    Args:
        hash_bytes: 32 bytes

    Returns:
        dict with visual parameters:
            variant_index: int (0-255)
            appendage_count: int (0-6)
            appendage_length: int (0-3)
            eye_size: int (0-3)
            core_pattern: int (0-7)
            body_curvature: int (0-3)
            palette_warmth: int (0-255)
            core_hue: int (0-360)
            body_width: float (0.6-1.0) relative scale
            body_height: float (0.7-1.0) relative scale
            symmetry_seed: int (for subtle asymmetry in animation)
    """
    if len(hash_bytes) < 32:
        # Pad with zeros if too short
        hash_bytes = hash_bytes + b'\x00' * (32 - len(hash_bytes))

    b = hash_bytes

    return {
        'variant_index': b[0],
        'appendage_count': b[1] % 7,           # 0-6
        'appendage_length': b[2] % 4,           # 0-3
        'eye_size': b[3] % 4,                   # 0-3
        'core_pattern': b[4] % 8,               # 0-7
        'body_curvature': b[5] % 4,             # 0-3
        'palette_warmth': b[6],                  # 0-255
        'core_hue': ((b[7] << 8) | b[8]) % 361, # 0-360
        'body_width': 0.6 + (b[9] / 255.0) * 0.4,   # 0.6-1.0
        'body_height': 0.7 + (b[10] / 255.0) * 0.3,  # 0.7-1.0
        'symmetry_seed': (b[11] << 8) | b[12],
        'appendage_wave': b[13] / 255.0,        # wave amplitude factor
        'eye_spacing': 0.3 + (b[14] / 255.0) * 0.4,  # 0.3-0.7 as fraction of body width
        'mouth_size': 1 + b[15] % 3,            # 1-3
    }


def params_for_stage(dna_params, stage):
    """Adjust DNA params based on developmental stage.

    Earlier stages have fewer/smaller features.

    Args:
        dna_params: dict from dna_to_params
        stage: int 0-7

    Returns:
        dict with adjusted params
    """
    p = dict(dna_params)

    if stage == 0:
        # Egg: no appendages, no eyes
        p['appendage_count'] = 0
        p['eye_size'] = 0
    elif stage == 1:
        # Newborn: no appendages, big eyes
        p['appendage_count'] = 0
        p['eye_size'] = min(3, p['eye_size'] + 1)
    elif stage == 2:
        # Infant: 2 small appendages
        p['appendage_count'] = min(2, p['appendage_count'])
        p['appendage_length'] = min(1, p['appendage_length'])
        p['eye_size'] = min(3, p['eye_size'] + 1)
    elif stage == 3:
        # Child: up to 4 appendages
        p['appendage_count'] = min(4, p['appendage_count'])
        p['appendage_length'] = min(2, p['appendage_length'])
    elif stage == 4:
        # Teen: all appendages, longer
        pass
    elif stage == 5:
        # Adult: full expression
        pass
    elif stage == 6:
        # Sage: slightly desaturated, noble
        pass
    elif stage == 7:
        # Transcendence: ethereal
        pass

    return p
