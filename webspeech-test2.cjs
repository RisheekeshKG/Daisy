const { app, BrowserWindow, session } = require("electron");
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  // Exactly what electron/main.cjs does for the real window.
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, p, cb) => cb(true));
  ses.setPermissionCheckHandler(() => true);

  const win = new BrowserWindow({ show: false, width: 400, height: 300 });
  await win.loadURL("http://localhost:3000");
  await new Promise(r => setTimeout(r, 2500));
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Ctor) return { available:false, reason:"constructor missing" };
      // Prove mic access itself works in this context first.
      let micOk = false;
      try { const s = await navigator.mediaDevices.getUserMedia({audio:true}); micOk = true; s.getTracks().forEach(t=>t.stop()); } catch(e) { micOk = "getUserMedia failed: "+e.name; }
      return await new Promise((resolve) => {
        const r = new Ctor();
        r.lang="en-US"; r.continuous=true; r.interimResults=true;
        let settled=false;
        const done=(o)=>{ if(!settled){settled=true; try{r.abort()}catch{}; resolve({micOk, ...o});} };
        r.onerror=(e)=>done({ error:e.error });
        r.onresult=()=>done({ error:null, gotResult:true });
        r.onstart=()=>setTimeout(()=>done({ error:null, note:"no error/result in 8s" }),8000);
        try{ r.start(); }catch(e){ done({ error:"start threw: "+e.message }); }
      });
    })()
  `);
  console.log("RESULT2 " + JSON.stringify(result));
  app.exit(0);
});
