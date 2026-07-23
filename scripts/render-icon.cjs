/**
 * Render an SVG to a transparent PNG using Electron's Chromium.
 * ImageMagick has no librsvg delegate here (drops gradients/filters) and
 * QuickLook flattens alpha onto white, so neither can produce an app icon.
 *
 * usage: electron render-icon.cjs <in.svg> <out.png> <size>
 */
const { app, BrowserWindow } = require("electron");
const fs = require("fs");

const [svgPath, outPath, sizeArg] = process.argv.slice(2);
const SIZE = parseInt(sizeArg, 10) || 1024;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    useContentSize: true,
    webPreferences: { offscreen: true },
  });

  const svg = fs.readFileSync(svgPath, "utf8");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden;}
    svg{display:block;width:${SIZE}px;height:${SIZE}px;}
  </style></head><body>${svg}</body></html>`;

  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  // Give the filter/gradient rasterization a moment to settle before capture.
  await new Promise((r) => setTimeout(r, 1200));

  const image = await win.webContents.capturePage();
  fs.writeFileSync(outPath, image.toPNG());
  console.log(`wrote ${outPath} (${image.getSize().width}x${image.getSize().height})`);
  app.exit(0);
});
