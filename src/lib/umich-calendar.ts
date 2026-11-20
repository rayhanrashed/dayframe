import { MacCalendarDescriptor } from "./types";

const UMICH_MARK = /umich\.edu|@umich|\bumich\b|university of michigan/i;
const NOISY_CALENDAR_MARK =
  /birthday|holiday|contacts|subscribed|weather|us holidays|anniversar|siri|found in|room|resource/i;

export function isPersonalUmichCalendar(
  title: string,
  sourceTitle: string
): boolean {
  const blob = `${title} ${sourceTitle}`;
  if (NOISY_CALENDAR_MARK.test(blob)) return false;
  return UMICH_MARK.test(blob);
}

export function pickPersonalUmichCalendar(
  calendars: MacCalendarDescriptor[]
): MacCalendarDescriptor | null {
  const hits = calendars.filter(
    (c) =>
      c.allowsModify && isPersonalUmichCalendar(c.title, c.sourceTitle)
  );
  if (hits.length === 0) return null;
  hits.sort((a, b) => score(b) - score(a));
  return hits[0];
}

/**
 * Default "Read / Take From" calendar selection on first connection:
 * If a personal UMich calendar exists, read ONLY from that personal UMich calendar by default
 * so shared lab/holiday/personal clutter doesn't flood the schedule until the user checks them!
 */
export function pickDefaultReadCalendarIds(
  calendars: MacCalendarDescriptor[],
  writeCalendarId?: string
): string[] {
  if (writeCalendarId && calendars.some((c) => c.id === writeCalendarId)) {
    return [writeCalendarId];
  }
  const umich = pickPersonalUmichCalendar(calendars);
  if (umich) {
    return [umich.id];
  }
  const cleanWritable = calendars.filter(
    (c) => c.allowsModify && !NOISY_CALENDAR_MARK.test(`${c.title} ${c.sourceTitle}`)
  );
  if (cleanWritable.length > 0) {
    return [cleanWritable[0].id];
  }
  return calendars.slice(0, 1).map((c) => c.id);
}

function score(cal: MacCalendarDescriptor): number {
  const blob = `${cal.title} ${cal.sourceTitle}`.toLowerCase();
  let value = 0;
  if (blob.includes("umich.edu")) value += 20;
  if (blob.includes("umich")) value += 8;
  if (/@/.test(cal.title)) value += 6;
  if (/personal|rayhan|rayrash/i.test(blob)) value += 8;
  if (/shared|lab|group|team|seminar|course|class/i.test(blob)) value -= 10;
  if (cal.isDefault) value += 1;
  return value;
}

export function describeCalendar(cal: {
  title: string;
  sourceTitle?: string;
}): string {
  const source = cal.sourceTitle?.trim();
  if (!source || source.toLowerCase() === cal.title.toLowerCase()) {
    return cal.title;
  }
  return `${cal.title} · ${source}`;
}
