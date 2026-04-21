#!/usr/bin/env python3
"""
Local development server for the Lalien Companion web port.

Serves files from this directory on http://localhost:8080.
Adds CORS headers so assets load cleanly from any origin during dev.

Usage:
    python3 serve.py
    python3 serve.py --port 3000
"""
import os
import sys
import argparse
from http.server import HTTPServer, SimpleHTTPRequestHandler


class CORSHandler(SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler with CORS and cache-control for dev."""

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def log_message(self, format, *args):
        # Colour-code status in terminal
        status = args[1] if len(args) > 1 else ''
        colour = ''
        reset = '\033[0m'
        if str(status).startswith('2'):
            colour = '\033[32m'  # green
        elif str(status).startswith('3'):
            colour = '\033[33m'  # yellow
        elif str(status).startswith('4') or str(status).startswith('5'):
            colour = '\033[31m'  # red
        sys.stderr.write(f"{colour}{self.address_string()} - {format % args}{reset}\n")


def main():
    parser = argparse.ArgumentParser(description='Lalien Companion dev server')
    parser.add_argument('--port', type=int, default=8080, help='Port to listen on (default: 8080)')
    args = parser.parse_args()

    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    server = HTTPServer(('', args.port), CORSHandler)
    print(f"Serving Lalien Companion at http://localhost:{args.port}")
    print("Press Ctrl+C to stop.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.shutdown()


if __name__ == '__main__':
    main()
