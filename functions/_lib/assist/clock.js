// Melbourne wall-clock "HH:MM" from a UTC millisecond count, by arithmetic. It replaces a module-level
// Intl.DateTimeFormat({ timeZone: 'Australia/Melbourne' }): building that formatter loads the ICU zone data, which the S6 profile put at
// about 12 ms of CPU whenever an isolate starts, and the formatter's first format() call costs more. This does the same job with no Intl.
//
// Rule (Victoria, in force since 2008): daylight time (UTC+11) runs from 2:00 standard time on the first Sunday of October to 3:00
// daylight time on the first Sunday of April; the rest of the year is UTC+10. Both changes happen at 16:00 UTC on the Saturday before.
// checks/runtime/gm-assist-cpu.test.mjs compares it with Intl around every daylight-saving change and on 40,000 random instants, 2008-2060.

const H = 3600000, DAY = 86400000;

// UTC ms of 16:00 UTC on the day before the first Sunday of `month` (0-based) in `year`.
function changeAt(year, month) {
  const first = Date.UTC(year, month, 1);
  const dow = new Date(first).getUTCDay();             // 0 = Sunday
  const firstSunday = first + ((7 - dow) % 7) * DAY;
  return firstSunday - 8 * H;                          // Sunday 00:00 UTC minus 8 h = Saturday 16:00 UTC
}

/** The UTC offset in hours for the instant: 11 in daylight time, 10 otherwise. */
export function melbourneOffsetHours(ms) {
  const year = new Date(ms + 10 * H).getUTCFullYear();  // the local (standard-time) year; the changes are far from New Year
  return ms >= changeAt(year, 9) || ms < changeAt(year, 3) ? 11 : 10;
}

/** "HH:MM" (24-hour, "00:" for the hour after midnight) in Melbourne. */
export function melbourneHHMM(ms) {
  const d = new Date(ms + melbourneOffsetHours(ms) * H);
  return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}
