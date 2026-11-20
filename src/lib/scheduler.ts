import {
  CalendarBlock,
  ExtractedCaptureSignal,
  OrganizerSettings,
  ScreenshotCapture,
  StandingRule,
  SuggestedPreferencePrompt,
} from "./types";
import { toLocalDateKey } from "./calendar-connectors";

export const DEFAULT_ORGANIZER_SETTINGS: OrganizerSettings = {
  setupCompleted: false,
  gemmaModel: "gemma4:e4b",
  valenEnabled: true,
  valenModelId: "valen-9b",
  valenPort: 43823,
  valenSignalThreshold: 0.45,
  batchExecutionMode: "scheduled-batches",
  batchWindowMinutes: [9 * 60 + 30, 13 * 60 + 30, 17 * 60 + 30],
  unloadModelsAfterBatch: true,
  confirmationPolicy: "ask-often",
  calendarSource: "none",
  captureEngine: "macos-native",
  readCalendarIds: [],
  readCalendarScopeInitialized: false,
  writableCalendarId: "",
  writableCalendarTitle: "UMich calendar not selected",
  writableCalendarSource: "",
  pinnedWriteCalendar: false,
  calibrationMultiplier: 1.5,
  dailyBufferMinutes: 60,
  protectWeekends: true,
  notAMorningPersonUntilMinutes: 0,
  busyDateRanges: [],
  timelineHorizonDays: 7,
  autoWriteToCalendar: true,
  intervalMinutes: 5,
  skipDuplicateFrames: true,
  workdayStartMinutes: 9 * 60,
  workdayEndMinutes: 18 * 60,
  minGapBetweenBlocksMinutes: 15,
  nightlyAndroidSyncHour: 23,
};

export const BATCH_SCHEDULE_PRESETS: Array<{
  id: string;
  label: string;
  note: string;
  windows: number[];
}> = [
  {
    id: "3x",
    label: "3x / day (9:30 AM, 1:30 PM, 5:30 PM)",
    note: "Recommended • Models sleep 99% of the day at 0 MB RAM",
    windows: [9 * 60 + 30, 13 * 60 + 30, 17 * 60 + 30],
  },
  {
    id: "2x",
    label: "2x / day (12:00 PM, 5:30 PM)",
    note: "Midday + End-of-day sweep",
    windows: [12 * 60, 17 * 60 + 30],
  },
  {
    id: "4x",
    label: "4x / day (9:00 AM, 12:30 PM, 3:30 PM, 6:30 PM)",
    note: "Frequent check-ins • Still 0 MB RAM between sweeps",
    windows: [9 * 60, 12 * 60 + 30, 15 * 60 + 30, 18 * 60 + 30],
  },
];

export const DEFAULT_STANDING_RULES: StandingRule[] = [
  {
    id: "rule-recurring-prep-2h",
    title: "≥2h runway before real meetings that need prep",
    description:
      "When Gemma 4 sees a multi-person meeting, presentation, review, or call that genuinely requires preparation (never chores, workouts, meals, or solo reminders), finish prep at least 2 hours ahead.",
    category: "prep-time",
    enabled: true,
    appliesToRecurring: true,
    prepDurationMinutes: 45,
    minLeadMinutesBeforeMeeting: 120,
  },
  {
    id: "rule-solo-holds",
    title: "Solo calendar holds from Slack & email mentions",
    description:
      "When a Slack message or email mentions a meeting time without a formal invite, propose a personal hold in an open slot and ask before adding.",
    category: "solo-invite",
    enabled: true,
  },
  {
    id: "rule-midday-lunch",
    title: "Protect 12:00 PM – 1:00 PM midday break",
    description:
      "Keep midday clear when slotting focus blocks and prep windows.",
    category: "availability",
    enabled: true,
    protectedWindow: {
      startMinutes: 12 * 60,
      endMinutes: 13 * 60,
      label: "Midday Break",
    },
  },
];

export const DEFAULT_SUGGESTED_QUESTIONS: SuggestedPreferencePrompt[] = [
  {
    id: "q-morning-deep-work",
    question:
      "Want mornings (9:00 AM – 11:30 AM) protected exclusively for deep work and meeting prep?",
    whyItMatters:
      "Routes shorter 15–30m Slack/email follow-up replies to afternoon gaps instead of fragmenting your morning.",
    acceptLabel: "Protect morning focus",
    ruleToCreate: {
      title: "Morning deep-work protection (replies in afternoon)",
      description:
        "Prefer afternoon windows for ≤30m follow-ups so mornings stay open for ≥45m focus and prep.",
      category: "availability",
      enabled: true,
    },
  },
  {
    id: "q-evening-cutoff",
    question:
      "Set a 5:30 PM cutoff so late-afternoon Slack/email tasks roll into tomorrow morning?",
    whyItMatters: "Prevents late messages from booking your evening.",
    acceptLabel: "Add 5:30 PM cutoff",
    ruleToCreate: {
      title: "Hard stop after 5:30 PM",
      description:
        "Keep 5:30 PM – 6:00 PM unbooked and schedule overflow work onto the next day.",
      category: "availability",
      enabled: true,
      protectedWindow: {
        startMinutes: 17 * 60 + 30,
        endMinutes: 18 * 60,
        label: "Evening Wind-Down",
      },
    },
  },
];

const CHORE_OR_PERSONAL_ROUTINE_REGEX =
  /\b(clean|cleaning|toilet|bathroom|restroom|kitchen|laundry|dishes|dish|trash|garbage|recycle|vacuum|mop|sweep|chore|chores|grocery|groceries|shopping|errand|errands|cook|cooking|breakfast|lunch|dinner|supper|meal|eat|coffee\s+break|gym|workout|exercise|jog|jogging|yoga|pilates|swim|walk\s+dog|dog\s+walk|feed\s+dog|feed\s+cat|litter|shower|bath|sleep|nap|bedtime|wake\s+up|vitamin|vitamins|pill|medication|meds|commute|drive\s+home|drive\s+to|haircut|barber|dentist|orthodontist|doctor|physical\s+therapy|massage|pay\s+rent|pay\s+bill|water\s+plants|focus\s+time|deep\s+work|heads\s+down|no\s+meetings|do\s+not\s+book|dnb|ooo|out\s+of\s+office|pto|vacation|holiday|birthday|anniversary|standup|daily\s+stand-?up|scrum)\b/i;

const EXPLICIT_EXTERNAL_MEETING_TITLE_REGEX =
  /\b(1:1|1-1|one-on-one|interview|presentation|pitch|defense|committee|board|client|customer|advisor|professor|prof\.|review\s+with|sync\s+with|call\s+with|meeting\s+with|chat\s+with|demo|panel|seminar|colloquium|lecture)\b/i;

/**
 * Hard sanity filter: returns true ONLY when a calendar event is an actual
 * interpersonal / external meeting or talk that could plausibly need advance preparation.
 * Personal chores ("Cleaning toilet"), solo routines, 0-attendee personal reminders,
 * immutable holiday/birthday feeds, and Dayframe's own blocks ALWAYS return false.
 */
export function isEligibleRealMeetingForPrep(block: CalendarBlock): boolean {
  if (block.kind !== "meeting") return false;
  if (block.occupiesTimeOnly) return false;
  if (block.isDayframeCreated) return false;
  if (block.calendarImmutable) return false;

  const calName = (block.calendarTitle || "").toLowerCase();
  if (
    /birthday|holiday|reminder|chore|habit|routine|fitness|workout|meal|family\s+chores/i.test(
      calName
    )
  ) {
    return false;
  }

  const title = block.title.trim();
  if (!title) return false;
  if (
    title.startsWith("[Prep]") ||
    title.startsWith("[Focus]") ||
    title.startsWith("[Solo Hold]")
  ) {
    return false;
  }

  // Personal chores, meals, workouts, errands, daily standups NEVER need prep blocks
  if (CHORE_OR_PERSONAL_ROUTINE_REGEX.test(title)) {
    return false;
  }

  const attendees = block.attendeeCount ?? 0;
  const hasVideo = Boolean(block.hasVideoLink);

  // A 0-attendee event with no video call link is almost always a personal reminder/task/routine
  // that is ALREADY blocked on the user's calendar — unless the title explicitly names an external meeting/talk.
  if (
    attendees === 0 &&
    !hasVideo &&
    !EXPLICIT_EXTERNAL_MEETING_TITLE_REGEX.test(title)
  ) {
    return false;
  }

  return true;
}

export function formatMinutesToTime(totalMinutes: number): string {
  const clamped = ((totalMinutes % 1440) + 1440) % 1440;
  const hours24 = Math.floor(clamped / 60);
  const mins = clamped % 60;
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(mins).padStart(2, "0")} ${period}`;
}

export function getNextScheduledBatchLabel(
  batchWindowMinutes: number[],
  now: Date = new Date()
): string {
  if (!batchWindowMinutes || batchWindowMinutes.length === 0) {
    return "Manual batch only";
  }
  const sorted = [...batchWindowMinutes].sort((a, b) => a - b);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const nextToday = sorted.find((m) => m > nowMins);
  if (nextToday !== undefined) {
    return `Today ${formatMinutesToTime(nextToday)}`;
  }
  return `Tomorrow ${formatMinutesToTime(sorted[0])}`;
}

export function formatDuration(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

export function addDaysToDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
  dt.setDate(dt.getDate() + deltaDays);
  return toLocalDateKey(dt);
}

export function formatDateKeyLabel(dateKey: string, todayKey: string): string {
  const tomorrowKey = addDaysToDateKey(todayKey, 1);
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
  const shortFmt = dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  if (dateKey === todayKey) return `Today (${shortFmt})`;
  if (dateKey === tomorrowKey) return `Tomorrow (${shortFmt})`;
  return shortFmt;
}

function roundTo15(mins: number): number {
  return Math.max(15, Math.round(mins / 15) * 15);
}

function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function matchesRulePattern(text: string, pattern?: string): boolean {
  if (!pattern) return false;
  try {
    return new RegExp(pattern, "i").test(text);
  } catch {
    return text.toLowerCase().includes(pattern.toLowerCase());
  }
}

export function getProtectedIntervals(
  rules: StandingRule[]
): Array<{ startMinutes: number; endMinutes: number; label: string }> {
  return rules
    .filter(
      (r) => r.enabled && r.category === "availability" && r.protectedWindow
    )
    .map((r) => r.protectedWindow!);
}

export function summarizeOpenWindowsForDay(params: {
  dateKey: string;
  blocks: CalendarBlock[];
  rules: StandingRule[];
  settings: OrganizerSettings;
}): string {
  const { dateKey, blocks, rules, settings } = params;
  const dayBlocks = blocks.filter((b) => b.dateKey === dateKey);
  const protectedWins = getProtectedIntervals(rules);
  const freeRanges: Array<{ start: number; end: number }> = [];

  let cursor = settings.workdayStartMinutes;
  while (cursor + 15 <= settings.workdayEndMinutes) {
    const busy =
      dayBlocks.some((b) =>
        intervalsOverlap(
          cursor,
          cursor + 15,
          b.startMinutes,
          b.startMinutes + b.durationMinutes
        )
      ) ||
      protectedWins.some((pw) =>
        intervalsOverlap(cursor, cursor + 15, pw.startMinutes, pw.endMinutes)
      );

    if (!busy) {
      const last = freeRanges[freeRanges.length - 1];
      if (last && last.end === cursor) {
        last.end = cursor + 15;
      } else {
        freeRanges.push({ start: cursor, end: cursor + 15 });
      }
    }
    cursor += 15;
  }

  const meaningful = freeRanges.filter((r) => r.end - r.start >= 30);
  if (meaningful.length === 0) return "No >=30m free slots";
  return meaningful
    .map(
      (r) => `${formatMinutesToTime(r.start)}-${formatMinutesToTime(r.end)}`
    )
    .join(", ");
}

export function isWeekendDateKey(dateKey: string): boolean {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
  const dow = dt.getDay();
  return dow === 0 || dow === 6;
}

export function getBusyRangeForDate(
  dateKey: string,
  settings: OrganizerSettings
): { label: string; startDateKey: string; endDateKey: string } | null {
  for (const r of settings.busyDateRanges ?? []) {
    if (dateKey >= r.startDateKey && dateKey <= r.endDateKey) {
      return r;
    }
  }
  return null;
}

interface SlotQuery {
  dateKey: string;
  durationMinutes: number;
  blocks: CalendarBlock[];
  rules: StandingRule[];
  settings: OrganizerSettings;
  preferLatestBeforeMinutes?: number;
  mustFinishByMinutes?: number;
  preferAfternoon?: boolean;
  ignoreGap?: boolean;
  allowWeekend?: boolean;
  ignoreBlackout?: boolean;
  ignoreDailyBuffer?: boolean;
  allowEarlyMorning?: boolean;
}

export function findOpenSlot({
  dateKey,
  durationMinutes,
  blocks,
  rules,
  settings,
  preferLatestBeforeMinutes,
  mustFinishByMinutes,
  preferAfternoon = false,
  ignoreGap = false,
  allowWeekend = false,
  ignoreBlackout = false,
  ignoreDailyBuffer = false,
  allowEarlyMorning = false,
}: SlotQuery): number | null {
  if (!ignoreBlackout && getBusyRangeForDate(dateKey, settings)) {
    return null;
  }
  if (!allowWeekend && settings.protectWeekends && isWeekendDateKey(dateKey)) {
    return null;
  }

  const now = new Date();
  const realTodayKey = toLocalDateKey(now);
  if (dateKey < realTodayKey) {
    return null;
  }

  let dayStart = settings.workdayStartMinutes;
  if (!allowEarlyMorning && settings.notAMorningPersonUntilMinutes > dayStart) {
    dayStart = settings.notAMorningPersonUntilMinutes;
  }
  if (dateKey === realTodayKey) {
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const roundedNow = Math.ceil((nowMins + 10) / 15) * 15;
    dayStart = Math.max(dayStart, roundedNow);
  }

  const bufferedWorkdayEnd = ignoreDailyBuffer
    ? settings.workdayEndMinutes
    : Math.max(
        dayStart,
        settings.workdayEndMinutes - Math.max(0, settings.dailyBufferMinutes || 0)
      );

  const dayEnd = mustFinishByMinutes
    ? Math.min(bufferedWorkdayEnd, mustFinishByMinutes)
    : bufferedWorkdayEnd;

  if (dayEnd - dayStart < durationMinutes) return null;

  const gap = ignoreGap ? 0 : settings.minGapBetweenBlocksMinutes;
  const dayBlocks = blocks.filter((b) => b.dateKey === dateKey);
  const protectedWindows = getProtectedIntervals(rules);

  const candidates: number[] = [];
  for (let start = dayStart; start + durationMinutes <= dayEnd; start += 15) {
    const end = start + durationMinutes;

    const hitsBlock = dayBlocks.some((b) =>
      intervalsOverlap(
        start,
        end,
        b.startMinutes - gap,
        b.startMinutes + b.durationMinutes + gap
      )
    );
    if (hitsBlock) continue;

    const hitsProtected = protectedWindows.some((pw) =>
      intervalsOverlap(start, end, pw.startMinutes, pw.endMinutes)
    );
    if (hitsProtected) continue;

    candidates.push(start);
  }

  if (candidates.length === 0 && !ignoreGap && gap > 0) {
    return findOpenSlot({
      dateKey,
      durationMinutes,
      blocks,
      rules,
      settings,
      preferLatestBeforeMinutes,
      mustFinishByMinutes,
      preferAfternoon,
      ignoreGap: true,
      allowWeekend,
      ignoreBlackout,
      ignoreDailyBuffer,
      allowEarlyMorning,
    });
  }

  if (candidates.length === 0) return null;

  if (preferLatestBeforeMinutes !== undefined) {
    const validBefore = candidates.filter(
      (start) => start + durationMinutes <= preferLatestBeforeMinutes
    );
    if (validBefore.length > 0) {
      return validBefore[validBefore.length - 1];
    }
  }

  if (preferAfternoon) {
    const afternoon = candidates.find((c) => c >= 13 * 60);
    if (afternoon !== undefined) return afternoon;
  }

  return candidates[0];
}

export function calibrateDuration(
  title: string,
  baseMinutes: number,
  rules: StandingRule[],
  multiplier = 1
): { minutes: number; appliedRule?: StandingRule } {
  for (const rule of rules) {
    if (
      !rule.enabled ||
      rule.category !== "duration-calibration" ||
      !rule.triggerPattern
    ) {
      continue;
    }
    if (
      matchesRulePattern(title, rule.triggerPattern) &&
      rule.fixedMinutesOverride
    ) {
      return {
        minutes: roundTo15(rule.fixedMinutesOverride),
        appliedRule: rule,
      };
    }
  }
  const scaled = baseMinutes * (multiplier > 0 ? multiplier : 1);
  return { minutes: roundTo15(Math.max(15, Math.min(240, scaled))) };
}

/**
 * Slots a Gemma-verified contextual prep block for a specific meeting,
 * respecting the user's >=2h runway rule (or afternoon prior for early meetings).
 */
export function placeGemmaContextualPrepBlock(params: {
  meeting: CalendarBlock;
  prepTitle: string;
  prepMinutes: number;
  contextEvidence: string;
  contextSources: string[];
  confidence: number;
  askUser: boolean;
  clarifyingQuestion?: string;
  blocks: CalendarBlock[];
  rules: StandingRule[];
  settings: OrganizerSettings;
  todayKey: string;
}): { updatedBlocks: CalendarBlock[]; createdPrep?: CalendarBlock } {
  const {
    meeting,
    prepTitle,
    prepMinutes,
    contextEvidence,
    contextSources,
    confidence,
    askUser,
    clarifyingQuestion,
    blocks,
    rules,
    settings,
    todayKey,
  } = params;

  if (!isEligibleRealMeetingForPrep(meeting)) {
    return { updatedBlocks: blocks };
  }

  if (
    rules.some(
      (r) =>
        r.enabled &&
        r.category === "ignore-pattern" &&
        (matchesRulePattern(meeting.title, r.triggerPattern) ||
          matchesRulePattern(prepTitle, r.triggerPattern))
    )
  ) {
    return { updatedBlocks: blocks };
  }

  const alreadyHasPrep = blocks.some(
    (b) => b.kind === "prep" && b.linkedMeetingId === meeting.id
  );
  if (alreadyHasPrep) {
    return { updatedBlocks: blocks };
  }

  const leadRule = rules.find(
    (r) => r.enabled && r.category === "prep-time" && r.appliesToRecurring
  );
  const minLead = leadRule?.minLeadMinutesBeforeMeeting ?? 120;
  const duration = roundTo15(Math.max(15, Math.min(120, prepMinutes)));
  const idealFinishBy = meeting.startMinutes - minLead;

  let chosenDateKey = meeting.dateKey;
  let chosenStart: number | null = null;

  if (idealFinishBy - settings.workdayStartMinutes >= duration) {
    chosenStart = findOpenSlot({
      dateKey: meeting.dateKey,
      durationMinutes: duration,
      blocks,
      rules,
      settings,
      preferLatestBeforeMinutes: idealFinishBy,
      mustFinishByMinutes: idealFinishBy,
    });
  }

  if (chosenStart === null && meeting.dateKey > todayKey) {
    const prevDayKey = addDaysToDateKey(meeting.dateKey, -1);
    const prevSlot = findOpenSlot({
      dateKey: prevDayKey,
      durationMinutes: duration,
      blocks,
      rules,
      settings,
      preferLatestBeforeMinutes: settings.workdayEndMinutes,
      preferAfternoon: true,
    });
    if (prevSlot !== null) {
      chosenDateKey = prevDayKey;
      chosenStart = prevSlot;
    }
  }

  if (chosenStart === null) {
    chosenDateKey = meeting.dateKey;
    chosenStart = findOpenSlot({
      dateKey: meeting.dateKey,
      durationMinutes: duration,
      blocks,
      rules,
      settings,
      preferLatestBeforeMinutes: meeting.startMinutes,
      mustFinishByMinutes: meeting.startMinutes,
      allowEarlyMorning: true,
      ignoreDailyBuffer: true,
    });
  }

  if (chosenStart === null) {
    return { updatedBlocks: blocks };
  }

  const hasAutoConfirmRule = rules.some(
    (r) =>
      r.enabled &&
      r.category === "auto-confirm" &&
      matchesRulePattern(meeting.title, r.triggerPattern)
  );
  const shouldAsk =
    settings.confirmationPolicy === "always-ask"
      ? true
      : settings.confirmationPolicy === "auto-high-confidence"
        ? confidence < 0.72
        : hasAutoConfirmRule
          ? false
          : askUser || settings.confirmationPolicy === "ask-often";

  const prepBlock: CalendarBlock = {
    id: `prep-${meeting.id}`,
    title: prepTitle.trim() || `Prep for ${meeting.title}`,
    kind: "prep",
    status: shouldAsk
      ? "proposed"
      : settings.autoWriteToCalendar
        ? "confirmed"
        : "auto-scheduled",
    dateKey: chosenDateKey,
    startMinutes: chosenStart,
    durationMinutes: duration,
    linkedMeetingId: meeting.id,
    calendarId: settings.writableCalendarId || undefined,
    isDayframeCreated: true,
    sourceLabel: contextSources[0] || `Meeting Context (${meeting.title})`,
    rationale: contextEvidence,
    contextSources,
    confidence,
    clarifyingQuestion: shouldAsk
      ? clarifyingQuestion ||
        `Block ${formatDuration(duration)} for "${prepTitle}" (${formatMinutesToTime(
          chosenStart
        )}, ≥${formatDuration(minLead)} before "${meeting.title}")?`
      : undefined,
    uncertaintyReason: shouldAsk ? "Contextual meeting prep" : undefined,
  };

  const next = [...blocks, prepBlock].sort(
    (a, b) =>
      a.dateKey.localeCompare(b.dateKey) || a.startMinutes - b.startMinutes
  );

  return { updatedBlocks: next, createdPrep: prepBlock };
}

/**
 * Only reconciles explicit keyword-targeted user prep rules (e.g., "Interview|Board")
 * on eligible real meetings — NEVER blindly adds prep to every recurring calendar event!
 */
export function reconcilePrepBlocks(
  currentBlocks: CalendarBlock[],
  rules: StandingRule[],
  settings: OrganizerSettings,
  todayKey: string = toLocalDateKey(new Date())
): CalendarBlock[] {
  // Purge any prep blocks attached to ineligible chores/routines
  const meetingMap = new Map(
    currentBlocks.filter((b) => b.kind === "meeting").map((m) => [m.id, m])
  );
  let working = currentBlocks.filter((b) => {
    if (b.kind !== "prep" || b.syncedToExternalCalendar) return true;
    if (b.linkedMeetingId) {
      const parent = meetingMap.get(b.linkedMeetingId);
      if (parent && !isEligibleRealMeetingForPrep(parent)) return false;
    }
    return true;
  });

  // Only apply explicit user-defined triggerPattern prep rules automatically
  const explicitKeywordRules = rules.filter(
    (r) => r.enabled && r.category === "prep-time" && Boolean(r.triggerPattern)
  );

  for (const meeting of working.filter(isEligibleRealMeetingForPrep)) {
    const matchedRule = explicitKeywordRules.find((r) =>
      matchesRulePattern(meeting.title, r.triggerPattern)
    );
    if (!matchedRule) continue;

    const placed = placeGemmaContextualPrepBlock({
      meeting,
      prepTitle: `Prep: ${meeting.title}`,
      prepMinutes: matchedRule.prepDurationMinutes ?? 45,
      contextEvidence: `Matches your explicit Standing Rule "${matchedRule.title}".`,
      contextSources: [`Rule: ${matchedRule.title}`],
      confidence: 0.9,
      askUser: settings.confirmationPolicy !== "auto-high-confidence",
      blocks: working,
      rules,
      settings,
      todayKey,
    });
    working = placed.updatedBlocks;
  }

  return working;
}

function normalizeTokens(text: string): Set<string> {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "review",
    "sync",
    "prep",
    "from",
    "email",
    "slack",
  ]);
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stop.has(w))
  );
}

export function isDuplicateOfExisting(
  signal: ExtractedCaptureSignal,
  blocks: CalendarBlock[],
  captures: ScreenshotCapture[]
): boolean {
  if (signal.fingerprintKey) {
    const matchingCap = captures.some(
      (c) =>
        (c.syncState === "scheduled" ||
          c.syncState === "awaiting-confirmation") &&
        c.extractedSignal?.fingerprintKey === signal.fingerprintKey
    );
    if (matchingCap) return true;
  }

  const sigTokens = normalizeTokens(signal.title);
  if (sigTokens.size < 2) return false;

  for (const b of blocks) {
    const bTokens = normalizeTokens(b.title);
    if (bTokens.size < 2) continue;
    let overlap = 0;
    for (const t of sigTokens) if (bTokens.has(t)) overlap++;
    if (overlap / Math.min(sigTokens.size, bTokens.size) >= 0.75) return true;
  }
  return false;
}

export function evaluateConfirmationRequirement(params: {
  signal: ExtractedCaptureSignal;
  calibratedMinutes: number;
  hasDurationRule: boolean;
  sourceLabel: string;
  rules: StandingRule[];
  settings: OrganizerSettings;
}): {
  ignoredByRule: boolean;
  shouldAskUser: boolean;
  clarifyingQuestion: string;
  uncertaintyReason: string;
} {
  const {
    signal,
    calibratedMinutes,
    hasDurationRule,
    sourceLabel,
    rules,
    settings,
  } = params;

  const isIgnored = rules.some(
    (r) =>
      r.enabled &&
      r.category === "ignore-pattern" &&
      matchesRulePattern(signal.title, r.triggerPattern)
  );
  if (isIgnored) {
    return {
      ignoredByRule: true,
      shouldAskUser: false,
      clarifyingQuestion: "",
      uncertaintyReason: "",
    };
  }

  const isExplicitlyAutoConfirmed = rules.some(
    (r) =>
      r.enabled &&
      r.category === "auto-confirm" &&
      matchesRulePattern(signal.title, r.triggerPattern)
  );

  const conf = signal.confidence ?? 0.78;

  let shouldAskUser = false;
  let defaultReason = signal.uncertaintyReason || "";

  if (settings.confirmationPolicy === "always-ask") {
    shouldAskUser = true;
    defaultReason = defaultReason || `From ${sourceLabel}`;
  } else if (isExplicitlyAutoConfirmed) {
    shouldAskUser = false;
  } else if (settings.confirmationPolicy === "ask-often") {
    if (signal.isSoloInvite || signal.detectedKind === "meeting") {
      shouldAskUser = true;
      defaultReason =
        defaultReason || `Informal mention in ${sourceLabel}`;
    } else if (signal.needsUserConfirmation) {
      shouldAskUser = true;
      defaultReason = defaultReason || `Spotted in ${sourceLabel}`;
    } else if (conf < 0.9) {
      shouldAskUser = true;
      defaultReason =
        defaultReason ||
        `${sourceLabel} (${Math.round(conf * 100)}% confidence)`;
    } else if (!hasDurationRule && calibratedMinutes >= 45) {
      shouldAskUser = true;
      defaultReason =
        defaultReason ||
        `Confirm ${formatDuration(calibratedMinutes)} focus slot`;
    }
  } else {
    shouldAskUser =
      conf < 0.72 || Boolean(signal.needsUserConfirmation && conf < 0.8);
    defaultReason = defaultReason || `Confirm ${sourceLabel} block`;
  }

  const clarifyingQuestion =
    signal.clarifyingQuestion ||
    (signal.isSoloInvite
      ? `${sourceLabel}: Put a ${formatDuration(
          calibratedMinutes
        )} solo hold for "${signal.title}" on your calendar?`
      : `${sourceLabel}: Block ${formatDuration(
          calibratedMinutes
        )} on your calendar for "${signal.title}"?`);

  return {
    ignoredByRule: false,
    shouldAskUser,
    clarifyingQuestion,
    uncertaintyReason: defaultReason || `From ${sourceLabel}`,
  };
}

export function placeSignalOnCalendar(params: {
  signal: ExtractedCaptureSignal;
  sourceLabel: string;
  sourceCaptureId?: string;
  contextSources?: string[];
  defaultDateKey: string;
  blocks: CalendarBlock[];
  captures: ScreenshotCapture[];
  rules: StandingRule[];
  settings: OrganizerSettings;
  forceAskUser?: boolean;
}): {
  updatedBlocks: CalendarBlock[];
  createdBlock?: CalendarBlock;
  deduplicated: boolean;
  ignoredByRule?: boolean;
  askedUser: boolean;
} {
  const {
    signal,
    sourceLabel,
    sourceCaptureId,
    contextSources,
    defaultDateKey,
    blocks,
    captures,
    rules,
    settings,
    forceAskUser = false,
  } = params;

  if (!signal.hasActionableItem) {
    return { updatedBlocks: blocks, deduplicated: false, askedUser: false };
  }

  // Never create blocks for chores/personal habits even if seen on screen
  if (CHORE_OR_PERSONAL_ROUTINE_REGEX.test(signal.title)) {
    return { updatedBlocks: blocks, deduplicated: false, askedUser: false };
  }

  if (isDuplicateOfExisting(signal, blocks, captures)) {
    return { updatedBlocks: blocks, deduplicated: true, askedUser: false };
  }

  const rawGutMinutes = signal.estimatedMinutes || 45;
  const { minutes: calibratedMinutes, appliedRule } = calibrateDuration(
    signal.title,
    rawGutMinutes,
    rules,
    settings.calibrationMultiplier
  );

  const decision = evaluateConfirmationRequirement({
    signal,
    calibratedMinutes,
    hasDurationRule: Boolean(appliedRule),
    sourceLabel,
    rules,
    settings,
  });

  if (decision.ignoredByRule) {
    return {
      updatedBlocks: blocks,
      deduplicated: false,
      ignoredByRule: true,
      askedUser: false,
    };
  }

  const askUser = forceAskUser || decision.shouldAskUser;
  const blockStatus = askUser
    ? "proposed"
    : settings.autoWriteToCalendar
      ? "confirmed"
      : "auto-scheduled";

  const targetDateKey = signal.proposedDateKey || defaultDateKey;
  const evidenceText = signal.contextEvidence
    ? `${signal.contextEvidence} (${signal.summary})`
    : signal.summary;

  if (
    signal.detectedKind === "meeting" &&
    signal.proposedStartMinutes !== undefined
  ) {
    const duration = roundTo15(signal.estimatedMinutes || 30);
    const soloMeeting: CalendarBlock = {
      id: `blk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: signal.title,
      kind: "meeting",
      status: blockStatus,
      dateKey: targetDateKey,
      startMinutes: signal.proposedStartMinutes,
      durationMinutes: duration,
      isRecurring: Boolean(signal.isRecurringMention),
      isSoloHold: Boolean(signal.isSoloInvite ?? true),
      locationOrUrl: signal.locationOrUrl,
      linkedMeetingId: signal.linkedMeetingId,
      sourceCaptureId,
      calendarId: settings.writableCalendarId || undefined,
      isDayframeCreated: true,
      sourceLabel,
      rationale: evidenceText,
      contextSources: contextSources ?? [sourceLabel],
      confidence: signal.confidence ?? 0.8,
      clarifyingQuestion: askUser ? decision.clarifyingQuestion : undefined,
      uncertaintyReason: askUser ? decision.uncertaintyReason : undefined,
    };
    const next = [...blocks, soloMeeting].sort(
      (a, b) =>
        a.dateKey.localeCompare(b.dateKey) || a.startMinutes - b.startMinutes
    );
    return {
      updatedBlocks: next,
      createdBlock: soloMeeting,
      deduplicated: false,
      askedUser: askUser,
    };
  }

  // If this task prepares for a specific linked meeting, finish >=2h before that meeting!
  let mustFinishBy: number | undefined;
  let preferredDate = targetDateKey;
  if (signal.linkedMeetingId) {
    const linked = blocks.find((b) => b.id === signal.linkedMeetingId);
    if (linked) {
      preferredDate = linked.dateKey;
      mustFinishBy = Math.max(
        settings.workdayStartMinutes + calibratedMinutes,
        linked.startMinutes - 120
      );
    }
  }

  const preferAfternoon =
    !mustFinishBy &&
    (signal.detectedKind === "follow-up" || calibratedMinutes <= 30);

  let chosenDate = preferredDate;
  let chosenStart: number | null = null;

  for (let d = 0; d < 14; d++) {
    const candidateDate = addDaysToDateKey(preferredDate, d);
    const slot = findOpenSlot({
      dateKey: candidateDate,
      durationMinutes: calibratedMinutes,
      blocks,
      rules,
      settings,
      preferLatestBeforeMinutes: d === 0 ? mustFinishBy : undefined,
      mustFinishByMinutes: d === 0 ? mustFinishBy : undefined,
      preferAfternoon: d === 0 ? preferAfternoon : false,
    });
    if (slot !== null) {
      chosenDate = candidateDate;
      chosenStart = slot;
      break;
    }
  }

  if (chosenStart === null) {
    chosenDate = addDaysToDateKey(toLocalDateKey(new Date()), 1);
    chosenStart = Math.max(
      settings.workdayStartMinutes,
      settings.notAMorningPersonUntilMinutes || 0
    );
  }

  const workBlock: CalendarBlock = {
    id: `blk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: signal.title,
    kind: signal.detectedKind === "follow-up" ? "follow-up" : "deep-work",
    status: blockStatus,
    dateKey: chosenDate,
    startMinutes: chosenStart,
    durationMinutes: calibratedMinutes,
    gutMinutes: rawGutMinutes,
    deadlineDateKey: signal.deadlineDateKey,
    linkedMeetingId: signal.linkedMeetingId,
    sourceCaptureId,
    ruleId: appliedRule?.id,
    calendarId: settings.writableCalendarId || undefined,
    isDayframeCreated: true,
    sourceLabel,
    rationale: `${evidenceText}${
      appliedRule
        ? ` • Sized to ${formatDuration(calibratedMinutes)} via "${appliedRule.title}".`
        : ` • Gut ${formatDuration(rawGutMinutes)} × ${settings.calibrationMultiplier} = ${formatDuration(calibratedMinutes)}.`
    }`,
    contextSources: contextSources ?? [sourceLabel],
    confidence: signal.confidence ?? 0.78,
    clarifyingQuestion: askUser ? decision.clarifyingQuestion : undefined,
    uncertaintyReason: askUser ? decision.uncertaintyReason : undefined,
  };

  const nextBlocks = [...blocks, workBlock].sort(
    (a, b) =>
      a.dateKey.localeCompare(b.dateKey) || a.startMinutes - b.startMinutes
  );

  return {
    updatedBlocks: nextBlocks,
    createdBlock: workBlock,
    deduplicated: false,
    askedUser: askUser,
  };
}

export function extractRuleTriggerFromTitle(title: string): string {
  return title
    .replace(/^Prep(?:\s+for)?:?\s*/i, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 2)
    .join("|");
}

export function applyUserRuleFeedback(params: {
  text: string;
  blocks: CalendarBlock[];
  rules: StandingRule[];
  settings: OrganizerSettings;
}): {
  blocks: CalendarBlock[];
  rules: StandingRule[];
  settings: OrganizerSettings;
  assistantReply: string;
  actionSummary: string;
} {
  const { text, blocks, rules, settings } = params;
  const lower = text.toLowerCase();

  if (
    lower.includes("always ask") ||
    lower.includes("ask me every") ||
    lower.includes("never auto")
  ) {
    return {
      blocks,
      rules,
      settings: {
        ...settings,
        confirmationPolicy: "always-ask",
        autoWriteToCalendar: false,
      },
      assistantReply:
        "Switched to Always Ask — I will ask for your confirmation on every proposed item before writing to Calendar.app.",
      actionSummary: "Confirmation policy → Always Ask",
    };
  }

  if (lower.includes("ask often") || lower.includes("when unsure")) {
    return {
      blocks,
      rules,
      settings: {
        ...settings,
        confirmationPolicy: "ask-often",
      },
      assistantReply:
        "Set to Ask Often — I'll filter out chores/noise automatically and ask you on genuine task/prep candidates.",
      actionSummary: "Confirmation policy → Ask Often",
    };
  }

  const hoursLeadMatch = lower.match(
    /(\d+(?:\.\d+)?)\s*(?:hour|hr|h)s?\s*(?:before|ahead|prior)/
  );
  const minsPrepMatch = lower.match(
    /(\d+)\s*(?:min|minute|m)s?\s*(?:of\s+)?prep/
  );
  const hoursPrepMatch = lower.match(
    /(\d+(?:\.\d+)?)\s*(?:hour|hr|h)s?\s*(?:of\s+)?prep/
  );

  if (
    lower.includes("prep") ||
    lower.includes("prepare") ||
    lower.includes("before") ||
    lower.includes("recurring") ||
    lower.includes("recurrent")
  ) {
    const newLeadMinutes = hoursLeadMatch
      ? Math.round(Number(hoursLeadMatch[1]) * 60)
      : 120;
    const newPrepDuration = minsPrepMatch
      ? roundTo15(Number(minsPrepMatch[1]))
      : hoursPrepMatch
        ? roundTo15(Number(hoursPrepMatch[1]) * 60)
        : undefined;

    const topicMatch = lower.match(
      /(?:before|for)\s+([a-z0-9\s-]+?)(?:\s+meetings?|\s+calls?|\s+syncs?|$)/
    );
    const explicitKeyword =
      topicMatch &&
      !["recurring", "recurrent", "my", "all"].includes(
        topicMatch[1].trim().toLowerCase()
      )
        ? topicMatch[1].trim().split(/\s+/)[0]
        : undefined;

    const updatedRules = [...rules];
    if (!explicitKeyword) {
      const idx = updatedRules.findIndex(
        (r) => r.category === "prep-time" && r.appliesToRecurring
      );
      if (idx >= 0) {
        const prev = updatedRules[idx];
        updatedRules[idx] = {
          ...prev,
          enabled: true,
          minLeadMinutesBeforeMeeting: newLeadMinutes,
          prepDurationMinutes:
            newPrepDuration ?? prev.prepDurationMinutes ?? 45,
          title: `≥${formatDuration(newLeadMinutes)} runway before real meetings that need prep`,
          description: `When Gemma 4 identifies a meeting requiring preparation, finish ${formatDuration(
            newPrepDuration ?? prev.prepDurationMinutes ?? 45
          )} of prep ≥${formatDuration(newLeadMinutes)} ahead.`,
          createdFromFeedback: true,
        };
      }
    } else {
      updatedRules.unshift({
        id: `rule-fb-${Date.now()}`,
        title: `Prep before "${explicitKeyword}" meetings (≥${formatDuration(
          newLeadMinutes
        )} ahead)`,
        description: `Reserve ${formatDuration(
          newPrepDuration ?? 45
        )} finishing ≥${formatDuration(
          newLeadMinutes
        )} before "${explicitKeyword}" meetings.`,
        category: "prep-time",
        enabled: true,
        triggerPattern: explicitKeyword,
        prepDurationMinutes: newPrepDuration ?? 45,
        minLeadMinutesBeforeMeeting: newLeadMinutes,
        createdFromFeedback: true,
      });
    }

    const reconciled = reconcilePrepBlocks(blocks, updatedRules, settings);
    return {
      blocks: reconciled,
      rules: updatedRules,
      settings,
      assistantReply: `Updated your prep rule (≥${formatDuration(
        newLeadMinutes
      )} lead). Gemma 4 will apply this selectively to real meetings that warrant preparation.`,
      actionSummary: `Updated prep runway (≥${formatDuration(newLeadMinutes)} lead)`,
    };
  }

  const durationRuleMatch = lower.match(
    /([a-z\s]{3,30}?)\s+(?:usually\s+|always\s+|typically\s+)?(?:take|takes|need|needs)\s+(?:about\s+|around\s+)?(\d+)\s*(min|minute|m|hr|hour|h)/
  );
  if (durationRuleMatch) {
    const rawTopic = durationRuleMatch[1]
      .replace(/^(hey|so|actually|for|my)\s+/i, "")
      .trim();
    const num = Number(durationRuleMatch[2]);
    const unit = durationRuleMatch[3];
    const mins = roundTo15(unit.startsWith("h") ? num * 60 : num);
    const keyword = rawTopic.split(/\s+/).slice(-2).join("|");

    const newRule: StandingRule = {
      id: `rule-dur-${Date.now()}`,
      title: `Size "${rawTopic}" to ${formatDuration(mins)}`,
      description: `Learned from your feedback: set matching calendar blocks to ${formatDuration(
        mins
      )}.`,
      category: "duration-calibration",
      enabled: true,
      triggerPattern: keyword,
      fixedMinutesOverride: mins,
      createdFromFeedback: true,
    };

    const updatedBlocks = blocks.map((b) =>
      (b.kind === "deep-work" || b.kind === "follow-up") &&
      matchesRulePattern(b.title, keyword)
        ? { ...b, durationMinutes: mins }
        : b
    );

    return {
      blocks: updatedBlocks,
      rules: [newRule, ...rules],
      settings,
      assistantReply: `Got it — I'll budget ${formatDuration(
        mins
      )} on your calendar whenever "${rawTopic}" comes up.`,
      actionSummary: `Duration rule saved: ${rawTopic} → ${formatDuration(mins)}`,
    };
  }

  const intervalMatch = lower.match(/every\s+(\d+)\s*(?:min|minute|m)/);
  if (intervalMatch) {
    const mins = Math.max(1, Math.min(30, Number(intervalMatch[1])));
    return {
      blocks,
      rules,
      settings: { ...settings, intervalMinutes: mins },
      assistantReply: `Updated your silent screenshot queue cadence to every ${mins} minute${
        mins === 1 ? "" : "s"
      } (models remain stopped at 0 MB RAM until your next batch window).`,
      actionSummary: `Capture cadence → ${mins}m`,
    };
  }

  const noteRule: StandingRule = {
    id: `rule-note-${Date.now()}`,
    title: text.length > 56 ? `${text.slice(0, 53)}...` : text,
    description: `Organizer preference passed to local Gemma 4: "${text}"`,
    category: "availability",
    enabled: true,
    createdFromFeedback: true,
  };

  return {
    blocks,
    rules: [noteRule, ...rules],
    settings,
    assistantReply: `Saved to your local Standing Rules so Gemma 4 applies "${noteRule.title}" during each contextual scan and batch run.`,
    actionSummary: "Saved rule to local Gemma 4 memory",
  };
}
