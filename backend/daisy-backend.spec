# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['/Users/risheekeshkg/Documents/Project Work/Daisy/backend/main.py'],
    pathex=[],
    binaries=[],
    datas=[('/Users/risheekeshkg/Documents/Project Work/Daisy/backend/voices', 'voices'), ('/Users/risheekeshkg/Documents/Project Work/Daisy/backend/whisper-model', 'whisper-model'), ('/Users/risheekeshkg/Documents/Project Work/Daisy/backend/.venv/lib/python3.12/site-packages/piper/espeak-ng-data', 'piper/espeak-ng-data'), ('/Users/risheekeshkg/Documents/Project Work/Daisy/backend/.venv/lib/python3.12/site-packages/faster_whisper/assets', 'faster_whisper/assets')],
    hiddenimports=['google.genai', 'spotify', 'httpx', 'piper', 'faster_whisper'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='daisy-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='daisy-backend',
)
