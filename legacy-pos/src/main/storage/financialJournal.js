import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const JOURNAL_FILE = 'financial-operations.ndjson';

function journalPath(cacheDir) {
  if (!cacheDir) throw new Error('POS cache directory is not initialized');
  const dir = path.join(cacheDir, 'journal');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, JOURNAL_FILE);
}

export function readFinancialJournal(cacheDir) {
  const filePath = journalPath(cacheDir);
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Financial journal is corrupt at line ${index + 1}`);
    }
  });
}

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

export function rebuildFinancialQueueFromJournal(cacheDir) {
  const rows = readFinancialJournal(cacheDir);
  const operations = new Map();
  for (const event of rows) {
    if (!event?.queue_item_id) continue;
    if (event.event_type === 'queue_operation' && event.queue_item) {
      operations.set(event.queue_item_id, event.queue_item);
    } else if (event.event_type === 'queue_state' && operations.has(event.queue_item_id)) {
      operations.set(event.queue_item_id, {
        ...operations.get(event.queue_item_id),
        ...(event.patch || {})
      });
    }
  }
  return [...operations.values()].filter((item) => item?.status !== 'synced');
}
