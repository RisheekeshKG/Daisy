/**
 * One-time backend setup: create the virtualenv, install dependencies, and
 * fetch the Piper voice and Whisper weights the app needs to run offline.
 *
 * Idempotent — both downloaders skip files they already have, so re-running
 * this after changing requirements.txt is cheap.
 */
import { BACKEND_DIR, run, systemPython, venvExists, venvPython } from "./venv.mjs";
import path from "path";

if (!venvExists()) {
  console.log("Creating backend/.venv…");
  run(systemPython(), ["-m", "venv", path.join(BACKEND_DIR, ".venv")], "venv creation");
} else {
  console.log("Reusing existing backend/.venv");
}

const python = venvPython();

console.log("Installing backend dependencies…");
run(python, ["-m", "pip", "install", "--upgrade", "pip"], "pip upgrade");
run(python, ["-m", "pip", "install", "-r", path.join(BACKEND_DIR, "requirements.txt")], "pip install");

console.log("Fetching speech models…");
run(python, [path.join(BACKEND_DIR, "download_voice.py")], "Piper voice download");
run(python, [path.join(BACKEND_DIR, "download_whisper.py")], "Whisper model download");

console.log("\nBackend ready.");
