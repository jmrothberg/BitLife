#!/usr/bin/env python3
"""Local dev server with COOP/COEP headers (crossOriginIsolated) for JMR's BitLife.

ONNX Runtime Web needs SharedArrayBuffer / WASM threads, which require these headers.
Serves this repo's own directory.

Usage:
    python3 serve.py [port]          # default 8080
    # open http://localhost:8080/index.html
"""
import os, sys, http.server, socketserver

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
_ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(_ROOT)

class COOPCOEPHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

class ThreadedServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

with ThreadedServer(("", PORT), COOPCOEPHandler) as httpd:
    print(f"Serving on http://localhost:{PORT}")
    print(f"  Root: {_ROOT}")
    print(f"  Game: http://localhost:{PORT}/index.html")
    print(f"  crossOriginIsolated: enabled (COOP + COEP)")
    print(f"  Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
