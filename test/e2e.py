#!/usr/bin/env python3
"""content.js をヘッドレス Chrome の実 DOM 上で動かし、コピー結果を検証する。

ローカルサーバを PR ページと同じパス構成で立てることで、content.js を一切
改変せずに location.pathname と fetch の両方を本番同様に通す。

    python3 test/e2e.py

Chrome の場所は環境変数 CHROME で上書きできる。
"""

import difflib
import http.server
import json
import os
import pathlib
import queue
import subprocess
import sys
import tempfile
import threading
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
REPO = "/microsoft/vscode"
SUCCESS_TOAST = "Pull Request概要をコピーしました"
CHROME = os.environ.get(
    "CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
)

# (PR 番号, PR ページのフィクスチャ, 期待するコピー結果, 拡張機能の設定)
CASES = [
    ("200000", "fixture-pr.html", "expected-pr.md", {}),
    ("200001", "fixture-same-repo.html", "expected-same-repo.md", {}),
    ("200001", "fixture-same-repo.html", "expected-same-repo-no-images.md",
     {"removeImages": True}),
]
FIXTURES = {f"{REPO}/pull/{number}": name for number, name, _, _ in CASES}

results = queue.Queue()

# content.js は Files changed タブ相当のパスから実行され、Conversation ページを fetch する。
# 拡張機能の設定はクエリ文字列 settings（JSON）で受け取り、chrome.storage の代わりに返す
HARNESS = """<!doctype html>
<html><body><script>
let copied = null
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: (text) => { copied = text; return Promise.resolve() } },
})
const settings = JSON.parse(new URLSearchParams(location.search).get('settings'))
window.chrome = {
  storage: { sync: { get: (defaults) => Promise.resolve({ ...defaults, ...settings }) } },
}

const report = (toast) => navigator.sendBeacon('/result', JSON.stringify({ copied, toast }))

// トーストは 3 秒で自壊するため、出た瞬間に捕まえないと失敗理由が失われる
new MutationObserver((_, observer) => {
  const toast = document.getElementById('copy-pr-summary-toast')
  if (!toast) return
  observer.disconnect()
  report(toast.textContent)
}).observe(document.body, { childList: true })

setTimeout(() => report(null), 8000)
</script><script src="/content.js"></script></body></html>
"""


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/content.js":
            self._send((ROOT / "content.js").read_bytes(), "text/javascript")
        elif self.path.split("?")[0].endswith("/files"):
            self._send(HARNESS.encode(), "text/html")
        elif self.path in FIXTURES:
            self._send((ROOT / "test" / FIXTURES[self.path]).read_bytes(), "text/html")
        else:
            self.send_error(404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        results.put(json.loads(self.rfile.read(length)))
        self._send(b"", "text/plain")

    def _send(self, body, ctype):
        self.send_response(200)
        self.send_header("Content-Type", f"{ctype}; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def run_case(url):
    """ヘッドレス Chrome でハーネスを開き、コピー結果とトースト文言を受け取る"""
    with tempfile.TemporaryDirectory() as profile:
        chrome = subprocess.Popen(
            [CHROME, "--headless=new", "--disable-gpu", "--no-first-run",
             f"--user-data-dir={profile}", url],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        try:
            return results.get(timeout=30)
        except queue.Empty:
            return {"copied": None, "toast": "(Chrome から結果が返りませんでした)"}
        finally:
            chrome.terminate()
            chrome.wait(timeout=10)


def check(origin, number, expected_file, settings):
    expected = (ROOT / "test" / expected_file).read_text().replace("{ORIGIN}", origin)
    query = urllib.parse.urlencode({"settings": json.dumps(settings)})
    result = run_case(f"{origin}{REPO}/pull/{number}/files?{query}")

    label = f"pull/{number} {settings}"
    if result["toast"] != SUCCESS_TOAST:
        return f"{label}: コピーに至りませんでした: {result['toast']}"
    if result["copied"] == expected:
        return None

    diff = difflib.unified_diff(
        expected.splitlines(True), result["copied"].splitlines(True),
        expected_file, f"{label} actual",
    )
    return f"{label}:\n" + "".join(diff)


def main():
    if not pathlib.Path(CHROME).exists():
        sys.exit(f"Chrome が見つかりません: {CHROME}\n環境変数 CHROME で場所を指定してください")

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    origin = f"http://127.0.0.1:{server.server_address[1]}"
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        failures = [f for f in (check(origin, n, e, s) for n, _, e, s in CASES) if f]
    finally:
        server.shutdown()
        server.server_close()

    if failures:
        sys.exit("FAIL:\n" + "\n".join(failures))
    print(f"PASS ({len(CASES)} cases)")


if __name__ == "__main__":
    main()
