"""Bulk-uploads the web/sprites directory tree to the NAS.

Usage: NAS_PASS='...' python deploy_sprites.py [--variant 0]

Only pushes variant_00 by default (baseline for all stages) to keep the
deploy small. Pass --all to upload every variant.
"""
import os, sys, paramiko

NAS_HOST = os.environ.get('NAS_HOST', '192.168.1.80')
NAS_USER = os.environ.get('NAS_USER', 'it')
NAS_PASS = os.environ.get('NAS_PASS') or (_ for _ in ()).throw(SystemExit('Set NAS_PASS'))

LOCAL_ROOT  = r'D:\LAlien\web\sprites'
REMOTE_ROOT = '/share/Public/lalien/sprites'

ALL_VARIANTS = '--all' in sys.argv
ONLY_VARIANTS = {'variant_00'} if not ALL_VARIANTS else None

def _mkdirs(sftp, path):
    parts = path.strip('/').split('/')
    cur = ''
    for p in parts:
        cur = cur + '/' + p
        try: sftp.stat(cur)
        except IOError:
            try: sftp.mkdir(cur); print('MKDIR', cur)
            except IOError: pass

c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(NAS_HOST, port=22, username=NAS_USER, password=NAS_PASS, look_for_keys=False, allow_agent=False)
sftp = c.open_sftp()

count = 0
for root, dirs, files in os.walk(LOCAL_ROOT):
    rel = os.path.relpath(root, LOCAL_ROOT).replace('\\', '/')
    if rel == '.': rel = ''
    # Filter: only variant_00 unless --all
    if ONLY_VARIANTS and 'variant_' in rel:
        variant_name = [p for p in rel.split('/') if p.startswith('variant_')][0]
        if variant_name not in ONLY_VARIANTS: continue
    remote_dir = REMOTE_ROOT + ('/' + rel if rel else '')
    _mkdirs(sftp, remote_dir)
    for fn in files:
        local = os.path.join(root, fn)
        remote = remote_dir + '/' + fn
        try:
            sftp.put(local, remote)
            count += 1
            if count % 20 == 0: print(f'  ...{count} files')
        except Exception as e:
            print('ERR', remote, e)

print(f'Done. Pushed {count} files.')
sftp.close()
c.close()
