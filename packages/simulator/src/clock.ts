import type { SimulationConfig } from "./types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isDateKey(value: string) {
  return DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function isWallTime(value: string) {
  return TIME_PATTERN.test(value);
}

export function isIanaTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function addDays(dateKey: string, amount: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function addMonths(dateKey: string, amount: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + amount, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function simulationEndDate(config: SimulationConfig): string {
  if (config.span.unit === "weeks") return addDays(config.startDate, config.span.value * 7);
  if (config.span.unit === "months") return addMonths(config.startDate, config.span.value);
  return addMonths(config.startDate, config.span.value * 12);
}

export function simulationWeekStarts(config: SimulationConfig): string[] {
  const end = simulationEndDate(config);
  const weeks: string[] = [];
  for (let date = config.startDate; date < end; date = addDays(date, 7)) weeks.push(date);
  return weeks;
}

export function isoWeekId(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const year = date.getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((date.getTime() - start.getTime()) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function isoWeekday(dateKey: string): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  return (new Date(`${dateKey}T00:00:00Z`).getUTCDay() || 7) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

/** Convert a wall-clock time in an IANA zone to an unambiguous UTC ISO instant. */
export function zonedDateTimeToIso(dateKey: string, wallTime: string, timezone: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = wallTime.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = desired;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const values = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
    );
    const observed = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    );
    const delta = desired - observed;
    guess += delta;
    if (delta === 0) break;
  }
  return new Date(guess).toISOString();
}

export function addMinutesToWallTime(wallTime: string, minutes: number): string {
  const [hour, minute] = wallTime.split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
