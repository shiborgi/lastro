/**
 * The Brazilian bank calendar. Dates are `YYYY-MM-DD` text and all arithmetic
 * goes through `Date.UTC`, so the host timezone never moves a day.
 *
 * A business day is a weekday that is not a national bank holiday. State and
 * city holidays are deliberately out: acquirers settle on the national one.
 */

const DAY_MS = 86_400_000;

// Fixed national holidays as MM-DD: Confraternização, Tiradentes, Trabalho,
// Independência, Aparecida, Finados, República, Consciência Negra, Natal.
const FIXED_HOLIDAYS = new Set([
  "01-01",
  "04-21",
  "05-01",
  "09-07",
  "10-12",
  "11-02",
  "11-15",
  "11-20",
  "12-25",
]);

// Offsets from Easter: Carnaval Monday and Tuesday, Good Friday, Corpus Christi.
const EASTER_OFFSETS = [-48, -47, -2, 60];

function parse(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError(`invalid date: ${JSON.stringify(date)}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function format(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `date` plus `days` calendar days (negative allowed). */
export function addDays(date: string, days: number): string {
  return format(parse(date) + days * DAY_MS);
}

/** Easter Sunday by the anonymous Gregorian algorithm. */
export function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return format(Date.UTC(year, month - 1, day));
}

function isHoliday(date: string): boolean {
  if (FIXED_HOLIDAYS.has(date.slice(5))) return true;
  const easterDay = easter(Number(date.slice(0, 4)));
  return EASTER_OFFSETS.some((offset) => addDays(easterDay, offset) === date);
}

export function isBusinessDay(date: string): boolean {
  const weekday = new Date(parse(date)).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !isHoliday(date);
}

/** The first business day strictly after `date`. */
export function nextBusinessDay(date: string): string {
  let next = addDays(date, 1);
  while (!isBusinessDay(next)) next = addDays(next, 1);
  return next;
}

/** `date` itself when it is a business day, otherwise the next one. */
export function rollToBusinessDay(date: string): string {
  return isBusinessDay(date) ? date : nextBusinessDay(date);
}
