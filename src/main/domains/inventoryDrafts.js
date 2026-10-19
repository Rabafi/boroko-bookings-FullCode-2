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
 * Patch the nested payload for an inventory draft in a persisted sync queue.
 * Queue rows remain unknown because disk/cache queue parsing is not validation.
 * @param {unknown} queue
 * @param {unknown} id
 * @param {unknown} [update]
 * @returns {{queue: unknown[], updated: boolean}}
 */
export function patchQueuedInventoryDraftPayload(queue = [], id, update = {}) {
  let updated = false;
  const nextQueue = (Array.isArray(queue) ? queue : []).map((/** @type {unknown} */ item) => {
    if (readOptionalField(item, '_queue_id') !== `inventory-item-${id}`) return item;
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

/**
 * Remove an inventory draft from a persisted sync queue without interpreting
 * the shape of unrelated rows.
 * @param {unknown} queue
 * @param {unknown} id
 * @returns {{queue: unknown[], removed: boolean}}
 */
export function removeQueuedInventoryDraft(queue = [], id) {
  const targetQueueId = `inventory-item-${id}`;
  const sourceQueue = Array.isArray(queue) ? queue : [];
  const nextQueue = sourceQueue.filter((/** @type {unknown} */ item) => readOptionalField(item, '_queue_id') !== targetQueueId);
  return {
    queue: nextQueue,
    removed: nextQueue.length !== sourceQueue.length
  };
}
