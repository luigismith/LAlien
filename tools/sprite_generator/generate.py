"""
generate.py - Main entry point for Lalien sprite generation.

Usage:
    python generate.py --stages 0,1 --variants 1 --output-dir ./output
    python generate.py  # defaults: all stages, 16 variants
"""

import argparse
import json
import os
import sys

from PIL import Image

from dna import generate_dna_from_seed, dna_to_params
from stages import draw_stage, _create_canvas, SIZE, STAGE_FUNCTIONS
from animator import generate_animation, frames_to_spritesheet, ANIMATIONS


STAGE_NAMES = {
    0: 'syrma',
    1: 'lalina',
    2: 'lalishi',
    3: 'laliko',
    4: 'laliren',
    5: 'lalivox',
    6: 'lalimere',
    7: 'lalithishi',
}


def generate_sprites(stages, variants, output_dir, animations=None):
    """Generate all sprites for the given stages and variants.

    Args:
        stages: list of stage ints
        variants: number of variants per stage
        output_dir: output directory path
        animations: list of animation names, or None for all
    """
    if animations is None:
        animations = list(ANIMATIONS.keys())

    os.makedirs(output_dir, exist_ok=True)

    for stage in stages:
        stage_name = STAGE_NAMES.get(stage, f'stage{stage}')
        stage_dir = os.path.join(output_dir, f'stage_{stage}_{stage_name}')
        os.makedirs(stage_dir, exist_ok=True)

        print(f"\n=== Stage {stage}: {stage_name} ===")

        variant_previews = []

        for v in range(variants):
            # Generate deterministic DNA from stage + variant
            seed = f"lalien_stage{stage}_variant{v}"
            dna_hash = generate_dna_from_seed(seed)
            params = dna_to_params(dna_hash)

            variant_dir = os.path.join(stage_dir, f'variant_{v:02d}')
            os.makedirs(variant_dir, exist_ok=True)

            print(f"  Variant {v}: warmth={params['palette_warmth']}, "
                  f"hue={params['core_hue']}, eyes={params['eye_size']}, "
                  f"appendages={params['appendage_count']}")

            # Generate each animation
            meta = {
                'stage': stage,
                'stage_name': stage_name,
                'variant': v,
                'dna_params': {k: (float(val) if isinstance(val, float) else int(val))
                               for k, val in params.items()},
                'animations': {},
            }

            for anim_name in animations:
                frame_count, fps = ANIMATIONS[anim_name]
                try:
                    frames = generate_animation(anim_name, stage, params)
                    sheet = frames_to_spritesheet(frames)

                    filename = f'{anim_name}.png'
                    filepath = os.path.join(variant_dir, filename)
                    sheet.save(filepath)

                    meta['animations'][anim_name] = {
                        'frames': frame_count,
                        'fps': fps,
                        'file': filename,
                        'frame_width': SIZE,
                        'frame_height': SIZE,
                    }

                    print(f"    {anim_name}: {frame_count} frames @ {fps}fps -> {filename}")
                except Exception as e:
                    print(f"    ERROR generating {anim_name}: {e}")
                    import traceback
                    traceback.print_exc()

            # Save meta.json
            meta_path = os.path.join(variant_dir, 'meta.json')
            with open(meta_path, 'w') as f:
                json.dump(meta, f, indent=2)

            # Save a preview of idle frame 0
            preview = _create_canvas()
            draw_stage(stage, preview, params, frame=0)
            preview_path = os.path.join(variant_dir, 'preview.png')
            preview.save(preview_path)
            variant_previews.append(preview)

        # Generate contact sheet for this stage
        if variant_previews:
            _generate_contact_sheet(variant_previews, stage_dir, stage_name)

    print(f"\nDone! Sprites saved to: {output_dir}")


def _generate_contact_sheet(previews, stage_dir, stage_name):
    """Generate a contact sheet showing all variants side by side.

    Args:
        previews: list of PIL Images (64x64 each)
        stage_dir: output directory
        stage_name: name for the filename
    """
    cols = min(8, len(previews))
    rows = (len(previews) + cols - 1) // cols
    margin = 4
    cell = SIZE + margin

    sheet = Image.new('RGBA',
                      (cols * cell + margin, rows * cell + margin),
                      (20, 20, 30, 255))

    for i, preview in enumerate(previews):
        col = i % cols
        row = i // cols
        x = margin + col * cell
        y = margin + row * cell
        sheet.paste(preview, (x, y), preview)

    # Also create a 4x scaled version for easier viewing
    scaled = sheet.resize(
        (sheet.width * 4, sheet.height * 4),
        Image.NEAREST
    )

    sheet_path = os.path.join(stage_dir, f'contact_sheet.png')
    scaled.save(sheet_path)
    print(f"  Contact sheet: {sheet_path}")


def main():
    parser = argparse.ArgumentParser(
        description='Generate Lalien creature sprites'
    )
    parser.add_argument(
        '--stages', type=str, default='0,1,2,3,4,5,6,7',
        help='Comma-separated list of stages to generate (0-7)'
    )
    parser.add_argument(
        '--variants', type=int, default=16,
        help='Number of variants per stage'
    )
    parser.add_argument(
        '--output-dir', type=str,
        default='D:/LAlien/sd_card_template/sprites',
        help='Output directory'
    )
    parser.add_argument(
        '--animations', type=str, default=None,
        help='Comma-separated list of animations (default: all)'
    )

    args = parser.parse_args()

    stages = [int(s.strip()) for s in args.stages.split(',')]
    animations = None
    if args.animations:
        animations = [a.strip() for a in args.animations.split(',')]

    print(f"Generating sprites:")
    print(f"  Stages: {stages}")
    print(f"  Variants: {args.variants}")
    print(f"  Output: {args.output_dir}")
    print(f"  Animations: {animations or 'all'}")

    generate_sprites(stages, args.variants, args.output_dir, animations)


if __name__ == '__main__':
    main()
