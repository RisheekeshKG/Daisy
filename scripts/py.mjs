/**
 * Run a command with the backend virtualenv's interpreter.
 *
 * Exists so package.json can say `node scripts/py.mjs -m pytest …` instead of
 * a `backend/.venv/bin/python` path that does not exist on Windows.
 */
import { run, venvExists, venvPython } from "./venv.mjs";

if (!venvExists()) {
  console.error('Backend virtualenv missing. Run "npm run backend:setup" first.');
  process.exit(1);
}

run(venvPython(), process.argv.slice(2));
