export function patchQueuedInventoryDraftPayload(queue = [], id, update = {}) {
  let updated = false;
  const nextQueue = (Array.isArray(queue) ? queue : []).map((item) => {
    if (item?._queue_id !== `inventory-item-${id}`) return item;
    updated = true;
    return {
      ...item,
      data: {
        ...(item.data || {}),
        payload: {
          ...(item.data?.payload || {}),
          ...update
        }
      }
    };
  });
  return { queue: nextQueue, updated };
}

export function removeQueuedInventoryDraft(queue = [], id) {
  const targetQueueId = `inventory-item-${id}`;
  const sourceQueue = Array.isArray(queue) ? queue : [];
  const nextQueue = sourceQueue.filter((item) => item?._queue_id !== targetQueueId);
  return {
    queue: nextQueue,
    removed: nextQueue.length !== sourceQueue.length
  };
}
