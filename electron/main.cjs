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

  backendProcess.on("error", (err) => {
    console.error("Failed to launch Daisy backend. Check the packaged binary or Python venv setup.", err);
  });
  backendProcess.on("exit", (code) => {
    console.error(`Daisy backend exited with code ${code}`);
  });
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

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}

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

  // Always launch the backend on startup, then wait until it's healthy.
  startBackend();
  try {
    await waitForServer(`http://127.0.0.1:${API_PORT}/healthz`);
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

app.whenReady().then(() => {
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
  stopBackend();
  if (process.platform !== "darwin") {
    app.quit();
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
