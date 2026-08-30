import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BACKEND_DIR = path.join(ROOT, "backend");
export const IS_WIN = process.platform === "win32";

/**
 * The interpreter inside backend/.venv.
 *
 * Windows puts it in Scripts/ with a .exe suffix rather than bin/, which is
 * why every backend npm script routes through here instead of hardcoding a
 * path that only resolves on macOS and Linux.
 */
export function venvPython() {
  return IS_WIN
    ? path.join(BACKEND_DIR, ".venv", "Scripts", "python.exe")
    : path.join(BACKEND_DIR, ".venv", "bin", "python");
}

export function venvExists() {
  return fs.existsSync(venvPython());
}

/** A system interpreter to build the venv with — "python3" is absent on Windows. */
export function systemPython() {
  for (const candidate of IS_WIN ? ["python", "py"] : ["python3", "python"]) {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (probe.status === 0) return candidate;
  }
  console.error(
    "No Python interpreter found. Install Python 3.10+ and make sure it is on PATH."
  );
  process.exit(1);
}

/** Run a command, inheriting stdio, and exit the process if it fails. */
export function run(cmd, args, label) {
  const result = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT });
  if (result.status !== 0) {
    if (label) console.error(`\n${label} failed.`);
    process.exit(result.status ?? 1);
  }
}
