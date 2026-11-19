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
  calendarSource: "none",
  captureEngine: "macos-native",
  writableCalendarId: "",
  writableCalendarTitle: "Default Calendar",
  autoWriteToCalendar: true,
  intervalMinutes: 5,
  skipDuplicateFrames: true,
  workdayStartMinutes: 9 * 60, // 9:00 AM
  workdayEndMinutes: 18 * 60, // 6:00 PM
  minGapBetweenBlocksMinutes: 15,
  nightlyAndroidSyncHour: 23,
};

export const DEFAULT_STANDING_RULES: StandingRule[] = [
  {
    id: "rule-recurring-prep-2h",
    title: "≥2h runway before recurring meetings",
    description:
      "Reserve preparation time finishing at least 2 hours before recurring meetings (or the afternoon prior when a recurring meeting starts early in the morning).",
    category: "prep-time",
    enabled: true,
    appliesToRecurring: true,
    prepDurationMinutes: 60,
    minLeadMinutesBeforeMeeting: 120,
  },
  {
    id: "rule-solo-holds",
    title: "Solo calendar holds from email & Slack mentions",
    description:
      "When an email or Slack message mentions a specific meeting time without a formal invite, place a personal hold on your calendar just for you.",
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
      "Routes shorter 15–30m email/Slack follow-up replies to afternoon gaps instead of fragmenting your morning.",
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
    id: "q-external-prep",
    question:
      "Also add 45m of prep (≥2h ahead) before non-recurring 1:1, Interview, or Client calls?",
    whyItMatters:
      "Extends your 2-hour prep runway beyond weekly recurring syncs to one-off high-stakes calls.",
    acceptLabel: "Enable for 1:1 / Client / Interview",
    ruleToCreate: {
      title: "45m prep (≥2h ahead) for 1:1, Client & Interview calls",
      description:
        "Reserve 45m finishing ≥2h before meetings matching 1:1, Client, Customer, or Interview.",
      category: "prep-time",
      enabled: true,
      triggerPattern: "1:1|Client|Customer|Interview|Board",
      prepDurationMinutes: 45,
      minLeadMinutesBeforeMeeting: 120,
    },
  },
  {
    id: "q-evening-cutoff",
    question:
      "Set a 5:30 PM cutoff so late-afternoon Slack/email tasks roll into tomorrow morning?",
    whyItMatters:
      "Prevents late messages from booking your evening.",
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

export function formatMinutesToTime(totalMinutes: number): string {
  const clamped = ((totalMinutes % 1440) + 1440) % 1440;
  const hours24 = Math.floor(clamped / 60);
  const mins = clamped % 60;
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(mins).padStart(2, "0")} ${period}`;
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

export function getProtectedIntervals(
  rules: StandingRule[]
): Array<{ startMinutes: number; endMinutes: number; label: string }> {
  return rules
    .filter(
      (r) => r.enabled && r.category === "availability" && r.protectedWindow
    )
    .map((r) => r.protectedWindow!);
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
}: SlotQuery): number | null {
  const dayStart = settings.workdayStartMinutes;
  const dayEnd = mustFinishByMinutes
    ? Math.min(settings.workdayEndMinutes, mustFinishByMinutes)
    : settings.workdayEndMinutes;

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
  rules: StandingRule[]
): { minutes: number; appliedRule?: StandingRule } {
  for (const rule of rules) {
    if (
      !rule.enabled ||
      rule.category !== "duration-calibration" ||
      !rule.triggerPattern
    ) {
      continue;
    }
    try {
      if (new RegExp(rule.triggerPattern, "i").test(title)) {
        if (rule.fixedMinutesOverride) {
          return {
            minutes: roundTo15(rule.fixedMinutesOverride),
            appliedRule: rule,
          };
        }
      }
    } catch {
      if (title.toLowerCase().includes(rule.triggerPattern.toLowerCase())) {
        if (rule.fixedMinutesOverride) {
          return {
            minutes: roundTo15(rule.fixedMinutesOverride),
            appliedRule: rule,
          };
        }
      }
    }
  }
  return { minutes: roundTo15(baseMinutes) };
}

function findMatchingPrepRule(
  meeting: CalendarBlock,
  rules: StandingRule[]
): StandingRule | undefined {
  const prepRules = rules.filter((r) => r.enabled && r.category === "prep-time");
  for (const rule of prepRules) {
    if (rule.appliesToRecurring && meeting.isRecurring) return rule;
    if (rule.triggerPattern) {
      try {
        if (new RegExp(rule.triggerPattern, "i").test(meeting.title)) return rule;
      } catch {
        if (meeting.title.toLowerCase().includes(rule.triggerPattern.toLowerCase())) {
          return rule;
        }
      }
    }
  }
  return undefined;
}

export function reconcilePrepBlocks(
  currentBlocks: CalendarBlock[],
  rules: StandingRule[],
  settings: OrganizerSettings,
  todayKey: string = toLocalDateKey(new Date()),
  initialStatus: "confirmed" | "proposed" | "auto-scheduled" = "auto-scheduled"
): CalendarBlock[] {
  const retained = currentBlocks.filter(
    (b) => !(b.kind === "prep" && !b.syncedToExternalCalendar && b.status !== "confirmed")
  );
  const working = [...retained];

  const meetings = working
    .filter((b) => b.kind === "meeting")
    .sort(
      (a, b) =>
        a.dateKey.localeCompare(b.dateKey) || a.startMinutes - b.startMinutes
    );

  for (const meeting of meetings) {
    const alreadyHasPrep = working.some(
      (b) =>
        (b.kind === "prep" && b.linkedMeetingId === meeting.id) ||
        (b.dateKey === meeting.dateKey &&
          b.title.toLowerCase() === `prep: ${meeting.title}`.toLowerCase())
    );
    if (alreadyHasPrep) continue;

    const rule = findMatchingPrepRule(meeting, rules);
    if (!rule) continue;

    const prepDuration = roundTo15(rule.prepDurationMinutes ?? 60);
    const minLead = rule.minLeadMinutesBeforeMeeting ?? 120;
    const idealFinishBy = meeting.startMinutes - minLead;

    let chosenDateKey = meeting.dateKey;
    let chosenStart: number | null = null;
    let rationale = "";

    if (idealFinishBy - settings.workdayStartMinutes >= prepDuration) {
      chosenStart = findOpenSlot({
        dateKey: meeting.dateKey,
        durationMinutes: prepDuration,
        blocks: working,
        rules,
        settings,
        preferLatestBeforeMinutes: idealFinishBy,
        mustFinishByMinutes: idealFinishBy,
      });
      if (chosenStart !== null) {
        rationale = `Scheduled ≥${formatDuration(minLead)} ahead of "${meeting.title}" per "${rule.title}".`;
      }
    }

    // If the meeting is on a future day and starts too early for a 2h morning lead, place prep on the afternoon prior
    if (chosenStart === null && meeting.dateKey > todayKey) {
      const prevDayKey = addDaysToDateKey(meeting.dateKey, -1);
      const prevSlot = findOpenSlot({
        dateKey: prevDayKey,
        durationMinutes: prepDuration,
        blocks: working,
        rules,
        settings,
        preferLatestBeforeMinutes: settings.workdayEndMinutes,
        preferAfternoon: true,
      });
      if (prevSlot !== null) {
        chosenDateKey = prevDayKey;
        chosenStart = prevSlot;
        rationale = `"${meeting.title}" starts at ${formatMinutesToTime(
          meeting.startMinutes
        )}, so prep was placed the afternoon before to preserve your ≥${formatDuration(
          minLead
        )} lead rule.`;
      }
    }

    if (chosenStart === null) {
      chosenDateKey = meeting.dateKey;
      chosenStart = findOpenSlot({
        dateKey: meeting.dateKey,
        durationMinutes: prepDuration,
        blocks: working,
        rules,
        settings,
        preferLatestBeforeMinutes: meeting.startMinutes,
        mustFinishByMinutes: meeting.startMinutes,
      });
      if (chosenStart !== null) {
        rationale = `Closest open window prior to "${meeting.title}".`;
      }
    }

    if (chosenStart !== null) {
      working.push({
        id: `prep-${meeting.id}`,
        title: `Prep: ${meeting.title}`,
        kind: "prep",
        status: initialStatus,
        dateKey: chosenDateKey,
        startMinutes: chosenStart,
        durationMinutes: prepDuration,
        linkedMeetingId: meeting.id,
        ruleId: rule.id,
        sourceLabel: rule.title,
        rationale,
        confidence: 0.95,
      });
    }
  }

  return working.sort(
    (a, b) =>
      a.dateKey.localeCompare(b.dateKey) || a.startMinutes - b.startMinutes
  );
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
        c.syncState === "scheduled" &&
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

export function placeSignalOnCalendar(params: {
  signal: ExtractedCaptureSignal;
  sourceLabel: string;
  sourceCaptureId?: string;
  defaultDateKey: string;
  blocks: CalendarBlock[];
  captures: ScreenshotCapture[];
  rules: StandingRule[];
  settings: OrganizerSettings;
  status?: "confirmed" | "proposed" | "auto-scheduled";
}): {
  updatedBlocks: CalendarBlock[];
  createdBlock?: CalendarBlock;
  deduplicated: boolean;
} {
  const {
    signal,
    sourceLabel,
    sourceCaptureId,
    defaultDateKey,
    blocks,
    captures,
    rules,
    settings,
    status = "auto-scheduled",
  } = params;

  if (!signal.hasActionableItem) {
    return { updatedBlocks: blocks, deduplicated: false };
  }

  if (isDuplicateOfExisting(signal, blocks, captures)) {
    return { updatedBlocks: blocks, deduplicated: true };
  }

  const targetDateKey = signal.proposedDateKey || defaultDateKey;

  if (
    signal.detectedKind === "meeting" &&
    signal.proposedStartMinutes !== undefined
  ) {
    const duration = roundTo15(signal.estimatedMinutes || 30);
    const soloMeeting: CalendarBlock = {
      id: `blk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: signal.title,
      kind: "meeting",
      status,
      dateKey: targetDateKey,
      startMinutes: signal.proposedStartMinutes,
      durationMinutes: duration,
      isRecurring: Boolean(signal.isRecurringMention),
      isSoloHold: Boolean(signal.isSoloInvite ?? true),
      locationOrUrl: signal.locationOrUrl,
      sourceCaptureId,
      sourceLabel,
      rationale: `Solo calendar hold created just for you (${signal.summary}).`,
      confidence: 0.92,
    };
    const next = reconcilePrepBlocks(
      [...blocks, soloMeeting],
      rules,
      settings,
      defaultDateKey,
      status
    );
    return {
      updatedBlocks: next,
      createdBlock: soloMeeting,
      deduplicated: false,
    };
  }

  const { minutes: calibratedMinutes, appliedRule } = calibrateDuration(
    signal.title,
    signal.estimatedMinutes || 45,
    rules
  );

  const preferAfternoon =
    signal.detectedKind === "follow-up" || calibratedMinutes <= 30;

  let chosenDate = targetDateKey;
  let chosenStart: number | null = null;

  // Search up to 5 days ahead for an open focus window
  for (let d = 0; d < 5; d++) {
    const candidateDate = addDaysToDateKey(targetDateKey, d);
    const slot = findOpenSlot({
      dateKey: candidateDate,
      durationMinutes: calibratedMinutes,
      blocks,
      rules,
      settings,
      preferAfternoon: d === 0 ? preferAfternoon : false,
    });
    if (slot !== null) {
      chosenDate = candidateDate;
      chosenStart = slot;
      break;
    }
  }

  if (chosenStart === null) {
    chosenDate = targetDateKey;
    chosenStart = settings.workdayEndMinutes - calibratedMinutes;
  }

  const workBlock: CalendarBlock = {
    id: `blk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: signal.title,
    kind: signal.detectedKind === "follow-up" ? "follow-up" : "deep-work",
    status,
    dateKey: chosenDate,
    startMinutes: chosenStart,
    durationMinutes: calibratedMinutes,
    sourceCaptureId,
    ruleId: appliedRule?.id,
    sourceLabel,
    rationale: `${signal.summary}${
      appliedRule
        ? ` • Calibrated to ${formatDuration(calibratedMinutes)} via "${appliedRule.title}".`
        : ` • Slotted into open ${formatDuration(calibratedMinutes)} window.`
    }`,
    confidence: 0.9,
  };

  const nextBlocks = [...blocks, workBlock].sort(
    (a, b) =>
      a.dateKey.localeCompare(b.dateKey) || a.startMinutes - b.startMinutes
  );

  return {
    updatedBlocks: nextBlocks,
    createdBlock: workBlock,
    deduplicated: false,
  };
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

    const isRecurringTarget =
      lower.includes("recurring") ||
      lower.includes("recurrent") ||
      !lower.match(/for\s+[a-z]+/);

    const updatedRules = [...rules];
    if (isRecurringTarget) {
      const idx = updatedRules.findIndex(
        (r) => r.category === "prep-time" && r.appliesToRecurring
      );
      if (idx >= 0) {
        const prev = updatedRules[idx];
        updatedRules[idx] = {
          ...prev,
          enabled: true,
          minLeadMinutesBeforeMeeting: newLeadMinutes,
          prepDurationMinutes: newPrepDuration ?? prev.prepDurationMinutes ?? 60,
          title: `≥${formatDuration(newLeadMinutes)} runway before recurring meetings`,
          description: `Reserve ${formatDuration(
            newPrepDuration ?? prev.prepDurationMinutes ?? 60
          )} finishing ≥${formatDuration(newLeadMinutes)} before recurring meetings.`,
          createdFromFeedback: true,
        };
      } else {
        updatedRules.unshift({
          id: `rule-fb-${Date.now()}`,
          title: `≥${formatDuration(newLeadMinutes)} runway before recurring meetings`,
          description: `Reserve ${formatDuration(
            newPrepDuration ?? 60
          )} finishing ≥${formatDuration(newLeadMinutes)} before recurring meetings.`,
          category: "prep-time",
          enabled: true,
          appliesToRecurring: true,
          prepDurationMinutes: newPrepDuration ?? 60,
          minLeadMinutesBeforeMeeting: newLeadMinutes,
          createdFromFeedback: true,
        });
      }
    } else {
      const topicMatch = lower.match(
        /(?:before|for)\s+([a-z0-9\s-]+?)(?:\s+meetings?|\s+calls?|\s+syncs?|$)/
      );
      const keyword = topicMatch?.[1]?.trim().split(/\s+/)[0] || "review";
      updatedRules.unshift({
        id: `rule-fb-${Date.now()}`,
        title: `Prep before "${keyword}" meetings (≥${formatDuration(
          newLeadMinutes
        )} ahead)`,
        description: `Reserve ${formatDuration(
          newPrepDuration ?? 60
        )} finishing ≥${formatDuration(
          newLeadMinutes
        )} before "${keyword}" meetings.`,
        category: "prep-time",
        enabled: true,
        triggerPattern: keyword,
        prepDurationMinutes: newPrepDuration ?? 60,
        minLeadMinutesBeforeMeeting: newLeadMinutes,
        createdFromFeedback: true,
      });
    }

    const reconciled = reconcilePrepBlocks(blocks, updatedRules, settings);
    return {
      blocks: reconciled,
      rules: updatedRules,
      settings,
      assistantReply: `Saved to your Standing Rules and updated prep blocks on your schedule (≥${formatDuration(
        newLeadMinutes
      )} ahead).`,
      actionSummary: `Updated prep rule (≥${formatDuration(newLeadMinutes)} lead)`,
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
      new RegExp(keyword, "i").test(b.title)
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
      assistantReply: `Updated your screenshot interval to every ${mins} minute${
        mins === 1 ? "" : "s"
      }.`,
      actionSummary: `Capture cadence → ${mins}m`,
    };
  }

  const noteRule: StandingRule = {
    id: `rule-note-${Date.now()}`,
    title: text.length > 56 ? `${text.slice(0, 53)}...` : text,
    description: `Organizer preference passed to Gemma 4: "${text}"`,
    category: "availability",
    enabled: true,
    createdFromFeedback: true,
  };

  return {
    blocks,
    rules: [noteRule, ...rules],
    settings,
    assistantReply: `Added to your Standing Rules context so Gemma 4 applies "${noteRule.title}" on every screenshot and inbox scan.`,
    actionSummary: "Saved rule to Gemma 4 prompt memory",
  };
}
