// @ts-check
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const JOURNAL_FILE = 'financial-operations.ndjson';

/**
 * JSONL events are parsed without runtime validation; leaf values stay unknown.
 * The queue item and patch are expected object views for the existing journal
 * producer, not guarantees about malformed persisted lines.
 * @typedef {{event_type?: unknown, queue_item_id?: unknown, queue_item?: unknown, patch?: unknown, journal_event_id?: unknown, recorded_at?: unknown}} FinancialJournalLineExpectedView
 * @typedef {{event_type?: unknown, queue_item_id?: unknown, queue_item?: unknown, patch?: unknown, journal_event_id?: unknown, recorded_at?: unknown}} FinancialJournalAppendEventExpectedData
 * @typedef {Record<string, unknown>} FinancialJournalQueueItemExpectedView
 */

/** @param {string} cacheDir @returns {string} */
function journalPath(cacheDir) {
  if (!cacheDir) throw new Error('POS cache directory is not initialized');
  const dir = path.join(cacheDir, 'journal');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, JOURNAL_FILE);
}

/** @param {string} cacheDir @returns {FinancialJournalLineExpectedView[]} */
export function readFinancialJournal(cacheDir) {
  const filePath = journalPath(cacheDir);
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.map((line, index) => {
    try {
      return /** @type {FinancialJournalLineExpectedView} */ (JSON.parse(line));
    } catch {
      throw new Error(`Financial journal is corrupt at line ${index + 1}`);
    }
  });
}

/** @param {string} cacheDir @param {FinancialJournalAppendEventExpectedData} [event] */
export function appendFinancialJournalEvent(cacheDir, event = {}) {
  const record = {
    journal_event_id: event.journal_event_id || randomUUID(),
    recorded_at: event.recorded_at || new Date().toISOString(),
    ...event
  };
  const filePath = journalPath(cacheDir);
  const fd = fs.openSync(filePath, 'a');
  try {
    fs.writeSync(fd, `${JSON.stringify(record)}\n`, null, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  const rows = readFinancialJournal(cacheDir);
  const verified = rows[rows.length - 1];
  if (verified?.journal_event_id !== record.journal_event_id) {
    throw new Error('Financial journal append verification failed');
  }
  return record;
}

/** @param {string} cacheDir @returns {FinancialJournalQueueItemExpectedView[]} */
export function rebuildFinancialQueueFromJournal(cacheDir) {
  const rows = readFinancialJournal(cacheDir);
  /** @type {Map<unknown, FinancialJournalQueueItemExpectedView>} */
  const operations = new Map();
  for (const event of rows) {
    if (!event?.queue_item_id) continue;
    if (event.event_type === 'queue_operation' && event.queue_item) {
      // The concrete producer journals queued records as objects; persisted
      // JSON is not validated and the original truthiness guard stays in force.
      operations.set(event.queue_item_id, /** @type {FinancialJournalQueueItemExpectedView} */ (event.queue_item));
    } else if (event.event_type === 'queue_state' && operations.has(event.queue_item_id)) {
      operations.set(event.queue_item_id, {
        .../** @type {FinancialJournalQueueItemExpectedView | undefined} */ (operations.get(event.queue_item_id)),
        .../** @type {Record<string, unknown>} */ (event.patch || {})
      });
    }
  }
  return [...operations.values()].filter((item) => item?.status !== 'synced');
}
