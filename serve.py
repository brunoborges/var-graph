#!/usr/bin/env python3
"""Serve the var-graph web app locally.

Usage:
    python3 serve.py [port]

Defaults to port 8000. Serves the files in this directory (index.html,
script.js, style.css) and opens the app in your default browser.
"""

import argparse
import contextlib
import os
import sys
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(SimpleHTTPRequestHandler):
    """Serve from the script directory with caching disabled."""

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))


def build_server(host, port, handler, max_tries=20):
    """Bind to `port`, falling back to the next free port if it's in use."""
    ThreadingHTTPServer.allow_reuse_address = True
    last_exc = None
    for candidate in range(port, port + max_tries):
        try:
            server = ThreadingHTTPServer((host, candidate), handler)
            if candidate != port:
                print("Port %d is in use; using %d instead." % (port, candidate))
            return server
        except OSError as exc:
            last_exc = exc
    raise SystemExit(
        "Could not bind to %s on ports %d-%d - %s"
        % (host, port, port + max_tries - 1, last_exc)
    )


def main():
    parser = argparse.ArgumentParser(description="Serve the var-graph web app locally.")
    parser.add_argument(
        "port",
        nargs="?",
        type=int,
        default=8000,
        help="Port to listen on (default: 8000; falls back to the next free port).",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host/interface to bind (default: 127.0.0.1).",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not open a browser window automatically.",
    )
    args = parser.parse_args()

    handler = partial(Handler, directory=ROOT)
    server = build_server(args.host, args.port, handler)

    host, port = server.server_address[0], server.server_address[1]
    url = "http://%s:%d/" % (host, port)
    print("Serving %s at %s" % (ROOT, url))
    print("Press Ctrl+C to stop.")

    if not args.no_browser:
        with contextlib.suppress(Exception):
            webbrowser.open(url)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
