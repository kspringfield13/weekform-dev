import { generateWeeklyNarrative } from "../../../../packages/inference/src/capacity";

export function getCurrentIsoWeekId(date = new Date()) {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const isoYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((utcDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export function ordinalDay(day: number) {
  const teenRemainder = day % 100;
  if (teenRemainder >= 11 && teenRemainder <= 13) {
    return `${day}th`;
  }

  const suffixes = ["th", "st", "nd", "rd"];
  return `${day}${suffixes[day % 10] ?? "th"}`;
}

export function formatWeekdayMonthDay(date: Date) {
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
  const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(date);

  return `${weekday}, ${month} ${ordinalDay(date.getDate())}`;
}

export function getBusinessWeekRangeLabel(date = new Date()) {
  const monday = new Date(date);
  const day = monday.getDay() || 7;
  monday.setHours(12, 0, 0, 0);
  monday.setDate(monday.getDate() + 1 - day);

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  return `${formatWeekdayMonthDay(monday)} - ${formatWeekdayMonthDay(friday)}`;
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function replaceIsoWeekIds(value: string, weekRangeLabel: string) {
  return value.replace(/\b\d{4}-W\d{2}\b/g, weekRangeLabel);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Headlines already sit beneath a weekly page label and persistent date range,
 * so repeating the full range makes the hierarchy noisy. Older generated
 * narratives may still contain it; keep those readable without mutating the
 * persisted record.
 */
export function removeWeekRangeFromHeadline(value: string, weekRangeLabel: string) {
  const displayValue = replaceIsoWeekIds(value, weekRangeLabel).trim();
  const escapedRange = escapeRegExp(weekRangeLabel);
  const leadingRange = new RegExp(`^${escapedRange}\\s*(?::|[–—])\\s*`, "i");
  const withoutLeadingRange = displayValue.replace(leadingRange, "");
  const withoutRepeatedRange = withoutLeadingRange === displayValue
    ? displayValue.replace(new RegExp(escapedRange, "gi"), "the week")
    : withoutLeadingRange;

  return withoutRepeatedRange
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function displaySafeNarrative(
  narrative: ReturnType<typeof generateWeeklyNarrative>,
  weekRangeLabel: string
): ReturnType<typeof generateWeeklyNarrative> {
  return {
    ...narrative,
    headline: removeWeekRangeFromHeadline(narrative.headline, weekRangeLabel),
    summary_text: replaceIsoWeekIds(narrative.summary_text, weekRangeLabel),
    key_drivers: narrative.key_drivers.map((driver) => replaceIsoWeekIds(driver, weekRangeLabel)),
    manager_ready_summary: replaceIsoWeekIds(narrative.manager_ready_summary, weekRangeLabel)
  };
}
