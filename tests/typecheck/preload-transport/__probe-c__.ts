import { createPreloadTransport } from '../../../src/preload/transport.js';
import type { IpcRenderer } from 'electron';
declare const ipcRenderer: IpcRenderer;
const transport = createPreloadTransport(ipcRenderer);
void transport;
const withImport = process.version;
void withImport;
