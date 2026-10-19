import { buildWhatsAppUrl, buildCalendarUrl, isValidSlug } from '../../../booking-site/src/lib/utils.js';
const url = buildWhatsAppUrl('71234567');
const lower = url.toLowerCase();
buildWhatsAppUrl('71234567', { defaultCountryCode: 267 });
buildCalendarUrl({ check_in: 42 });
const numeric: number = isValidSlug('my-lodge');
const nodeVersion = process.version;
const privileged = window.api;
void lower; void numeric; void nodeVersion; void privileged;
