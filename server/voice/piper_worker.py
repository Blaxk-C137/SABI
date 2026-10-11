"""Piper synthesis worker. One process per server, started by tts-child.ts.

Reads one JSON request per line on stdin and writes one JSON reply per line on
stdout. Library logs go to stderr so they can never corrupt the protocol.

  request:  {"id": 1, "cmd": "synth", "model": "/path/voice.onnx", "text": "...", "length_scale": 1.0}
            {"id": 2, "cmd": "warm",  "model": "/path/voice.onnx"}
  reply:    {"id": 1, "ok": true, "sampleRate": 22050, "pcm": "<base64 int16 little-endian>"}
            {"id": 2, "ok": true, "warm": true}
            {"id": 3, "ok": false, "error": "..."}
"""

import base64
import json
import os
import sys

# Keep the real stdout for the protocol; send anything else to stderr.
PROTOCOL = sys.stdout
sys.stdout = sys.stderr

from piper import PiperVoice, SynthesisConfig  # noqa: E402

# One voice in memory at a time: each is about 60 MB of weights.
_loaded_path = None
_voice = None


def load(model_path):
    global _loaded_path, _voice
    if _loaded_path == model_path and _voice is not None:
        return _voice
    if not os.path.isfile(model_path) or not os.path.isfile(model_path + ".json"):
        raise FileNotFoundError(model_path)
    _voice = None
    _voice = PiperVoice.load(model_path, config_path=model_path + ".json")
    _loaded_path = model_path
    return _voice


def synth(model_path, text, length_scale):
    voice = load(model_path)
    config = SynthesisConfig(length_scale=length_scale)
    chunks = []
    rate = voice.config.sample_rate
    for chunk in voice.synthesize(text, syn_config=config):
        rate = chunk.sample_rate
        chunks.append(chunk.audio_int16_bytes)
    return rate, b"".join(chunks)


def reply(message):
    PROTOCOL.write(json.dumps(message) + "\n")
    PROTOCOL.flush()


def handle(line):
    request = json.loads(line)
    rid = request.get("id")
    try:
        if request.get("cmd") == "warm":
            load(request["model"])
            reply({"id": rid, "ok": True, "warm": True})
            return
        rate, pcm = synth(request["model"], request["text"], float(request.get("length_scale", 1.0)))
        reply({"id": rid, "ok": True, "sampleRate": rate, "pcm": base64.b64encode(pcm).decode("ascii")})
    except Exception as e:  # report every failure to the caller; one bad request must not kill the worker
        reply({"id": rid, "ok": False, "error": "%s: %s" % (type(e).__name__, e)})


def main():
    reply({"ready": True})
    for line in sys.stdin:
        line = line.strip()
        if line:
            handle(line)


if __name__ == "__main__":
    main()
