// @ts-check

/** @param {unknown} value @param {string} key @returns {unknown} */
function readOptionalField(value, key) {
  if (value === null || value === undefined) return undefined;
  return Reflect.get(Object(value), key, value);
}

/** @param {unknown} value @returns {Record<PropertyKey, unknown>} */
function spreadEnumerableProperties(value) {
  /** @type {Record<PropertyKey, unknown>} */
  const copy = {};
  if (value === null || value === undefined) return copy;
  const source = Object(value);
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor?.enumerable) {
      Object.defineProperty(copy, key, {
        value: Reflect.get(source, key, source),
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
  }
  return copy;
}

/**
 * Patch the data payload for a queued pool day-use RPC. Persisted queue rows
 * remain unknown until an existing runtime operation narrows them.
 * @param {unknown} queue
 * @param {unknown} id
 * @param {unknown} [update]
 * @returns {{queue: unknown[], updated: boolean}}
 */
export function patchQueuedDayUseEntryPayload(queue = [], id, update = {}) {
  let updated = false;
  const nextQueue = (Array.isArray(queue) ? queue : []).map((/** @type {unknown} */ item) => {
    if (readOptionalField(item, 'type') !== 'rpc' || readOptionalField(item, 'table') !== 'add_pool_day_use') return item;
    const payloadId = String(readOptionalField(readOptionalField(readOptionalField(item, 'data'), 'payload'), 'id') || '').trim();
    if (payloadId !== String(id || '').trim()) return item;
    updated = true;
    return {
      ...spreadEnumerableProperties(item),
      data: {
        ...spreadEnumerableProperties(readOptionalField(item, 'data') || {}),
        payload: {
          ...spreadEnumerableProperties(readOptionalField(readOptionalField(item, 'data'), 'payload') || {}),
          ...spreadEnumerableProperties(update)
        }
      }
    };
  });
  return { queue: nextQueue, updated };
}
