export interface DaisyBridge {
  isElectron: true;
  platform: NodeJS.Platform;
  minimize: () => void;
  maximizeToggle: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void;
  onCloseRequested: (callback: () => void) => () => void;
  openExternal: (url: string) => Promise<boolean>;
}

declare global {
  interface Window {
    daisy?: DaisyBridge;
  }
}

export const daisyBridge: DaisyBridge | null =
  typeof window !== "undefined" && window.daisy ? window.daisy : null;
