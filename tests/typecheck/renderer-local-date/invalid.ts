import { formatLocalDate, parseLocalDateInput } from '../../../src/renderer/src/utils/localDate.js';
formatLocalDate(true);
const parsed = parseLocalDateInput('2026-10-10');
const day = parsed.getDate();
const numeric: number = formatLocalDate(new Date());
const nodeVersion = process.version;
const privileged = window.api;
void day; void numeric; void nodeVersion; void privileged;
