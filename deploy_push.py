import os, paramiko

NAS_HOST = os.environ.get('NAS_HOST', '192.168.1.80')
NAS_USER = os.environ.get('NAS_USER', 'it')
NAS_PASS = os.environ.get('NAS_PASS') or (_ for _ in ()).throw(
    SystemExit('Set NAS_PASS env var (NAS SFTP password)'))

FILES = [
    (r'D:\LAlien\web\index.html',                   '/share/Public/lalien/index.html'),
    (r'D:\LAlien\web\css\style.css',                '/share/Public/lalien/css/style.css'),
    (r'D:\LAlien\web\js\ui\screens.js',             '/share/Public/lalien/js/ui/screens.js'),
    (r'D:\LAlien\web\js\ui\status-bar.js',          '/share/Public/lalien/js/ui/status-bar.js'),
    (r'D:\LAlien\web\js\engine\game-loop.js',       '/share/Public/lalien/js/engine/game-loop.js'),
    (r'D:\LAlien\web\js\engine\items.js',           '/share/Public/lalien/js/engine/items.js'),
    (r'D:\LAlien\web\js\ui\renderer.js',            '/share/Public/lalien/js/ui/renderer.js'),
    (r'D:\LAlien\web\js\audio\sound-engine.js',     '/share/Public/lalien/js/audio/sound-engine.js'),
    (r'D:\LAlien\web\js\pet\minigames.js',          '/share/Public/lalien/js/pet/minigames.js'),
    (r'D:\LAlien\web\js\pet\needs.js',              '/share/Public/lalien/js/pet/needs.js'),
    (r'D:\LAlien\web\js\pet\evolution.js',          '/share/Public/lalien/js/pet/evolution.js'),
    (r'D:\LAlien\web\js\pet\activity.js',           '/share/Public/lalien/js/pet/activity.js'),
    (r'D:\LAlien\web\js\pet\autonomy.js',           '/share/Public/lalien/js/pet/autonomy.js'),
    (r'D:\LAlien\web\js\pet\rhythms.js',            '/share/Public/lalien/js/pet/rhythms.js'),
    (r'D:\LAlien\web\js\pet\mind.js',               '/share/Public/lalien/js/pet/mind.js'),
    (r'D:\LAlien\web\js\pet\pet.js',                '/share/Public/lalien/js/pet/pet.js'),
    (r'D:\LAlien\web\js\ui\interactions.js',        '/share/Public/lalien/js/ui/interactions.js'),
    (r'D:\LAlien\web\js\ui\gestures.js',            '/share/Public/lalien/js/ui/gestures.js'),
    (r'D:\LAlien\web\js\ui\sprite-loader.js',       '/share/Public/lalien/js/ui/sprite-loader.js'),
    (r'D:\LAlien\web\js\ui\emotive-effects.js',     '/share/Public/lalien/js/ui/emotive-effects.js'),
    (r'D:\LAlien\web\js\ui\notifications.js',       '/share/Public/lalien/js/ui/notifications.js'),
    (r'D:\LAlien\web\sw.js',                        '/share/Public/lalien/sw.js'),
    (r'D:\LAlien\web\manifest.json',                '/share/Public/lalien/manifest.json'),
    (r'D:\LAlien\web\icon-192.svg',                 '/share/Public/lalien/icon-192.svg'),
    (r'D:\LAlien\web\js\ai\sentiment.js',           '/share/Public/lalien/js/ai/sentiment.js'),
    (r'D:\LAlien\web\js\i18n\alien-lexicon.js',     '/share/Public/lalien/js/i18n/alien-lexicon.js'),
    (r'D:\LAlien\web\js\ai\system-prompt.js',       '/share/Public/lalien/js/ai/system-prompt.js'),
    (r'D:\LAlien\web\js\engine\environment.js',     '/share/Public/lalien/js/engine/environment.js'),
    (r'D:\LAlien\web\js\engine\weather.js',         '/share/Public/lalien/js/engine/weather.js'),
    (r'D:\LAlien\web\js\ui\shelter.js',             '/share/Public/lalien/js/ui/shelter.js'),
    (r'D:\LAlien\web\js\ui\weather-overlay.js',     '/share/Public/lalien/js/ui/weather-overlay.js'),
    (r'D:\LAlien\web\js\pet\solo-games.js',         '/share/Public/lalien/js/pet/solo-games.js'),
]

c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(NAS_HOST, port=22, username=NAS_USER, password=NAS_PASS,
          look_for_keys=False, allow_agent=False)
sftp = c.open_sftp()

def _mkdirs(path):
    parts = path.strip('/').split('/')
    cur = ''
    for p in parts[:-1]:
        cur = cur + '/' + p
        try: sftp.stat(cur)
        except IOError:
            try: sftp.mkdir(cur); print('MKDIR', cur)
            except IOError: pass

for local, remote in FILES:
    _mkdirs(remote)
    sftp.put(local, remote); print('OK', remote)
sftp.close()
c.close()
print('Done.')
