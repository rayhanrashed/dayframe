import {
  CalendarBlock,
  CaptureSettings,
  ExtractedCaptureSignal,
  ScreenshotCapture,
  StandingRule,
} from "./types";

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
    .filter((r) => r.enabled && r.category === "availability" && r.protectedWindow)
    .map((r) => r.protectedWindow!);
}

interface SlotQuery {
  dayOffset: number;
  durationMinutes: number;
  blocks: CalendarBlock[];
  rules: StandingRule[];
  settings: CaptureSettings;
  preferLatestBeforeMinutes?: number;
  mustFinishByMinutes?: number;
  preferAfternoon?: boolean;
  ignoreGap?: boolean;
}

export function findOpenSlot({
  dayOffset,
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
  const dayBlocks = blocks.filter((b) => b.dayOffset === dayOffset);
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
      dayOffset,
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
    if (!rule.enabled || rule.category !== "duration-calibration") continue;
    if (!rule.triggerPattern) continue;
    try {
      const regex = new RegExp(rule.triggerPattern, "i");
      if (regex.test(title)) {
        if (rule.fixedMinutesOverride) {
          return {
            minutes: roundTo15(rule.fixedMinutesOverride),
            appliedRule: rule,
          };
        }
        if (rule.durationMultiplier) {
          return {
            minutes: roundTo15(baseMinutes * rule.durationMultiplier),
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
    if (rule.appliesToRecurring && meeting.isRecurring) {
      return rule;
    }
    if (rule.triggerPattern) {
      try {
        const re = new RegExp(rule.triggerPattern, "i");
        if (re.test(meeting.title)) return rule;
      } catch {
        if (meeting.title.toLowerCase().includes(rule.triggerPattern.toLowerCase())) {
          return rule;
        }
      }
    }
  }
  return undefined;
}

/**
 * Ensures every qualifying meeting on Today (0) and Tomorrow (1) has a properly timed Prep Block
 * honoring user Standing Rules (e.g. "at least 2 hours before recurring meetings").
 */
export function reconcilePrepBlocks(
  currentBlocks: CalendarBlock[],
  rules: StandingRule[],
  settings: CaptureSettings
): CalendarBlock[] {
  // Keep confirmed prep blocks, recalculate auto-scheduled prep blocks cleanly
  const retained = currentBlocks.filter(
    (b) => !(b.kind === "prep" && b.status === "auto-scheduled")
  );
  const working = [...retained];

  const meetings = working
    .filter((b) => b.kind === "meeting")
    .sort((a, b) => a.dayOffset - b.dayOffset || a.startMinutes - b.startMinutes);

  for (const meeting of meetings) {
    const alreadyHasConfirmedPrep = working.some(
      (b) => b.kind === "prep" && b.linkedMeetingId === meeting.id
    );
    if (alreadyHasConfirmedPrep) continue;

    const rule = findMatchingPrepRule(meeting, rules);
    if (!rule) continue;

    const prepDuration = roundTo15(rule.prepDurationMinutes ?? 60);
    const minLead = rule.minLeadMinutesBeforeMeeting ?? 120;
    const idealFinishBy = meeting.startMinutes - minLead;

    let chosenDay = meeting.dayOffset;
    let chosenStart: number | null = null;
    let leadNote = "";

    // 1. Try placing on the same day finishing >= minLead before the meeting
    if (idealFinishBy - settings.workdayStartMinutes >= prepDuration) {
      chosenStart = findOpenSlot({
        dayOffset: meeting.dayOffset,
        durationMinutes: prepDuration,
        blocks: working,
        rules,
        settings,
        preferLatestBeforeMinutes: idealFinishBy,
        mustFinishByMinutes: idealFinishBy,
      });
      if (chosenStart !== null) {
        leadNote = `Scheduled ≥${formatDuration(minLead)} ahead of "${meeting.title}" per "${rule.title}".`;
      }
    }

    // 2. If meeting is Tomorrow morning (not enough morning hours for 2h lead), place Prep on Today afternoon!
    if (chosenStart === null && meeting.dayOffset > 0) {
      const prevDaySlot = findOpenSlot({
        dayOffset: meeting.dayOffset - 1,
        durationMinutes: prepDuration,
        blocks: working,
        rules,
        settings,
        preferLatestBeforeMinutes: settings.workdayEndMinutes,
        preferAfternoon: true,
      });
      if (prevDaySlot !== null) {
        chosenDay = meeting.dayOffset - 1;
        chosenStart = prevDaySlot;
        leadNote = `Tomorrow's "${meeting.title}" starts at ${formatMinutesToTime(
          meeting.startMinutes
        )}, so prep was placed the afternoon before to preserve your ≥${formatDuration(
          minLead
        )} lead rule.`;
      }
    }

    // 3. Fallback: any open slot before the meeting on the same day
    if (chosenStart === null) {
      chosenDay = meeting.dayOffset;
      chosenStart = findOpenSlot({
        dayOffset: meeting.dayOffset,
        durationMinutes: prepDuration,
        blocks: working,
        rules,
        settings,
        preferLatestBeforeMinutes: meeting.startMinutes,
        mustFinishByMinutes: meeting.startMinutes,
      });
      if (chosenStart !== null) {
        leadNote = `Closest open window prior to "${meeting.title}" (morning lead window was partially booked).`;
      }
    }

    if (chosenStart !== null) {
      working.push({
        id: `prep-for-${meeting.id}`,
        title: `Prep: ${meeting.title}`,
        kind: "prep",
        status: "auto-scheduled",
        dayOffset: chosenDay,
        startMinutes: chosenStart,
        durationMinutes: prepDuration,
        linkedMeetingId: meeting.id,
        ruleId: rule.id,
        sourceLabel: rule.title,
        rationale: leadNote,
        confidence: 0.94,
      });
    }
  }

  return working.sort(
    (a, b) => a.dayOffset - b.dayOffset || a.startMinutes - b.startMinutes
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
    "follow",
    "from",
    "email",
    "slack",
    "tomorrow",
    "today",
  ]);
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stop.has(w))
  );
}

export function findDuplicateCapture(
  signal: ExtractedCaptureSignal,
  existingCaptures: ScreenshotCapture[]
): ScreenshotCapture | undefined {
  for (const cap of existingCaptures) {
    if (cap.syncState === "queued-for-tonight" || !cap.extractedSignal) continue;
    if (
      signal.fingerprintKey &&
      cap.extractedSignal.fingerprintKey &&
      signal.fingerprintKey === cap.extractedSignal.fingerprintKey
    ) {
      return cap;
    }
    const a = normalizeTokens(signal.title);
    const b = normalizeTokens(cap.extractedSignal.title);
    if (a.size >= 2 && b.size >= 2) {
      let overlap = 0;
      for (const token of a) {
        if (b.has(token)) overlap++;
      }
      const ratio = overlap / Math.min(a.size, b.size);
      if (ratio >= 0.75) return cap;
    }
  }
  return undefined;
}

export function scheduleSignalIntoCalendar(params: {
  capture: ScreenshotCapture;
  signal: ExtractedCaptureSignal;
  currentBlocks: CalendarBlock[];
  existingCaptures: ScreenshotCapture[];
  rules: StandingRule[];
  settings: CaptureSettings;
  defaultTargetDayOffset?: number;
}): {
  updatedBlocks: CalendarBlock[];
  updatedCapture: ScreenshotCapture;
  createdBlock?: CalendarBlock;
} {
  const {
    capture,
    signal,
    currentBlocks,
    existingCaptures,
    rules,
    settings,
    defaultTargetDayOffset = 0,
  } = params;

  if (!signal.hasActionableItem) {
    return {
      updatedBlocks: currentBlocks,
      updatedCapture: {
        ...capture,
        extractedSignal: signal,
        syncState: "no-action",
      },
    };
  }

  // Cross-device / repeated screenshot deduplication
  const duplicate = findDuplicateCapture(signal, existingCaptures);
  if (duplicate) {
    return {
      updatedBlocks: currentBlocks,
      updatedCapture: {
        ...capture,
        syncState: "deduplicated",
        extractedSignal: {
          ...signal,
          deduplicatedWithCaptureId: duplicate.id,
        },
      },
    };
  }

  const targetDay = signal.proposedDayOffset ?? defaultTargetDayOffset;

  // Case 1: Specific meeting or informal meeting mention -> Solo Calendar Invite ("Just for me")
  if (signal.detectedKind === "meeting" && signal.proposedStartMinutes !== undefined) {
    const duration = roundTo15(signal.estimatedMinutes || 45);
    const newMeeting: CalendarBlock = {
      id: `blk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: signal.title,
      kind: "meeting",
      status: "auto-scheduled",
      dayOffset: targetDay,
      startMinutes: signal.proposedStartMinutes,
      durationMinutes: duration,
      sourceCaptureId: capture.id,
      sourceLabel: `${capture.appName} screenshot`,
      isRecurring: Boolean(signal.isRecurringMention),
      isSoloHold: Boolean(signal.isSoloInvite ?? true),
      locationOrUrl: signal.locationOrUrl,
      rationale: signal.isSoloInvite
        ? `Solo calendar invite created just for you from ${capture.appName}: "${signal.summary}"`
        : `Meeting extracted from ${capture.appName}: "${signal.summary}"`,
      confidence: 0.92,
    };

    const withMeeting = [...currentBlocks, newMeeting];
    const reconciled = reconcilePrepBlocks(withMeeting, rules, settings);

    return {
      updatedBlocks: reconciled,
      createdBlock: newMeeting,
      updatedCapture: {
        ...capture,
        syncState: "scheduled",
        extractedSignal: signal,
        createdBlockId: newMeeting.id,
      },
    };
  }

  // Case 2: Task / deliverable from Email or Slack -> Time-block onto open calendar slot based on availability + duration
  const { minutes: calibratedMinutes, appliedRule } = calibrateDuration(
    signal.title,
    signal.estimatedMinutes || 45,
    rules
  );

  const preferAfternoon = signal.detectedKind === "follow-up" || calibratedMinutes <= 30;

  let chosenDay = targetDay;
  let chosenStart = findOpenSlot({
    dayOffset: targetDay,
    durationMinutes: calibratedMinutes,
    blocks: currentBlocks,
    rules,
    settings,
    preferAfternoon,
  });

  if (chosenStart === null && targetDay === 0) {
    chosenDay = 1;
    chosenStart = findOpenSlot({
      dayOffset: 1,
      durationMinutes: calibratedMinutes,
      blocks: currentBlocks,
      rules,
      settings,
      preferAfternoon: false,
    });
  }

  const placedStart = chosenStart ?? settings.workdayEndMinutes - calibratedMinutes;
  const status = chosenStart !== null ? "auto-scheduled" : "needs-slot";

  const ruleNote = appliedRule
    ? ` Duration calibrated to ${formatDuration(calibratedMinutes)} via "${appliedRule.title}".`
    : "";
  const spilloverNote =
    chosenDay > targetDay
      ? " Today's open focus windows were full, so this was placed in Tomorrow's first available slot."
      : ` Placed into an open ${formatDuration(calibratedMinutes)} window based on your calendar availability.`;

  const newWorkBlock: CalendarBlock = {
    id: `blk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: signal.title,
    kind: signal.detectedKind === "follow-up" ? "follow-up" : "deep-work",
    status,
    dayOffset: chosenDay,
    startMinutes: placedStart,
    durationMinutes: calibratedMinutes,
    sourceCaptureId: capture.id,
    ruleId: appliedRule?.id,
    sourceLabel: `${capture.appName} screenshot`,
    rationale: `From ${capture.appName} (${signal.summary}).${ruleNote}${spilloverNote}`,
    confidence: 0.88,
  };

  const nextBlocks = [...currentBlocks, newWorkBlock].sort(
    (a, b) => a.dayOffset - b.dayOffset || a.startMinutes - b.startMinutes
  );

  return {
    updatedBlocks: nextBlocks,
    createdBlock: newWorkBlock,
    updatedCapture: {
      ...capture,
      syncState: "scheduled",
      extractedSignal: signal,
      createdBlockId: newWorkBlock.id,
    },
  };
}

/**
 * Parses natural-language feedback from the user's organizer discussion,
 * updates Standing Rules / calendar blocks, and returns a conversational summary.
 */
export function applyNaturalLanguageFeedback(params: {
  text: string;
  blocks: CalendarBlock[];
  rules: StandingRule[];
  settings: CaptureSettings;
}): {
  blocks: CalendarBlock[];
  rules: StandingRule[];
  settings: CaptureSettings;
  assistantReply: string;
  actionSummary: string;
} {
  const { text, blocks, rules, settings } = params;
  const lower = text.toLowerCase();

  // 1. Prep lead-time / duration feedback (e.g. "need at least 3 hours before recurring meetings" or "90 min prep before client calls")
  const hoursLeadMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:hour|hr|h)s?\s*(?:before|ahead|prior)/);
  const minsPrepMatch = lower.match(/(\d+)\s*(?:min|minute|m)s?\s*(?:of\s+)?prep/);
  const hoursPrepMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:hour|hr|h)s?\s*(?:of\s+)?prep/);

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
      lower.includes("recurring") || lower.includes("recurrent") || !lower.match(/for\s+[a-z]+/);

    const updatedRules = [...rules];
    if (isRecurringTarget) {
      const existingIdx = updatedRules.findIndex(
        (r) => r.category === "prep-time" && r.appliesToRecurring
      );
      if (existingIdx >= 0) {
        const prev = updatedRules[existingIdx];
        updatedRules[existingIdx] = {
          ...prev,
          enabled: true,
          minLeadMinutesBeforeMeeting: newLeadMinutes,
          prepDurationMinutes: newPrepDuration ?? prev.prepDurationMinutes ?? 90,
          title: `≥${formatDuration(newLeadMinutes)} runway before recurring meetings`,
          description: `Automatically reserve ${formatDuration(
            newPrepDuration ?? prev.prepDurationMinutes ?? 90
          )} of preparation finishing at least ${formatDuration(
            newLeadMinutes
          )} before any recurring meeting.`,
          createdFromFeedback: true,
        };
      } else {
        updatedRules.unshift({
          id: `rule-feedback-${Date.now()}`,
          title: `≥${formatDuration(newLeadMinutes)} runway before recurring meetings`,
          description: `Reserve ${formatDuration(
            newPrepDuration ?? 90
          )} of preparation at least ${formatDuration(newLeadMinutes)} ahead of recurring meetings.`,
          category: "prep-time",
          enabled: true,
          appliesToRecurring: true,
          prepDurationMinutes: newPrepDuration ?? 90,
          minLeadMinutesBeforeMeeting: newLeadMinutes,
          createdFromFeedback: true,
        });
      }
    } else {
      // Topic-specific prep rule (e.g., "for design / client / interview meetings")
      const topicMatch = lower.match(/(?:before|for)\s+([a-z0-9\s-]+?)(?:\s+meetings?|\s+calls?|\s+syncs?|$)/);
      const keyword = topicMatch?.[1]?.trim().split(/\s+/)[0] || "review";
      updatedRules.unshift({
        id: `rule-feedback-${Date.now()}`,
        title: `Prep before "${keyword}" meetings (≥${formatDuration(newLeadMinutes)} ahead)`,
        description: `Schedule ${formatDuration(
          newPrepDuration ?? 60
        )} of prep at least ${formatDuration(
          newLeadMinutes
        )} before meetings matching "${keyword}".`,
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
      assistantReply: `Got it — I saved this to your Standing Rules and re-ran your calendar prep blocks so recurring/matching meetings have ${formatDuration(
        newPrepDuration ?? 90
      )} of prep scheduled at least ${formatDuration(newLeadMinutes)} beforehand.`,
      actionSummary: `Updated Standing Rule (≥${formatDuration(newLeadMinutes)} lead prep) & re-balanced calendar`,
    };
  }

  // 2. Duration calibration feedback (e.g. "code reviews take 45 minutes" or "replies take 20m")
  const durationRuleMatch = lower.match(
    /([a-z\s]{3,28}?)\s+(?:usually\s+|always\s+|typically\s+)?(?:take|takes|need|needs)\s+(?:about\s+|around\s+)?(\d+)\s*(min|minute|m|hr|hour|h)/
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
      title: `Size "${rawTopic}" blocks to ${formatDuration(mins)}`,
      description: `Learned from your feedback: set matching calendar work blocks to ${formatDuration(
        mins
      )}.`,
      category: "duration-calibration",
      enabled: true,
      triggerPattern: keyword,
      fixedMinutesOverride: mins,
      createdFromFeedback: true,
    };

    const updatedBlocks = blocks.map((b) => {
      if (
        (b.kind === "deep-work" || b.kind === "follow-up") &&
        new RegExp(keyword, "i").test(b.title)
      ) {
        return {
          ...b,
          durationMinutes: mins,
          rationale: `${b.rationale} (Resized to ${formatDuration(mins)} from your feedback.)`,
        };
      }
      return b;
    });

    return {
      blocks: updatedBlocks,
      rules: [newRule, ...rules],
      settings,
      assistantReply: `Noted! Going forward I'll budget ${formatDuration(
        mins
      )} on your calendar whenever a screenshot surfaces "${rawTopic}", and I updated any matching blocks on your schedule.`,
      actionSummary: `Saved duration calibration: ${rawTopic} → ${formatDuration(mins)}`,
    };
  }

  // 3. Capture interval change via chat (e.g. "take screenshots every 5 minutes")
  const intervalMatch = lower.match(/every\s+(\d+)\s*(?:min|minute|m)/);
  if (intervalMatch && lower.includes("screenshot")) {
    const mins = Math.max(1, Math.min(30, Number(intervalMatch[1])));
    return {
      blocks,
      rules,
      settings: { ...settings, intervalMinutes: mins },
      assistantReply: `Updated your MacBook screenshot cadence to every ${mins} minute${
        mins === 1 ? "" : "s"
      }.`,
      actionSummary: `Capture interval set to ${mins}m`,
    };
  }

  // 4. Confirm / lock all auto-scheduled blocks
  if (lower.includes("confirm all") || lower.includes("looks good") || lower.includes("approve all")) {
    const confirmedCount = blocks.filter((b) => b.status === "auto-scheduled").length;
    return {
      blocks: blocks.map((b) =>
        b.status === "auto-scheduled" ? { ...b, status: "confirmed" } : b
      ),
      rules,
      settings,
      assistantReply: `Locked in all ${confirmedCount} auto-scheduled blocks on your calendar. You can export the .ics file straight into Apple Calendar anytime.`,
      actionSummary: `Confirmed ${confirmedCount} calendar blocks`,
    };
  }

  // 5. General natural-language preference note -> store as active rule memory & acknowledge
  const fallbackRule: StandingRule = {
    id: `rule-note-${Date.now()}`,
    title: text.length > 52 ? `${text.slice(0, 49)}...` : text,
    description: `Saved organizer preference from your discussion: "${text}"`,
    category: "availability",
    enabled: true,
    createdFromFeedback: true,
  };

  return {
    blocks,
    rules: [fallbackRule, ...rules],
    settings,
    assistantReply: `I've added "${fallbackRule.title}" to your Standing Rules memory so future email and Slack screenshots respect this preference when placing blocks on your calendar.`,
    actionSummary: "Added preference to Standing Rules memory",
  };
}
