#!/usr/bin/env python
# -*- coding: utf-8 -*-
# Lalien Companion -- Static file server + cloud save API  (Python 2.7, QNAP NAS)
import os, sys, posixpath, urllib, mimetypes, json, hashlib, threading, ssl
import BaseHTTPServer, SocketServer

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 9080
HTTPS_PORT = int(sys.argv[3]) if len(sys.argv) > 3 else 9443
CERT_FILE = os.path.join(ROOT, 'certs', 'cert.pem')
KEY_FILE  = os.path.join(ROOT, 'certs', 'key.pem')
SAVES_DIR = os.path.join(ROOT, 'saves')

if not os.path.exists(SAVES_DIR):
    os.makedirs(SAVES_DIR)

_lock = threading.Lock()

EXT = {
    '.html':'text/html; charset=utf-8', '.htm':'text/html; charset=utf-8',
    '.js':'application/javascript; charset=utf-8',
    '.mjs':'application/javascript; charset=utf-8',
    '.css':'text/css; charset=utf-8',
    '.json':'application/json; charset=utf-8',
    '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
    '.gif':'image/gif', '.svg':'image/svg+xml', '.webp':'image/webp',
    '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2',
    '.ttf':'font/ttf', '.otf':'font/otf',
    '.webmanifest':'application/manifest+json',
    '.txt':'text/plain; charset=utf-8', '.map':'application/json',
}

# ---- Helpers ----------------------------------------------------------------

def hash_pin(pin):
    return hashlib.sha256(('lalien:' + pin).encode('utf-8')).hexdigest()[:32]

def save_path(token):
    safe = token.replace('/', '').replace('..', '')
    return os.path.join(SAVES_DIR, safe + '.json')

def read_json_body(handler, max_bytes=1024*1024):
    length = int(handler.headers.get('Content-Length', 0))
    if length == 0:
        return {}
    raw = handler.rfile.read(min(length, max_bytes))
    try:
        return json.loads(raw.decode('utf-8'))
    except Exception:
        return {}

def send_json(handler, code, data):
    body = json.dumps(data, ensure_ascii=False).encode('utf-8')
    handler.send_response(code)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Content-Length', str(len(body)))
    handler.send_header('Access-Control-Allow-Origin', '*')
    handler.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Token')
    handler.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    handler.end_headers()
    handler.wfile.write(body)

# ---- Request handler ---------------------------------------------------------

class H(BaseHTTPServer.BaseHTTPRequestHandler):

    def log_message(self, fmt, *a):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % a))

    def translate(self, path):
        path = path.split('?', 1)[0].split('#', 1)[0]
        path = posixpath.normpath(urllib.unquote(path))
        parts = [p for p in path.split('/') if p and p != '..']
        return os.path.join(ROOT, *parts)

    # CORS preflight
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Token')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.end_headers()

    def do_POST(self):
        path = self.path.split('?', 1)[0]

        # POST /api/auth  {pin, username}  -> {token, username, is_new}
        if path == '/api/auth':
            body = read_json_body(self)
            pin = str(body.get('pin', '')).strip()
            username = str(body.get('username', 'Custode')).strip() or 'Custode'
            if not pin:
                send_json(self, 400, {'error': 'pin required'})
                return
            token = hash_pin(pin)
            sp = save_path(token)
            with _lock:
                if os.path.exists(sp):
                    try:
                        existing = json.loads(open(sp, 'rb').read().decode('utf-8'))
                        existing_name = existing.get('_account', {}).get('username', username)
                    except Exception:
                        existing_name = username
                    send_json(self, 200, {'token': token, 'username': existing_name, 'is_new': False})
                else:
                    # Create empty save file
                    data = {'_account': {'username': username, 'created': None}, 'version': 1}
                    import time; data['_account']['created'] = int(time.time())
                    open(sp, 'wb').write(json.dumps(data, ensure_ascii=False).encode('utf-8'))
                    send_json(self, 200, {'token': token, 'username': username, 'is_new': True})
            return

        # POST /api/data  (body = full save JSON)
        if path == '/api/data':
            token = self.headers.get('X-Token', '').strip()
            if not token or len(token) != 32:
                send_json(self, 401, {'error': 'invalid token'})
                return
            body = read_json_body(self)
            sp = save_path(token)
            with _lock:
                if not os.path.exists(sp):
                    send_json(self, 403, {'error': 'account not found'})
                    return
                try:
                    existing = json.loads(open(sp, 'rb').read().decode('utf-8'))
                    account = existing.get('_account', {})
                except Exception:
                    account = {}
                body['_account'] = account
                tmp = sp + '.tmp'
                open(tmp, 'wb').write(json.dumps(body, ensure_ascii=False).encode('utf-8'))
                os.rename(tmp, sp)
            send_json(self, 200, {'ok': True})
            return

        send_json(self, 404, {'error': 'not found'})

    def do_GET(self):
        path = self.path.split('?', 1)[0]

        # GET /api/data
        if path == '/api/data':
            token = self.headers.get('X-Token', '').strip()
            if not token or len(token) != 32:
                send_json(self, 401, {'error': 'invalid token'})
                return
            sp = save_path(token)
            with _lock:
                if not os.path.exists(sp):
                    send_json(self, 404, {'error': 'no save found'})
                    return
                try:
                    data = json.loads(open(sp, 'rb').read().decode('utf-8'))
                except Exception:
                    send_json(self, 500, {'error': 'corrupted save'})
                    return
            send_json(self, 200, data)
            return

        # GET /api/status
        if path == '/api/status':
            send_json(self, 200, {'ok': True, 'server': 'lalien-nas'})
            return

        # Static files
        self._serve_static(True)

    def do_HEAD(self):
        self._serve_static(False)

    def _serve_static(self, body):
        p = self.translate(self.path)
        if os.path.isdir(p):
            idx = os.path.join(p, 'index.html')
            if os.path.exists(idx): p = idx
            else: self.send_error(403); return
        if not os.path.exists(p):
            self.send_error(404); return
        ext = os.path.splitext(p)[1].lower()
        ctype = EXT.get(ext) or mimetypes.guess_type(p)[0] or 'application/octet-stream'
        try:
            f = open(p, 'rb'); data = f.read(); f.close()
        except Exception as e:
            self.send_error(500, str(e)); return
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        if body: self.wfile.write(data)

class TS(SocketServer.ThreadingMixIn, BaseHTTPServer.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True

def run_http():
    srv = TS(('0.0.0.0', PORT), H)
    print("HTTP  serving %s on 0.0.0.0:%d" % (ROOT, PORT))
    srv.serve_forever()

def run_https():
    if not (os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE)):
        print("HTTPS disabled: cert/key missing (%s, %s)" % (CERT_FILE, KEY_FILE))
        return
    srv = TS(('0.0.0.0', HTTPS_PORT), H)
    try:
        srv.socket = ssl.wrap_socket(srv.socket, certfile=CERT_FILE, keyfile=KEY_FILE, server_side=True)
    except Exception as e:
        print("HTTPS setup failed: %s" % e)
        return
    print("HTTPS serving %s on 0.0.0.0:%d" % (ROOT, HTTPS_PORT))
    srv.serve_forever()

if __name__ == '__main__':
    t = threading.Thread(target=run_http); t.daemon = True; t.start()
    run_https()  # blocking
    t.join()
