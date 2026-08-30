const { app, BrowserWindow, ipcMain, session, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");

// When the launching process dies (e.g. `concurrently -k` tearing down the Vite
// side), our stdio pipes lose their reader. Electron's own internal logging then
// throws EPIPE as an uncaught exception, which pops a crash dialog the wedged
// main process can no longer close. Swallow EPIPE; re-throw anything else.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err) => {
    if (err.code !== "EPIPE") throw err;
  });
}

// FastAPI backend port (kept in sync with vite.config.ts proxy target).
const API_PORT = process.env.DAISY_API_PORT || "8000";
// In dev, ELECTRON_START_URL points at the Vite dev server (which proxies /api).
const DEV_SERVER_URL = process.env.ELECTRON_START_URL;
const IS_DEV = !!DEV_SERVER_URL;

let mainWindow;
let backendProcess;
let allowClose = false;

function resolveBackendExecutable(resourcesDir) {
  const exeName = process.platform === "win32" ? "daisy-backend.exe" : "daisy-backend";
  return path.join(resourcesDir, "backend", exeName);
}

/** Resolve the Python interpreter: prefer the project venv, else system python. */
function resolvePython(backendDir) {
  const candidates =
    process.platform === "win32"
      ? [path.join(backendDir, ".venv", "Scripts", "python.exe"), "python.exe", "python"]
      : [path.join(backendDir, ".venv", "bin", "python"), "python3", "python"];

  for (const c of candidates) {
    // Absolute paths must exist; bare command names are trusted to be on PATH.
    if (path.isAbsolute(c)) {
      if (fs.existsSync(c)) return c;
    } else {
      return c;
    }
  }
  return "python3";
}

function waitForServer(url, timeoutMs = 120000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on("error", () => {
          if (Date.now() - start > timeoutMs) {
            reject(new Error(`Backend at ${url} did not start in time`));
          } else {
            setTimeout(attempt, 300);
          }
        });
    };
    attempt();
  });
}

/** Absolute path to the app icon PNG, or "" when it hasn't been generated.
 *
 * assets/icon/icon.png is listed in package.json "files", so it sits under the
 * app path in both dev (project root) and packaged builds (inside app.asar).
 */
function appIconPath() {
  const candidate = path.join(app.getAppPath(), "assets", "icon", "icon.png");
  return fs.existsSync(candidate) ? candidate : "";
}

/** Resolve true if something is already serving the API port. */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/healthz", timeout: 1000 },
      (res) => {
        res.resume();
        resolve(true);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Spawn the FastAPI backend (uvicorn). Runs in both dev and production. */
function startBackend() {
  const appPath = app.getAppPath();
  const backendDir = path.join(appPath, "backend");
  const resourcesDir = app.isPackaged ? process.resourcesPath : appPath;
  const packagedBackend = resolveBackendExecutable(resourcesDir);
  const distDir = path.join(resourcesDir, "dist");

  const env = {
    ...process.env,
    DAISY_API_PORT: String(API_PORT),
  };

  // In production the backend also serves the built frontend.
  if (!IS_DEV) {
    env.DAISY_SERVE_STATIC = "1";
    env.DAISY_STATIC_DIR = distDir;
  }

  if (fs.existsSync(packagedBackend)) {
    console.log(`Starting packaged Daisy backend: ${packagedBackend} (port ${API_PORT})`);
    backendProcess = spawn(packagedBackend, [], {
      cwd: path.dirname(packagedBackend),
      env,
      stdio: "inherit",
      windowsHide: true,
    });
  } else {
    const python = resolvePython(backendDir);
    console.log(`Starting Daisy backend: ${python} -m uvicorn (port ${API_PORT})`);
    backendProcess = spawn(
      python,
      ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(API_PORT)],
      {
        cwd: backendDir,
        env,
        stdio: "inherit",
        windowsHide: true,
      }
    );
  }

  const child = backendProcess;
  child.on("error", (err) => {
    console.error("Failed to launch Daisy backend. Check the packaged binary or Python venv setup.", err);
  });
  child.on("exit", (code, signal) => {
    console.error(`Daisy backend exited (code ${code}, signal ${signal ?? "none"})`);
    // Only supervise the process we currently own: stopBackend() clears
    // backendProcess first, so a deliberate shutdown never triggers a restart.
    if (backendProcess === child) {
      backendProcess = null;
      scheduleBackendRestart();
    }
  });
}

// Restart backoff state. The backend dying mid-session used to leave the UI
// permanently talking to a closed port (every /api call refused) with no way
// back short of quitting, so bring it back automatically.
let backendRestarts = 0;
let backendRestartTimer = null;
const MAX_BACKEND_RESTARTS = 5;

function scheduleBackendRestart() {
  if (shuttingDown || backendRestartTimer) return;
  if (backendRestarts >= MAX_BACKEND_RESTARTS) {
    console.error(
      `Daisy backend has failed ${MAX_BACKEND_RESTARTS} times; not restarting again. ` +
      "Check the output above for the Python error."
    );
    return;
  }
  // Back off so a backend that crashes instantly can't spin the CPU.
  const delay = Math.min(1000 * 2 ** backendRestarts, 15000);
  backendRestarts += 1;
  console.log(`Restarting Daisy backend in ${delay}ms (attempt ${backendRestarts}/${MAX_BACKEND_RESTARTS})…`);
  backendRestartTimer = setTimeout(async () => {
    backendRestartTimer = null;
    if (shuttingDown) return;
    // Something else may have taken the port in the meantime.
    if (await isPortInUse(API_PORT)) {
      console.log("Backend port is serving again; no restart needed.");
      return;
    }
    startBackend();
  }, delay);
  backendRestartTimer.unref?.();
}

function statusPageUrl(title, message, showSpinner) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Daisy</title>
<style>
  html,body{height:100%;margin:0;background:#f5efe6;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#4a3f35;}
  body{display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center;padding:24px;box-sizing:border-box;}
  h1{font-size:20px;margin:0 0 8px;}
  p{font-size:14px;opacity:0.75;max-width:420px;margin:0;}
  .spinner{width:28px;height:28px;border-radius:50%;border:3px solid rgba(74,63,53,0.15);border-top-color:#4a3f35;animation:spin 0.9s linear infinite;margin-bottom:16px;}
  @keyframes spin{to{transform:rotate(360deg);}}
</style></head><body>
${showSpinner ? '<div class="spinner"></div>' : ""}
<h1>${title}</h1>
<p>${message}</p>
</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/**
 * Terminate the backend child.
 *
 * uvicorn does not always honour SIGTERM promptly while it is serving a
 * request, so the signal is escalated to SIGKILL rather than trusting it to
 * exit. Leaving it alive orphans a process holding the API port, which the next
 * `npm run electron:dev` then cannot bind.
 *
 * `immediate` skips the grace period for last-resort exit handlers, which have
 * no opportunity to wait for an async callback.
 */
function stopBackend({ immediate = false } = {}) {
  const child = backendProcess;
  backendProcess = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  try {
    if (immediate) {
      child.kill("SIGKILL");
      return;
    }
    child.kill("SIGTERM");
    const escalate = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, 1200);
    // Never let this timer hold the event loop open on its own.
    escalate.unref?.();
    child.once("exit", () => clearTimeout(escalate));
  } catch {
    /* the child was already gone */
  }
}

let shuttingDown = false;

/**
 * Ctrl+C in the dev terminal signals the whole process group. Electron exits
 * without running its own `before-quit` lifecycle, so without this the backend
 * is orphaned on every interrupt.
 */
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopBackend();
  const bail = setTimeout(() => app.exit(0), 1500);
  bail.unref?.();
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, shutdown);
}
// Last resort: synchronous, so only an immediate kill is possible here.
process.on("exit", () => {
  stopBackend({ immediate: true });
});

async function createWindow() {
  // On macOS, use the OS's own traffic-light window controls (like every
  // native Mac app) instead of faking them in the renderer — hiddenInset
  // keeps the real red/yellow/green buttons but drops the rest of the
  // title bar so our own draggable header can sit underneath them. Other
  // platforms have no traffic-light equivalent, so keep the fully custom
  // frameless window + renderer-drawn controls there.
  const macChrome =
    process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 16 } }
      : { frame: false };

  mainWindow = new BrowserWindow({
    title: "Daisy",
    // Packaged builds take their icon from the bundle (electron-builder), but
    // Windows/Linux dev runs need it set explicitly or they show Electron's.
    ...(process.platform === "darwin" ? {} : { icon: appIconPath() }),
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#f5efe6",
    ...macChrome,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Keep the window pinned to the app itself. Without these, anything that
  // can get a link click or a window.open past the renderer (an injected
  // string, a compromised dependency) could replace the app with an attacker
  // page — which would then inherit the preload bridge *and* count as a
  // local-origin caller of the API. Real outbound links go to the OS browser.
  const isAppUrl = (url) => {
    try {
      const { protocol, hostname } = new URL(url);
      if (protocol === "file:") return true;
      return (
        (protocol === "http:" || protocol === "https:") &&
        (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1")
      );
    } catch {
      return false;
    }
  };

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Never open a second Electron window; hand http(s) to the real browser.
    try {
      const { protocol } = new URL(url);
      if (protocol === "http:" || protocol === "https:") shell.openExternal(url);
    } catch {
      /* ignore malformed urls */
    }
    return { action: "deny" };
  });

  // Attaching webviews is never intentional here, and they bypass the
  // webPreferences hardening set above.
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());

  mainWindow.on("maximize", () => {
    mainWindow.webContents.send("window:maximized-change", true);
  });
  mainWindow.on("unmaximize", () => {
    mainWindow.webContents.send("window:maximized-change", false);
  });

  // The native traffic-light red button (mac) fires a real "close" — route
  // it through the same in-app confirm dialog the custom button already
  // uses, instead of quitting instantly. ipcMain's "window:close" (below)
  // is the only path allowed to actually close the window.
  mainWindow.on("close", (e) => {
    if (allowClose) return;
    e.preventDefault();
    mainWindow?.webContents.send("window:close-requested");
  });

  // Show a loading screen immediately so the window is never a stark blank
  // page while the backend (which bundles local whisper/piper models) boots.
  mainWindow.loadURL(statusPageUrl("Waking up Daisy…", "Starting the local voice engine. This can take a little longer the first time.", true));

  // Launch the backend on startup, then wait until it's healthy. If something
  // is already serving the port — typically a backend orphaned by a previous
  // run — adopt it instead of spawning a second one that would only die with
  // "address already in use" and leave the app with no API at all.
  if (await isPortInUse(API_PORT)) {
    console.log(`Daisy backend already listening on ${API_PORT}; reusing it.`);
  } else {
    startBackend();
  }
  try {
    await waitForServer(`http://127.0.0.1:${API_PORT}/healthz`);
    // Healthy again — forget earlier failures so the restart budget applies to
    // a fresh burst of crashes, not to the whole session.
    backendRestarts = 0;
  } catch (err) {
    console.error(err);
    if (mainWindow) {
      mainWindow.loadURL(statusPageUrl(
        "Daisy couldn't start",
        "The local backend didn't respond in time. Quit and reopen Daisy — if this keeps happening, check Console.app for a \"daisy-backend\" crash log.",
        false
      ));
    }
    return;
  }

  // Dev → load the Vite dev server (it proxies /api to the backend).
  // Prod → load the backend itself (it serves the static frontend + /api).
  const targetUrl = DEV_SERVER_URL || `http://127.0.0.1:${API_PORT}`;
  mainWindow.loadURL(targetUrl);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.on("window:minimize", () => {
  mainWindow?.minimize();
});

ipcMain.on("window:maximize-toggle", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on("window:close", () => {
  allowClose = true;
  mainWindow?.close();
});

ipcMain.handle("window:is-maximized", () => {
  return mainWindow?.isMaximized() ?? false;
});

// Open a URL in the user's real browser (used for the Spotify OAuth consent
// screen — providers reject embedded webviews, and it keeps their existing
// browser session/password manager available).
ipcMain.handle("shell:open-external", async (_event, url) => {
  // Only ever hand http(s) to the OS: other schemes (file:, or app handlers)
  // could be abused to launch arbitrary local targets.
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    await shell.openExternal(parsed.toString());
    return true;
  } catch {
    return false;
  }
});

// Names the app in the macOS menu bar and in app.getName(). Must be set before
// the app is ready, or macOS keeps showing "Electron" during development.
app.setName("Daisy");

app.whenReady().then(() => {
  // In development the dock icon comes from the running Electron binary rather
  // than a bundle Info.plist, so set it explicitly to avoid the default logo.
  if (process.platform === "darwin" && !app.isPackaged) {
    const icon = appIconPath();
    if (icon) app.dock?.setIcon(icon);
  }

  // Content-Security-Policy. The renderer is a local app, so everything it
  // needs is same-origin except Spotify's album art (remote https images) and
  // the TTS audio it plays back from a blob: URL.
  //
  // Vite's dev server needs 'unsafe-eval' and a websocket for HMR; a packaged
  // build gets the strict policy, so shipped code can never eval a string or
  // reach a host the app has no business talking to.
  const csp = [
    "default-src 'self'",
    IS_DEV
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self'",
    // Tailwind and the animation library both set element styles inline.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    IS_DEV ? "connect-src 'self' ws: http://127.0.0.1:* http://localhost:*" : "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });

  // Allow microphone access for Daisy's always-listening voice mode.
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media" || permission === "microphone" || permission === "audioCapture");
  });
  ses.setPermissionCheckHandler((_wc, permission) => {
    return permission === "media" || permission === "microphone" || permission === "audioCapture";
  });
  createWindow();
});

app.on("window-all-closed", () => {
  // On macOS the app stays alive after its last window closes and can be
  // reopened from the dock, so the backend has to stay up too — stopping it
  // here left `activate` showing a window with no API behind it.
  if (process.platform !== "darwin") {
    app.quit(); // triggers before-quit, which stops the backend
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  stopBackend();
});

// Covers quit paths that bypass before-quit (e.g. a forced app.exit).
app.on("will-quit", () => {
  stopBackend({ immediate: true });
});
