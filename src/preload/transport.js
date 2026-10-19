// @ts-check
/**
 * @typedef {Object} IpcRendererPort
 * @property {(channel: string, ...args: unknown[]) => Promise<unknown>} invoke
 * @property {(channel: string, listener: (event: unknown, value: unknown) => unknown) => unknown} on
 * @property {(channel: string, listener: (event: unknown, value: unknown) => unknown) => unknown} off
 */
/** @param {IpcRendererPort} ipcRenderer */
export function createPreloadTransport(ipcRenderer) {
  /** @param {string} channel @param {...unknown} args @returns {Promise<unknown>} */
  const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)
  /** @param {string} channel @param {(value: unknown) => unknown} cb @returns {() => unknown} */
  const onIpc = (channel, cb) => {
    /** @param {unknown} _ @param {unknown} value */
    const listener = (_, value) => cb(value)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.off(channel, listener)
  }
  return { invoke, onIpc }
}
