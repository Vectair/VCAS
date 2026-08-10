#!/usr/bin/env python3
"""
logServer.py — static file server + ground-truth observation log endpoint.

Drop-in replacement for `python -m http.server`: serves this project's
files exactly the same way, but also handles POST /api/log by appending
each observation as one line to logs/observations.jsonl (JSON Lines —
one JSON object per line, easy to append to and easy to load later with
pandas/jq/whatever). GET /api/log returns the accumulated file so you can
just visit it in a browser to see everything logged so far.

Standard library only — no pip install, consistent with the rest of this
project's no-build-step approach.

Usage:
    python3 logServer.py [port]      (defaults to 8080)
"""

import http.server
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

LOG_DIR  = Path(__file__).parent / "logs"
LOG_FILE = LOG_DIR / "observations.jsonl"


class LogRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/api/log":
            self.send_error(404, "Not found")
            return

        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b""

        try:
            observation = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_error(400, "Body must be valid JSON")
            return

        # Server-side receipt timestamp, kept separate from the client's own
        # `timestamp` field (GPS/system clocks can drift; both are useful).
        observation["_receivedAt"] = datetime.now(timezone.utc).isoformat()

        LOG_DIR.mkdir(exist_ok=True)
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(observation) + "\n")

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True}).encode("utf-8"))

    def do_GET(self):
        if self.path == "/api/log":
            body = LOG_FILE.read_bytes() if LOG_FILE.exists() else b""
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, format, *args):
        # Keep the default access log — useful for confirming which files
        # actually got requested (e.g. spotting a stale/uncloned checkout).
        super().log_message(format, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = http.server.HTTPServer(("", port), LogRequestHandler)
    print(f"Serving VCAS on http://localhost:{port}")
    print(f"Observation log: {LOG_FILE}  (POST/GET /api/log)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
