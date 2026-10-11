"""Browser check of the reply flow: speech -> board lines -> closing speech.

Mocks Gemini (SSE) and /api/tts (a short tone WAV) so it runs offline.
Records the order of TTS requests and checks the board shows up in sequence.
Run with the dev server up:  python3 scripts/e2e-board-flow.py
"""
import json, struct, math, sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:5173/"
REPLY = ("First, the first law states energy is conserved. "
         '<board title="Work">\n$$\\Delta U = Q - W$$\n\nQ = 5 J\n\nW = 2 J\n</board>'
         " So delta U is three joules. What happens when W is negative?")

def tone_wav(seconds=0.4, sr=24000):
    n = int(sr * seconds)
    data = b"".join(struct.pack("<h", int(0.2 * 32767 * math.sin(2 * math.pi * 220 * i / sr))) for i in range(n))
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, sr, sr * 2, 2, 16) + b"data" + struct.pack("<I", len(data)) + data

def sse(text):
    chunks = [text[i:i + 40] for i in range(0, len(text), 40)]
    out = ""
    for c in chunks:
        out += "data: " + json.dumps({"candidates": [{"content": {"parts": [{"text": c}]}}]}) + "\n\n"
    return out

settings = {"geminiKey": "fake-key", "model": "", "asrModel": "", "ttsVoice": "", "ttsSpeed": 1,
            "accent": "en-NG", "captions": True, "speak": True, "setupDone": True,
            "studentName": "Adaeze", "courseName": "GET206", "notation": "ΔU = Q − W"}
tts_texts = []
errors = []
wav = tone_wav()

with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    pg = b.new_page(viewport={"width": 1280, "height": 800})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    def handle_gemini(route):
        route.fulfill(status=200, content_type="text/event-stream", body=sse(REPLY))
    def handle_tts(route):
        body = json.loads(route.request.post_data or "{}")
        tts_texts.append(body.get("text", ""))
        route.fulfill(status=200, content_type="audio/wav", body=wav)
    pg.route("**/v1beta/**", handle_gemini)
    pg.route("**/api/tts", handle_tts)

    pg.goto(URL)
    pg.evaluate("s => localStorage.setItem('sabi.settings', JSON.stringify(s))", settings)
    pg.goto(URL)
    pg.wait_for_timeout(1000)
    pg.get_by_label("Type").click()
    pg.locator("textarea").fill("Explain the first law.")
    pg.locator("textarea").press("Enter")
    # Board appears once the reply has been parsed.
    pg.wait_for_selector(".board-frame", timeout=15000)
    pg.wait_for_timeout(6000)  # let the walk finish
    pg.screenshot(path="/tmp/board-flow.png")
    board_lines = pg.locator(".board-line").count()
    b.close()

print("TTS clips in order:")
for i, t in enumerate(tts_texts):
    print(f"  {i+1}. {t[:90]}")
print("board lines written:", board_lines)
print("page errors:", [e for e in errors if "GL Driver" not in e and "DevTools" not in e][:5])

ok = (len(tts_texts) >= 3
      and "first law" in tts_texts[0].lower()
      and "three joules" in tts_texts[-1].lower()
      and board_lines == 3)
print("RESULT:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
