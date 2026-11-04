/**
 * Calendar dates in this app are **local**, not UTC.
 *
 * `new Date().toISOString().slice(0, 10)` looks like a tidy way to get `YYYY-MM-DD`, but
 * it converts to UTC first. Anywhere west of Greenwich that rolls the date over early in
 * the evening — 8pm in New York is already tomorrow in UTC — so the app would label
 * today's figures with tomorrow's date. East of Greenwich it can report yesterday.
 * Everything here works off the local calendar fields instead.
 */
const pad = (value: number) => String(value).padStart(2, "0");

/** Local `YYYY-MM-DD` for a Date. */
export const isoDate = (value: Date) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;

/** Today's local calendar date as `YYYY-MM-DD`. */
export const todayIso = () => isoDate(new Date());

/** Parses a `YYYY-MM-DD` as local midnight. Plain `new Date("2026-09-22")` parses as UTC. */
export const parseIso = (date: string) => new Date(`${date}T00:00:00`);
