import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

export type CyfersUpdateEvent =
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available"; version: string }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string }
  | { type: "progress"; percent: number };

const cyfersDesktop = {
  getVersion: (): Promise<string> => ipcRenderer.invoke("cyfers:get-version"),
  checkForUpdates: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("cyfers:check-for-updates"),
  installUpdate: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("cyfers:install-update"),
  onUpdateEvent: (callback: (event: CyfersUpdateEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: CyfersUpdateEvent) => {
      callback(payload);
    };
    ipcRenderer.on("cyfers:update-event", handler);
    return () => {
      ipcRenderer.removeListener("cyfers:update-event", handler);
    };
  },
};

contextBridge.exposeInMainWorld("cyfersDesktop", cyfersDesktop);
