#!/usr/bin/env python3
"""
One-time setup: copy sprite assets, lang packs, and lore from sd_card_template
into web/ and build a manifest.json index of all sprites.

Run from the web/ directory:
    python3 setup_assets.py
"""
import shutil
import os
import json
import glob

WEB = os.path.dirname(os.path.abspath(__file__))
SD = os.path.normpath(os.path.join(WEB, '..', 'sd_card_template'))


def copy_tree(src, dst):
    if os.path.exists(dst):
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    count = sum(len(f) for _, _, f in os.walk(dst))
    print(f"  Copied {count} files -> {dst}")


def copy_files(src_glob, dst_dir):
    os.makedirs(dst_dir, exist_ok=True)
    for f in glob.glob(src_glob):
        shutil.copy2(f, dst_dir)
        print(f"  Copied {os.path.basename(f)} -> {dst_dir}")


def build_manifest(sprites_dir):
    """Scan sprites_dir and build manifest.json from actual files on disk."""
    stages = []
    for stage_dir in sorted(glob.glob(os.path.join(sprites_dir, 'stage_*'))):
        dirname = os.path.basename(stage_dir)
        parts = dirname.split('_', 2)  # stage_0_syrma
        stage_id = int(parts[1])
        stage_name = parts[2] if len(parts) > 2 else dirname

        variants = []
        for var_dir in sorted(glob.glob(os.path.join(stage_dir, 'variant_*'))):
            var_id = int(os.path.basename(var_dir).split('_')[1])
            # Collect animation names (PNG files minus preview.png)
            anims = sorted([
                os.path.splitext(os.path.basename(p))[0]
                for p in glob.glob(os.path.join(var_dir, '*.png'))
                if os.path.basename(p) != 'preview.png'
            ])
            variants.append({
                "id": var_id,
                "animations": anims,
                "has_meta": os.path.exists(os.path.join(var_dir, 'meta.json')),
                "has_preview": os.path.exists(os.path.join(var_dir, 'preview.png')),
            })

        stages.append({
            "id": stage_id,
            "name": stage_name,
            "dir": dirname,
            "has_contact_sheet": os.path.exists(os.path.join(stage_dir, 'contact_sheet.png')),
            "variants": variants,
        })

    manifest = {
        "version": 1,
        "has_mood_contact_sheet": os.path.exists(os.path.join(sprites_dir, 'mood_contact_sheet.png')),
        "stages": stages,
    }
    return manifest


def main():
    # 1. Sprites
    print("[1/4] Copying sprites...")
    copy_tree(os.path.join(SD, 'sprites'), os.path.join(WEB, 'sprites'))

    # 2. Language packs
    print("[2/4] Copying language packs...")
    copy_files(os.path.join(SD, 'lang', '*.json'), os.path.join(WEB, 'lang'))

    # 3. Lore fragments
    print("[3/4] Copying lore fragments...")
    os.makedirs(os.path.join(WEB, 'lore'), exist_ok=True)
    shutil.copy2(os.path.join(SD, 'lore', 'fragments.json'), os.path.join(WEB, 'lore'))
    print("  Copied fragments.json -> lore/")

    # 4. Build manifest
    print("[4/4] Building sprites/manifest.json...")
    sprites_dir = os.path.join(WEB, 'sprites')
    manifest = build_manifest(sprites_dir)
    manifest_path = os.path.join(sprites_dir, 'manifest.json')
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)

    total_variants = sum(len(s['variants']) for s in manifest['stages'])
    print(f"  Wrote {manifest_path}")
    print(f"  {len(manifest['stages'])} stages, {total_variants} total variants")
    print("\nDone. Run 'python3 serve.py' to start the dev server.")


if __name__ == '__main__':
    main()
