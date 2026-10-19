import { createPreloadTransport } from '../../../src/preload/transport.js';
import type { IpcRenderer } from 'electron';
declare const ipcRenderer: IpcRenderer;
const transport = createPreloadTransport(ipcRenderer);
const result: Promise<unknown> = transport.invoke('review:probe', null, 2, { x: 1 });
const cleanup: () => unknown = transport.onIpc('review:probe', (value) => { if(typeof value === 'string') value.toUpperCase(); });
const cleanupValue: unknown = cleanup();
const nodeVersion: string = process.versions.node;
const browserDocument: Document = document;
for(const element of document.querySelectorAll('div')) { element.title = 'compile only'; }
void result; void cleanup; void cleanupValue; void nodeVersion; void browserDocument;
