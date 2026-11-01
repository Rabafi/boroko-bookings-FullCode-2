// GUI previews can outlive their terminal. Handle only disconnected stdio;
// genuine application and I/O errors must keep their normal failure behavior.
const guarded = new WeakSet();

/** @param {Array<{on:(event:string, listener:(error:Error & {code?:string})=>void)=>unknown}>} [streams] */
export function installStdioGuards(streams = [process.stdout, process.stderr]) {
  for (const stream of streams) {
    if (!stream || typeof stream.on !== 'function' || guarded.has(stream)) continue;
    guarded.add(stream);
    stream.on('error', (error) => {
      if (error?.code === 'EPIPE' || error?.code === 'ERR_STREAM_DESTROYED') return;
      throw error;
    });
  }
}

installStdioGuards();
