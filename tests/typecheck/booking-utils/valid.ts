import {
  buildWhatsAppUrl,
  sanitizeWebsiteUrl,
  buildCalendarUrl,
  isValidSlug,
  SLUG_REGEX,
} from "../../../booking-site/src/lib/utils.js";

const waDefault: string | null = buildWhatsAppUrl("71234567");
const waUnknown: string | null = buildWhatsAppUrl(71234567);
const waOptions: string | null = buildWhatsAppUrl("71234567", { defaultCountryCode: "267" });
const waOmittedOptions: string | null = buildWhatsAppUrl("71234567", {});
const waNullCountry: string | null = buildWhatsAppUrl("71234567", { defaultCountryCode: null });
const waLower: string = waDefault === null ? "missing" : waDefault.toLowerCase();

const webString: string | null = sanitizeWebsiteUrl("https://example.com");
const webUrl: string | null = sanitizeWebsiteUrl(new URL("https://example.com"));
const webNull: string | null = sanitizeWebsiteUrl(null);
const webOmitted: string | null = sanitizeWebsiteUrl();

const calFull: string | null = buildCalendarUrl({
  check_in: "2026-10-10",
  check_out: "2026-10-12",
  lodge_name: "Test Lodge",
  reference: "ABC123",
  room_number: 7,
});
const calNullDates: string | null = buildCalendarUrl({ check_in: null, check_out: null });
const calMissingDates: string | null = buildCalendarUrl({});
const calUnknownMeta: string | null = buildCalendarUrl({ lodge_name: { nested: true } });

const slugOk: boolean = isValidSlug("my-lodge");
const slugRegex: RegExp = SLUG_REGEX;

// Real browser APIs resolve here (compile only, never navigated/executed).
const anchor: HTMLAnchorElement = document.createElement("a");
const links: NodeListOf<HTMLAnchorElement> = document.querySelectorAll("a");
let linkCount = 0;
for (const el of links) {
  linkCount += el.childElementCount;
}
const currentUrl: URL = new URL(window.location.href);

void waDefault;
void waUnknown;
void waOptions;
void waOmittedOptions;
void waNullCountry;
void waLower;
void webString;
void webUrl;
void webNull;
void webOmitted;
void calFull;
void calNullDates;
void calMissingDates;
void calUnknownMeta;
void slugOk;
void slugRegex;
void anchor;
void linkCount;
void currentUrl;
