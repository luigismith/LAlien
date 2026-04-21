#!/usr/bin/env python3
import os, sys, threading
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__))))
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)
from http.server import ThreadingHTTPServer as HTTPServer, SimpleHTTPRequestHandler

class H(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
    def log_message(self, format, *args):
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), format%args))
        sys.stderr.flush()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
server = HTTPServer(('0.0.0.0', port), H)
# Print AFTER bind succeeds so preview_start knows we're ready
print(f"Serving on http://localhost:{port}", flush=True)
server.serve_forever()
