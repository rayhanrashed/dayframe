import { CalendarBlock } from "./types";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatIcsLocalDateTime(baseDate: Date, dayOffset: number, minutesFromMidnight: number): string {
  const d = new Date(baseDate);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + dayOffset);
  const hours = Math.floor(minutesFromMidnight / 60);
  const minutes = minutesFromMidnight % 60;
  d.setHours(hours, minutes, 0, 0);

  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}00`
  );
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export function buildIcsForBlocks(blocks: CalendarBlock[], baseDate: Date = new Date()): string {
  const stamp = formatIcsLocalDateTime(new Date(), 0, 540) + "Z";
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Dayframe//Local AI MacBook Organizer//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const block of blocks) {
    const dtStart = formatIcsLocalDateTime(baseDate, block.dayOffset, block.startMinutes);
    const dtEnd = formatIcsLocalDateTime(
      baseDate,
      block.dayOffset,
      block.startMinutes + block.durationMinutes
    );
    const prefix =
      block.kind === "prep"
        ? "[Prep] "
        : block.isSoloHold
          ? "[Hold] "
          : block.kind === "deep-work"
            ? "[Focus] "
            : "";

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${block.id}@dayframe.local`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${dtStart}`);
    lines.push(`DTEND:${dtEnd}`);
    lines.push(`SUMMARY:${escapeIcsText(prefix + block.title)}`);
    lines.push(
      `DESCRIPTION:${escapeIcsText(
        `${block.rationale}${block.sourceLabel ? `\nSource: ${block.sourceLabel}` : ""}`
      )}`
    );
    if (block.locationOrUrl) {
      lines.push(`LOCATION:${escapeIcsText(block.locationOrUrl)}`);
    }
    if (block.isRecurring && block.kind === "meeting") {
      lines.push("RRULE:FREQ=WEEKLY");
    }
    lines.push("STATUS:CONFIRMED");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function triggerIcsDownload(filename: string, icsContent: string): void {
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Lightweight RFC 5545 VEVENT parser so users can import their real Apple/Google Calendar .ics file
 * and let Dayframe find open availability + auto-attach recurring meeting prep blocks.
 */
export function parseImportedIcs(icsText: string, referenceDate: Date = new Date()): CalendarBlock[] {
  const unfolded = icsText.replace(/\r?\n[ \t]/g, "");
  const rawEvents = unfolded.split("BEGIN:VEVENT").slice(1);
  const refStart = new Date(referenceDate);
  refStart.setHours(0, 0, 0, 0);

  const imported: CalendarBlock[] = [];

  for (let i = 0; i < rawEvents.length; i++) {
    const chunk = rawEvents[i].split("END:VEVENT")[0] ?? "";
    const lines = chunk.split(/\r?\n/);

    let summary = "Calendar Event";
    let dtStartRaw = "";
    let dtEndRaw = "";
    let location = "";
    let hasRrule = false;

    for (const line of lines) {
      if (line.startsWith("SUMMARY")) {
        summary = line.split(":").slice(1).join(":").trim() || summary;
      } else if (line.startsWith("DTSTART")) {
        dtStartRaw = line.split(":").slice(1).join(":").trim();
      } else if (line.startsWith("DTEND")) {
        dtEndRaw = line.split(":").slice(1).join(":").trim();
      } else if (line.startsWith("LOCATION")) {
        location = line.split(":").slice(1).join(":").trim();
      } else if (line.startsWith("RRULE")) {
        hasRrule = true;
      }
    }

    const parsedStart = parseIcsTimestamp(dtStartRaw);
    const parsedEnd = parseIcsTimestamp(dtEndRaw);
    if (!parsedStart) continue;

    const eventDay = new Date(parsedStart);
    eventDay.setHours(0, 0, 0, 0);
    let dayOffset = Math.round(
      (eventDay.getTime() - refStart.getTime()) / (1000 * 60 * 60 * 24)
    );

    // If an imported recurring event started in the past, project it onto Today or Tomorrow if weekday matches
    if (hasRrule && (dayOffset < 0 || dayOffset > 1)) {
      if (parsedStart.getDay() === refStart.getDay()) {
        dayOffset = 0;
      } else {
        const tomorrow = new Date(refStart);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (parsedStart.getDay() === tomorrow.getDay()) {
          dayOffset = 1;
        }
      }
    }

    if (dayOffset < 0 || dayOffset > 1) continue;

    const startMinutes = parsedStart.getHours() * 60 + parsedStart.getMinutes();
    const rawDuration = parsedEnd
      ? Math.round((parsedEnd.getTime() - parsedStart.getTime()) / 60000)
      : 60;
    const durationMinutes = Math.max(15, Math.min(240, Math.round(rawDuration / 15) * 15));

    imported.push({
      id: `ics-import-${Date.now()}-${i}`,
      title: summary.replace(/\\,/g, ",").replace(/\\;/g, ";"),
      kind: "meeting",
      status: "confirmed",
      dayOffset,
      startMinutes,
      durationMinutes,
      isRecurring: hasRrule,
      locationOrUrl: location || undefined,
      sourceLabel: "Imported .ics Calendar",
      rationale: hasRrule
        ? "Imported recurring calendar event — eligible for automatic prep-time rules."
        : "Imported busy block from your calendar.",
      confidence: 1,
    });
  }

  return imported;
}

function parseIcsTimestamp(raw: string): Date | null {
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!match) return null;
  const [, y, m, d, hh = "09", mm = "00", ss = "00", z] = match;
  if (z === "Z") {
    return new Date(
      Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss))
    );
  }
  return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
}
