const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("daisy", {
  isElectron: true,
  platform: process.platform,
  minimize: () => ipcRenderer.send("window:minimize"),
  maximizeToggle: () => ipcRenderer.send("window:maximize-toggle"),
  close: () => ipcRenderer.send("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  onMaximizedChange: (callback) => {
    const listener = (_event, isMaximized) => callback(isMaximized);
    ipcRenderer.on("window:maximized-change", listener);
    return () => ipcRenderer.removeListener("window:maximized-change", listener);
  },
  // Fired when the OS-native close control (e.g. the mac traffic light) was
  // clicked, so the renderer can show the same quit-confirm dialog the
  // custom button already uses instead of the window vanishing instantly.
  onCloseRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("window:close-requested", listener);
    return () => ipcRenderer.removeListener("window:close-requested", listener);
  },
  // Opens http(s) links in the user's default browser.
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
});
