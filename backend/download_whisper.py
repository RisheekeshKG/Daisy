"""Download the faster-whisper STT model for Daisy (idempotent).

Run automatically by `npm run backend:setup`. Fetches the converted
CTranslate2 "small.en" model (~480MB) into backend/whisper-model/ so the
packaged app can transcribe speech fully offline, instead of faster-whisper
silently reaching out to the Hugging Face Hub on the first STT request.

Set DAISY_WHISPER_SIZE=base.en for a smaller/faster (less accurate) download.
"""
import os
import shutil
import ssl
import sys
import urllib.request
from pathlib import Path

try:
    import certifi

    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CONTEXT = None

MODEL_DIR = Path(__file__).resolve().parent / "whisper-model"
SIZE = os.environ.get("DAISY_WHISPER_SIZE", "small.en")
BASE_URL = f"https://huggingface.co/Systran/faster-whisper-{SIZE}/resolve/main"
FILES = ["model.bin", "config.json", "tokenizer.json", "vocabulary.txt"]
# Records which size currently sits in MODEL_DIR, so switching sizes re-downloads
# instead of leaving a stale model.bin in place (the files are named identically).
STAMP = MODEL_DIR / ".model-size"


def main() -> int:
    installed = STAMP.read_text().strip() if STAMP.exists() else None
    # An unstamped directory predates this stamping scheme, so its size is
    # unknown — assume it is stale rather than silently keeping the wrong model.
    if installed is None and (MODEL_DIR / "model.bin").exists():
        installed = "unknown (unstamped)"
    if installed and installed != SIZE:
        print(f"Replacing installed model ({installed}) with {SIZE} …")
        shutil.rmtree(MODEL_DIR, ignore_errors=True)

    MODEL_DIR.mkdir(exist_ok=True)
    for name in FILES:
        dest = MODEL_DIR / name
        if dest.exists() and dest.stat().st_size > 0:
            print(f"✓ already present: {name}")
            continue
        url = f"{BASE_URL}/{name}"
        print(f"↓ downloading {name} …")
        tmp = dest.with_suffix(dest.suffix + ".part")
        try:
            # Stream to a temp file: model.bin is ~480MB, and a partial write must
            # never be mistaken for a complete model on the next run.
            with urllib.request.urlopen(url, context=SSL_CONTEXT) as resp, open(tmp, "wb") as out:
                shutil.copyfileobj(resp, out)
            tmp.replace(dest)
        except Exception as err:  # noqa: BLE001
            tmp.unlink(missing_ok=True)
            print(f"  failed: {err}", file=sys.stderr)
            return 1
    STAMP.write_text(SIZE)
    print(f"Whisper model ({SIZE}) ready in backend/whisper-model/.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
