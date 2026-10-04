"""Static server for the checklist web app (stdlib only)."""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", "8131"))
HOST = os.environ.get("HOST", "127.0.0.1")
ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".woff2": "font/woff2",
        ".woff": "font/woff",
        ".svg": "image/svg+xml",
        ".webmanifest": "application/manifest+json",
    }

    # Avoid stale checklist data during edits
    def end_headers(self):
        if self.path.split("?")[0].endswith((".txt", ".js", ".css", ".html", ".json", ".svg", ".woff2")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, *args):
        sys.stdout.write("%s - %s\n" % (self.address_string(), args[0] % args[1:]))


if __name__ == "__main__":
    with http.server.ThreadingHTTPServer((HOST, PORT), Handler) as httpd:
        print(f"Checklist app at http://{HOST}:{PORT}  (root: {ROOT})")
        print("Press Ctrl+C to stop")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
