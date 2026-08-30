"""Download the Piper TTS voice model for Daisy (idempotent).

Run automatically by `npm run backend:setup`. Fetches a compact, high-quality
English female voice (~61MB) into backend/voices/.
"""
import sys
import urllib.request
from pathlib import Path

VOICES_DIR = Path(__file__).resolve().parent / "voices"
BASE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium"
FILES = ["en_US-amy-medium.onnx", "en_US-amy-medium.onnx.json"]


def main() -> int:
    VOICES_DIR.mkdir(exist_ok=True)
    for name in FILES:
        dest = VOICES_DIR / name
        if dest.exists() and dest.stat().st_size > 0:
            print(f"already present: {name}")
            continue
        url = f"{BASE_URL}/{name}"
        print(f"downloading {name} ...")
        try:
            urllib.request.urlretrieve(url, dest)
        except Exception as err:  # noqa: BLE001
            print(f"  failed: {err}", file=sys.stderr)
            return 1
    print("Voice model ready in backend/voices/.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
