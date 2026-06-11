export function patchQueuedDayUseEntryPayload(queue = [], id, update = {}) {
  let updated = false;
  const nextQueue = (Array.isArray(queue) ? queue : []).map((item) => {
    if (item?.type !== 'rpc' || item?.table !== 'add_pool_day_use') return item;
    const payloadId = String(item?.data?.payload?.id || '').trim();
    if (payloadId !== String(id || '').trim()) return item;
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
