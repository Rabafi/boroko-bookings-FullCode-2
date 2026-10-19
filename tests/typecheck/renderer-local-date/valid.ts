import {
  formatLocalDate,
  localToday,
  localDateStringFromOffset,
  parseLocalDateInput,
} from "../../../src/renderer/src/utils/localDate.js";

const fromDate: string = formatLocalDate(new Date(2026, 9, 10));
const fromString: string = formatLocalDate("2026-10-10");
const fromNumber: string = formatLocalDate(1760054400000);
const omitted: string = formatLocalDate();
const today: string = localToday();
const offsetDefault: string = localDateStringFromOffset();
const offsetDays: string = localDateStringFromOffset(7);
const offsetText: string = localDateStringFromOffset("7");

const maybe: Date | null = parseLocalDateInput("2026-10-10");
const dayOfMonth: number = maybe === null ? -1 : maybe.getDate();

// Typed browser APIs resolve in this DOM scope (compile only, never executed).
const canvas: HTMLCanvasElement = document.createElement("canvas");
const query: MediaQueryList = window.matchMedia("(min-width: 100px)");
const stored: string | null = localStorage.getItem("b02c-probe");
const items: NodeListOf<HTMLDivElement> = document.querySelectorAll("div");
let divCount = 0;
for (const el of items) {
  divCount += el.childElementCount;
}

void fromDate;
void fromString;
void fromNumber;
void omitted;
void today;
void offsetDefault;
void offsetDays;
void offsetText;
void maybe;
void dayOfMonth;
void canvas;
void query;
void stored;
void divCount;
