// Minimal Electron stub for node:test behavioral tests of main-process code.
// Only covers what the domain import chain touches; any real Electron
// behavior (IPC, storage encryption, windows) is out of scope here.
import os from 'node:os';
import path from 'node:path';

const userDataDir = path.join(os.tmpdir(), 'tsa-bonno-electron-stub');

export const app = {
  getPath: (name) => (name === 'userData' ? userDataDir : os.tmpdir()),
  getVersion: () => '0.0.0-test',
  getName: () => 'test',
};

export const BrowserWindow = { fromWebContents: () => null };
export const ipcMain = { handle: () => {} };
export const ipcRenderer = { invoke: async () => null, on: () => {}, off: () => {} };
export const contextBridge = { exposeInMainWorld: () => {} };
export const webUtils = {};
export const dialog = { showSaveDialog: async () => ({ canceled: true }) };
export const shell = { openPath: async () => '' };
export const clipboard = { writeText: () => {} };
export const session = { defaultSession: null };
export const nativeImage = { createFromPath: () => ({ isEmpty: () => true }) };
export const Menu = { setApplicationMenu: () => {} };
export const Tray = function Tray() {};
export const Notification = function Notification() {};
export const powerMonitor = { on: () => {} };
export const screen = { getPrimaryDisplay: () => ({ workAreaSize: { width: 0, height: 0 } }) };
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: () => { throw new Error('stub: encryption unavailable'); },
  decryptString: () => { throw new Error('stub: encryption unavailable'); },
};

const api = {
  app, BrowserWindow, ipcMain, ipcRenderer, contextBridge, webUtils, dialog,
  shell, clipboard, session, nativeImage, Menu, Tray, Notification,
  powerMonitor, screen, safeStorage,
};
export default api;
