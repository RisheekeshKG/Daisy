import { spawnSync } from "child_process";
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = path.join(rootDir, "backend");
const python = process.platform === "win32"
  ? path.join(backendDir, ".venv", "Scripts", "python.exe")
  : path.join(backendDir, ".venv", "bin", "python");

if (!fs.existsSync(python)) {
  console.error(`Python venv not found at ${python}. Run npm run backend:setup first.`);
  process.exit(1);
}

const voicesData = `${path.join(backendDir, "voices")}${path.delimiter}voices`;

const whisperModelDir = path.join(backendDir, "whisper-model");
if (!fs.existsSync(path.join(whisperModelDir, "model.bin"))) {
  console.error(
    `Whisper model not found at ${whisperModelDir}. Run "npm run backend:setup" (or backend/.venv/bin/python backend/download_whisper.py) first.`
  );
  process.exit(1);
}
const whisperModelData = `${whisperModelDir}${path.delimiter}whisper-model`;

/**
 * Some packages ship plain (non-Python) data files that their compiled
 * extensions load relative to the package's own install location at
 * runtime. PyInstaller only auto-detects Python source/bytecode, so these
 * silently get left out of the frozen build and only fail the first time
 * the feature is actually used. Resolve each one from the venv itself
 * (rather than hardcoding a site-packages/python-version path) and bundle
 * it explicitly next to where the package expects to find it.
 */
function resolvePackageDataDir(label, pyExpr) {
  const result = spawnSync(python, ["-c", pyExpr], { cwd: rootDir });
  const dir = result.stdout.toString().trim();
  if (result.status !== 0 || !dir || !fs.existsSync(dir)) {
    console.error(`Could not resolve ${label}. Is it installed in the venv?`);
    process.exit(1);
  }
  return dir;
}

// piper's espeak-ng phonemizer: Path(__file__).parent / "espeak-ng-data".
// Without it, /api/tts crashes the whole process ("espeak-ng-data/phontab:
// No such file or directory").
const piperDataDir = resolvePackageDataDir(
  "piper's espeak-ng-data directory",
  "import piper.phonemize_espeak as m; print(m.ESPEAK_DATA_DIR)"
);
const piperData = `${piperDataDir}${path.delimiter}piper/espeak-ng-data`;

// faster-whisper's Silero VAD model, loaded by transcribe(vad_filter=True).
// Without it, /api/stt returns a 500 ("silero_vad_v6.onnx ... File doesn't
// exist") for every utterance, so voice input silently never transcribes.
const whisperAssetsDir = resolvePackageDataDir(
  "faster_whisper's assets directory",
  "import faster_whisper.assets as a, os; print(os.path.dirname(a.__file__))"
);
const whisperAssetsData = `${whisperAssetsDir}${path.delimiter}faster_whisper/assets`;

const args = [
  "-m",
  "PyInstaller",
  "--noconfirm",
  "--clean",
  "--name",
  "daisy-backend",
  "--distpath",
  path.join(backendDir, "dist"),
  "--workpath",
  path.join(backendDir, "build"),
  "--specpath",
  backendDir,
  "--add-data",
  voicesData,
  "--add-data",
  whisperModelData,
  "--add-data",
  piperData,
  "--add-data",
  whisperAssetsData,
  "--hidden-import",
  "google.genai",
  "--hidden-import",
  "spotify",
  "--hidden-import",
  "httpx",
  "--hidden-import",
  "piper",
  "--hidden-import",
  "faster_whisper",
  path.join(backendDir, "main.py"),
];

const result = spawnSync(python, args, {
  stdio: "inherit",
  cwd: rootDir,
});

process.exit(result.status ?? 1);