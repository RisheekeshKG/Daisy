#!/usr/bin/env node
/**
 * Compiles native/DaisySpeech.swift into build/DaisySpeech.
 *
 * The binary needs NSSpeechRecognitionUsageDescription embedded in its own
 * __TEXT,__info_plist section: macOS aborts a process the instant it touches
 * the Speech framework without one, and a helper spawned by Electron is a
 * separate process with its own identity.
 *
 * No-ops on non-macOS and when the Swift toolchain is missing, so `npm install`
 * and CI on other platforms stay green — Daisy falls back to Whisper there.
 */
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "native", "DaisySpeech.swift");
const OUT_DIR = path.join(ROOT, "build");
const OUT = path.join(OUT_DIR, "DaisySpeech");
const PLIST = path.join(OUT_DIR, "DaisySpeech-Info.plist");

function skip(reason) {
  console.log(`build-speech: skipped (${reason})`);
  process.exit(0);
}

if (process.platform !== "darwin") skip("not macOS");
if (spawnSync("which", ["swiftc"]).status !== 0) skip("swiftc not found");
if (!fs.existsSync(SRC)) skip("native/DaisySpeech.swift missing");

fs.mkdirSync(OUT_DIR, { recursive: true });

fs.writeFileSync(
  PLIST,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.daisy.speech</string>
  <key>CFBundleName</key><string>DaisySpeech</string>
  <key>NSSpeechRecognitionUsageDescription</key><string>Daisy uses speech recognition to understand your voice commands.</string>
  <key>NSMicrophoneUsageDescription</key><string>Daisy listens for your voice so you can talk to your assistant.</string>
</dict></plist>
`
);

/**
 * `npm run electron:dev` runs the stock Electron.app from node_modules, whose
 * Info.plist has no speech usage description — so macOS aborts the helper the
 * moment it touches the Speech framework. Patch a copy in place (npm install
 * wipes it, hence doing this on every build) and re-sign, since editing the
 * plist invalidates the bundle seal.
 */
function patchDevElectron() {
  const plist = path.join(
    ROOT, "node_modules", "electron", "dist", "Electron.app", "Contents", "Info.plist"
  );
  if (!fs.existsSync(plist)) return;
  try {
    const current = execFileSync("plutil", ["-p", plist], { encoding: "utf8" });
    if (current.includes("NSSpeechRecognitionUsageDescription")) return;
    execFileSync("plutil", [
      "-insert", "NSSpeechRecognitionUsageDescription",
      "-string", "Daisy uses speech recognition to understand your voice commands.",
      plist,
    ]);
    execFileSync("codesign", [
      "-s", "-", "-f", "--deep",
      path.join(ROOT, "node_modules", "electron", "dist", "Electron.app"),
    ], { stdio: "ignore" });
    console.log("build-speech: patched dev Electron.app for speech permission");
  } catch (err) {
    console.warn(`build-speech: could not patch dev Electron (${err.message})`);
  }
}

try {
  execFileSync(
    "swiftc",
    [
      "-O",
      SRC,
      "-o", OUT,
      "-framework", "Speech",
      "-framework", "AVFoundation",
      "-Xlinker", "-sectcreate",
      "-Xlinker", "__TEXT",
      "-Xlinker", "__info_plist",
      "-Xlinker", PLIST,
    ],
    { stdio: "inherit" }
  );
  // Ad-hoc signing is enough for the embedded plist to be sealed and read by
  // TCC; electron-builder re-signs with the real identity when packaging.
  execFileSync("codesign", ["-s", "-", "-f", OUT], { stdio: "inherit" });
  console.log(`build-speech: built ${path.relative(ROOT, OUT)}`);
  patchDevElectron();
} catch (err) {
  // A failed native build must not block the JS build — Whisper still works.
  console.warn(`build-speech: FAILED (${err.message}); Daisy will use Whisper`);
  process.exit(0);
}
