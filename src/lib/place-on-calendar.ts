import {
  CalendarBlock,
  CalibrationSample,
  OrganizerSettings,
  StandingRule,
} from "./types";
import {
  addDaysToDateKey,
  findOpenSlot,
  formatDuration,
  formatMinutesToTime,
} from "./scheduler";

function roundTo15(mins: number): number {
  return Math.max(15, Math.round(mins / 15) * 15);
}

export function daysBetweenDateKeys(fromKey: string, toKey: string): number {
  const [y1, m1, d1] = fromKey.split("-").map(Number);
  const [y2, m2, d2] = toKey.split("-").map(Number);
  const a = new Date(y1, (m1 || 1) - 1, d1 || 1, 12).getTime();
  const b = new Date(y2, (m2 || 1) - 1, d2 || 1, 12).getTime();
  return Math.round((b - a) / 86400000);
}

export interface PlannedChunkSpec {
  label: string;
  durationMinutes: number;
  gutMinutes: number;
}

/**
 * Principle 5 ("Break it down" + "Planning a project is a task"):
 * Turns a single task or longstanding fellowship/paper/deadline into
 * realistic, human-sized 30–90m calendar blocks.
 */
export function buildProjectChunks(params: {
  title: string;
  calibratedTotalMinutes: number;
  gutTotalMinutes: number;
  milestoneLabels?: string[];
}): PlannedChunkSpec[] {
  const { title, calibratedTotalMinutes, gutTotalMinutes, milestoneLabels } =
    params;
  const cleanTitle = title.trim();
  const total = roundTo15(calibratedTotalMinutes);

  if (total <= 90 && (!milestoneLabels || milestoneLabels.length <= 1)) {
    return [
      {
        label: cleanTitle,
        durationMinutes: total,
        gutMinutes: roundTo15(gutTotalMinutes),
      },
    ];
  }

  const durations: number[] = [];
  let remaining = total;

  // Principle 5 Pro-Tip: For multi-hour projects (>= 3h), start with a dedicated 45m Scope & Plan block!
  const includeScopeSession = total >= 180 && (!milestoneLabels || milestoneLabels.length === 0);
  if (includeScopeSession) {
    durations.push(45);
    remaining -= 45;
  }

  while (remaining > 0) {
    if (remaining <= 90) {
      durations.push(roundTo15(remaining));
      remaining = 0;
    } else if (remaining === 105 || remaining === 120) {
      durations.push(60);
      remaining -= 60;
    } else {
      durations.push(90);
      remaining -= 90;
    }
  }

  const count = durations.length;
  const gutShare = Math.max(15, Math.round(gutTotalMinutes / count));

  const defaultPhaseNames = (idx: number, n: number): string => {
    if (includeScopeSession && idx === 0) {
      return `${cleanTitle} — Scope & Plan (1/${n})`;
    }
    if (idx === n - 1 && n >= 3) {
      return `${cleanTitle} — Final Polish & Buffer (${idx + 1}/${n})`;
    }
    if (idx === 1 && includeScopeSession && n >= 4) {
      return `${cleanTitle} — Core Draft (${idx + 1}/${n})`;
    }
    return `${cleanTitle} (${idx + 1}/${n})`;
  };

  return durations.map((dur, idx) => {
    const custom = milestoneLabels?.[idx]?.trim();
    const label = custom
      ? count > 1
        ? `${cleanTitle}: ${custom} (${idx + 1}/${count})`
        : `${cleanTitle}: ${custom}`
      : defaultPhaseNames(idx, count);
    return {
      label,
      durationMinutes: dur,
      gutMinutes: gutShare,
    };
  });
}

/**
 * Principle 1, 2, 5 & 6:
 * Places a single task OR multi-segment backtracked deadline directly onto the calendar,
 * pacing multi-segment projects across available days and warning immediately if physical
 * calendar space is tighter than the deadline!
 */
export function scheduleTaskOntoCalendar(params: {
  title: string;
  gutMinutes: number;
  applyMultiplier?: boolean;
  deadlineDateKey?: string;
  milestoneLabels?: string[];
  sourceLabel?: string;
  blocks: CalendarBlock[];
  rules: StandingRule[];
  settings: OrganizerSettings;
  todayKey: string;
}): {
  blocks: CalendarBlock[];
  created: CalendarBlock[];
  note: string;
  scarcityWarning?: string;
} {
  const {
    title,
    gutMinutes,
    applyMultiplier = true,
    deadlineDateKey,
    milestoneLabels,
    sourceLabel = "Dashboard",
    rules,
    settings,
    todayKey,
  } = params;

  const multiplier =
    applyMultiplier && settings.calibrationMultiplier > 0
      ? settings.calibrationMultiplier
      : 1;
  const budget = roundTo15(Math.max(15, gutMinutes * multiplier));
  const chunkSpecs = buildProjectChunks({
    title,
    calibratedTotalMinutes: budget,
    gutTotalMinutes: gutMinutes,
    milestoneLabels,
  });

  const daysUntilDeadline = deadlineDateKey
    ? daysBetweenDateKeys(todayKey, deadlineDateKey)
    : 28;

  if (deadlineDateKey && daysUntilDeadline < 0) {
    return {
      blocks: params.blocks,
      created: [],
      note: `Deadline ${deadlineDateKey} is already in the past — pick an upcoming date or leave deadline blank.`,
      scarcityWarning: `Deadline ${deadlineDateKey} has passed.`,
    };
  }

  // Principle 6 ("Backtrack. Foresee. Leave pre-deadline crunch buffer"):
  // For big deadlines >= 7 days away, aim to finish 2 days BEFORE the deadline day!
  // For shorter deadlines >= 2 days away, finish at least 1 day before the deadline day.
  const preDeadlineCushionDays =
    deadlineDateKey && chunkSpecs.length > 1
      ? daysUntilDeadline >= 7
        ? 2
        : daysUntilDeadline >= 2
          ? 1
          : 0
      : 0;

  const idealLastDayOffset = Math.max(
    0,
    daysUntilDeadline - preDeadlineCushionDays
  );
  const hardLastDayOffset = Math.max(0, daysUntilDeadline);

  const projectGroupId =
    chunkSpecs.length > 1 ? `proj-${Date.now()}` : undefined;

  let working = [...params.blocks];
  const created: CalendarBlock[] = [];
  const blocksPerDayCount = new Map<string, number>();

  for (let idx = 0; idx < chunkSpecs.length; idx++) {
    const spec = chunkSpecs[idx];
    let placedBlock: CalendarBlock | null = null;

    // Pass 1: Pace nicely (at most 1 segment per day when runway allows) within ideal pre-deadline cushion
    // Pass 2: Allow up to 2 segments per day within ideal cushion
    // Pass 3: Use pre-deadline cushion days (up to hardLastDayOffset) + weekends if deadline forces it
    const passes: Array<{
      maxDayOffset: number;
      maxSegmentsPerDay: number;
      allowWeekend: boolean;
    }> = [
      {
        maxDayOffset: idealLastDayOffset,
        maxSegmentsPerDay: 1,
        allowWeekend: false,
      },
      {
        maxDayOffset: idealLastDayOffset,
        maxSegmentsPerDay: 2,
        allowWeekend: false,
      },
      {
        maxDayOffset: hardLastDayOffset,
        maxSegmentsPerDay: 4,
        allowWeekend: Boolean(deadlineDateKey),
      },
    ];

    for (const pass of passes) {
      if (placedBlock) break;
      for (let day = 0; day <= pass.maxDayOffset; day++) {
        const dateKey = addDaysToDateKey(todayKey, day);
        const usedToday = blocksPerDayCount.get(dateKey) ?? 0;
        if (usedToday >= pass.maxSegmentsPerDay) continue;

        const slot = findOpenSlot({
          dateKey,
          durationMinutes: spec.durationMinutes,
          blocks: working,
          rules,
          settings,
          allowWeekend: pass.allowWeekend,
        });
        if (slot === null) continue;

        placedBlock = {
          id: `task-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
          title: spec.label,
          kind: spec.durationMinutes <= 30 ? "follow-up" : "deep-work",
          status: "confirmed",
          dateKey,
          startMinutes: slot,
          durationMinutes: spec.durationMinutes,
          gutMinutes: spec.gutMinutes,
          deadlineDateKey,
          projectGroupId,
          calendarId: settings.writableCalendarId,
          calendarTitle: settings.writableCalendarTitle,
          isDayframeCreated: true,
          sourceLabel,
          rationale: deadlineDateKey
            ? `Backtracked before ${deadlineDateKey}${
                preDeadlineCushionDays > 0
                  ? ` (${preDeadlineCushionDays}d pre-deadline buffer)`
                  : ""
              } • ${
                applyMultiplier
                  ? `Gut ×${settings.calibrationMultiplier}`
                  : "Exact duration"
              }.`
            : `${
                applyMultiplier
                  ? `Gut ${formatDuration(spec.gutMinutes)} × ${settings.calibrationMultiplier} = ${formatDuration(spec.durationMinutes)}`
                  : `Exact ${formatDuration(spec.durationMinutes)} block`
              } in open calendar space.`,
          confidence: 1,
        };

        blocksPerDayCount.set(dateKey, usedToday + 1);
        working = [...working, placedBlock].sort(
          (a, b) =>
            a.dateKey.localeCompare(b.dateKey) ||
            a.startMinutes - b.startMinutes
        );
        created.push(placedBlock);
        break;
      }
    }
  }

  if (created.length === 0) {
    const warn = deadlineDateKey
      ? `Calendar Reality Check: 0 open slots fit before ${deadlineDateKey} once meetings, travel/busy days, and daily buffers are respected.`
      : "No open slots found in the next 4 weeks.";
    return {
      blocks: working,
      created,
      note: warn,
      scarcityWarning: warn,
    };
  }

  const first = created[0];
  const last = created[created.length - 1];
  const placedMinutes = created.reduce((sum, b) => sum + b.durationMinutes, 0);
  const unplacedMinutes = Math.max(0, budget - placedMinutes);

  let scarcityWarning: string | undefined;
  if (unplacedMinutes > 0) {
    scarcityWarning = `Foresee Crunch: Only ${formatDuration(
      placedMinutes
    )} of ${formatDuration(budget)} physically fit before ${
      deadlineDateKey || "4 weeks"
    } — ${formatDuration(
      unplacedMinutes
    )} overflows! Consider moving lower-priority commitments.`;
  }

  const spanNote =
    created.length > 1
      ? ` across ${created.length} blocks (${first.dateKey} → ${last.dateKey})`
      : ` on ${first.dateKey} at ${formatMinutesToTime(first.startMinutes)}`;

  const note = `Scheduled ${formatDuration(placedMinutes)} on ${settings.writableCalendarTitle}${spanNote}.${
    scarcityWarning ? ` ${scarcityWarning}` : ""
  }`;

  return { blocks: working, created, note, scarcityWarning };
}

/**
 * Principle 4 ("Go to bed with an empty to-do calendar for the day. Re-planning is part of the plan."):
 * Collects unfinished Dayframe task/prep blocks from past days AND earlier today (whose time window
 * has already passed), prioritizes deadline-bound blocks first, and moves them into fresh open slots.
 */
export function takeOverdueWorkForward(params: {
  blocks: CalendarBlock[];
  rules: StandingRule[];
  settings: OrganizerSettings;
  todayKey: string;
  nowMinutes?: number;
}): { blocks: CalendarBlock[]; moved: CalendarBlock[]; removedIds: string[] } {
  const { rules, settings, todayKey } = params;
  const now = new Date();
  const currentMins =
    params.nowMinutes ?? now.getHours() * 60 + now.getMinutes();

  const unfinished = params.blocks
    .filter((b) => {
      if (!b.isDayframeCreated || b.done || b.occupiesTimeOnly) return false;
      if (b.kind === "meeting" && !b.isSoloHold) return false;
      if (b.dateKey < todayKey) return true;
      if (b.dateKey === todayKey && b.startMinutes + b.durationMinutes <= currentMins) {
        return true;
      }
      return false;
    })
    .sort((a, b) => {
      // Principle 4: "Some tasks if not done are more likely to cause stress and drama. Get those done first."
      if (a.deadlineDateKey && !b.deadlineDateKey) return -1;
      if (!a.deadlineDateKey && b.deadlineDateKey) return 1;
      if (a.deadlineDateKey && b.deadlineDateKey) {
        const cmp = a.deadlineDateKey.localeCompare(b.deadlineDateKey);
        if (cmp !== 0) return cmp;
      }
      return (
        a.dateKey.localeCompare(b.dateKey) || a.startMinutes - b.startMinutes
      );
    });

  if (unfinished.length === 0) {
    return { blocks: params.blocks, moved: [], removedIds: [] };
  }

  const unfinishedIds = new Set(unfinished.map((u) => u.id));
  let working = params.blocks.filter((b) => !unfinishedIds.has(b.id));
  const moved: CalendarBlock[] = [];

  for (const old of unfinished) {
    let placed: CalendarBlock | null = null;
    for (let day = 0; day <= 21; day++) {
      const targetDate = addDaysToDateKey(todayKey, day);
      if (old.deadlineDateKey && targetDate > old.deadlineDateKey && day > 0) {
        // Still place on earliest possible slot even if past deadline so nothing is dropped!
      }
      const slot = findOpenSlot({
        dateKey: targetDate,
        durationMinutes: old.durationMinutes,
        blocks: working,
        rules,
        settings,
      });
      if (slot === null) continue;

      placed = {
        ...old,
        id: `replan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        dateKey: targetDate,
        startMinutes: slot,
        syncedToExternalCalendar: false,
        externalEventId: undefined,
        rationale: `Re-planned forward from ${old.dateKey} (${formatMinutesToTime(
          old.startMinutes
        )}) — clean slate for the day.`,
      };
      working = [...working, placed].sort(
        (a, b) =>
          a.dateKey.localeCompare(b.dateKey) || a.startMinutes - b.startMinutes
      );
      moved.push(placed);
      break;
    }
  }

  return {
    blocks: working,
    moved,
    removedIds: unfinished.map((b) => b.id),
  };
}

/**
 * Principle 4 Pro-Tip ("If you run out of tasks before your day ends, look ahead
 * and consider getting a task from the future done. Future you will appreciate the buffer!"):
 */
export function pullNextFutureTaskIntoToday(params: {
  blocks: CalendarBlock[];
  rules: StandingRule[];
  settings: OrganizerSettings;
  todayKey: string;
}): {
  blocks: CalendarBlock[];
  pulled?: CalendarBlock;
  removedOldId?: string;
  oldExternalEventId?: string;
} {
  const { blocks, rules, settings, todayKey } = params;
  const futureTasks = blocks
    .filter(
      (b) =>
        b.isDayframeCreated &&
        !b.done &&
        !b.occupiesTimeOnly &&
        b.dateKey > todayKey &&
        (b.kind === "deep-work" || b.kind === "follow-up")
    )
    .sort(
      (a, b) =>
        a.dateKey.localeCompare(b.dateKey) || a.startMinutes - b.startMinutes
    );

  for (const candidate of futureTasks) {
    const withoutCandidate = blocks.filter((b) => b.id !== candidate.id);
    const todaySlot = findOpenSlot({
      dateKey: todayKey,
      durationMinutes: candidate.durationMinutes,
      blocks: withoutCandidate,
      rules,
      settings,
      ignoreDailyBuffer: true,
    });
    if (todaySlot !== null) {
      const pulled: CalendarBlock = {
        ...candidate,
        id: `pull-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        dateKey: todayKey,
        startMinutes: todaySlot,
        syncedToExternalCalendar: false,
        externalEventId: undefined,
        rationale: `Pulled forward from ${candidate.dateKey} into open space today — extra buffer for future you.`,
      };
      return {
        blocks: [...withoutCandidate, pulled].sort(
          (a, b) =>
            a.dateKey.localeCompare(b.dateKey) ||
            a.startMinutes - b.startMinutes
        ),
        pulled,
        removedOldId: candidate.id,
        oldExternalEventId: candidate.externalEventId,
      };
    }
  }

  return { blocks };
}

/**
 * Principle 2 ("Measure how wrong your time estimates are — incorporate your calibration multiplier"):
 */
export function computeMeasuredMultiplier(
  samples: CalibrationSample[]
): { measured: number | null; sampleCount: number } {
  if (!samples || samples.length === 0) {
    return { measured: null, sampleCount: 0 };
  }
  let totalGut = 0;
  let totalActual = 0;
  for (const s of samples.slice(0, 30)) {
    if (s.gutMinutes > 0 && s.actualMinutes > 0) {
      totalGut += s.gutMinutes;
      totalActual += s.actualMinutes;
    }
  }
  if (totalGut <= 0) return { measured: null, sampleCount: 0 };
  const raw = totalActual / totalGut;
  const clamped = Math.round(Math.max(0.75, Math.min(3.0, raw)) * 100) / 100;
  return { measured: clamped, sampleCount: samples.length };
}

/**
 * Schedules a recurring weekly budget across N upcoming weeks with clean canonical naming!
 * Example: "AIIM Fellowship" — 120m/week for 2 weeks -> places 2x60m (or 1x90m+30m) in Week 1 and Week 2.
 */
export function scheduleWeeklyCadenceOntoCalendar(params: {
  canonicalTitle: string;
  minutesPerWeek: number;
  weeksCount: number;
  taskModelId?: string;
  notes?: string;
  blocks: CalendarBlock[];
  rules: StandingRule[];
  settings: OrganizerSettings;
  todayKey: string;
}): {
  blocks: CalendarBlock[];
  created: CalendarBlock[];
  note: string;
} {
  const {
    canonicalTitle,
    minutesPerWeek,
    weeksCount,
    taskModelId,
    notes,
    rules,
    settings,
    todayKey,
  } = params;

  let working = [...params.blocks];
  const created: CalendarBlock[] = [];
  const projectGroupId = `wkproj-${Date.now()}`;

  // Break each week's budget into clean 60m-90m blocks (e.g. 120m -> two 60m blocks)
  const weeklyChunks: number[] = [];
  let rem = roundTo15(minutesPerWeek);
  if (rem === 120) {
    weeklyChunks.push(60, 60);
  } else {
    while (rem > 0) {
      const sz = rem > 90 ? (rem >= 150 ? 90 : 60) : rem;
      weeklyChunks.push(roundTo15(sz));
      rem -= sz;
    }
  }

  for (let w = 0; w < weeksCount; w++) {
    const weekStartOffset = w * 7;
    const weekEndOffset = weekStartOffset + 6;
    const usedDaysInWeek = new Set<string>();

    weeklyChunks.forEach((chunkMins, cIdx) => {
      let placed = false;
      for (const allowSameDay of [false, true]) {
        if (placed) break;
        for (let d = weekStartOffset; d <= weekEndOffset; d++) {
          const dateKey = addDaysToDateKey(todayKey, d);
          if (!allowSameDay && usedDaysInWeek.has(dateKey)) continue;

          const slot = findOpenSlot({
            dateKey,
            durationMinutes: chunkMins,
            blocks: working,
            rules,
            settings,
          });
          if (slot === null) continue;

          const blockTitle =
            weeklyChunks.length > 1
              ? `${canonicalTitle} — Wk ${w + 1} (${cIdx + 1}/${weeklyChunks.length})`
              : weeksCount > 1
                ? `${canonicalTitle} — Wk ${w + 1}`
                : canonicalTitle;

          const blk: CalendarBlock = {
            id: `wk-${Date.now()}-${w}-${cIdx}-${Math.random().toString(36).slice(2, 5)}`,
            title: blockTitle,
            kind: "deep-work",
            status: "confirmed",
            dateKey,
            startMinutes: slot,
            durationMinutes: chunkMins,
            gutMinutes: chunkMins,
            projectGroupId,
            taskModelId,
            notes,
            calendarId: settings.writableCalendarId,
            calendarTitle: settings.writableCalendarTitle,
            isDayframeCreated: true,
            sourceLabel: "Weekly Cadence",
            rationale: `${formatDuration(minutesPerWeek)}/week for ${weeksCount} week${
              weeksCount === 1 ? "" : "s"
            } (Week ${w + 1} of ${weeksCount}).`,
            confidence: 1,
          };

          usedDaysInWeek.add(dateKey);
          working = [...working, blk].sort(
            (a, b) =>
              a.dateKey.localeCompare(b.dateKey) ||
              a.startMinutes - b.startMinutes
          );
          created.push(blk);
          placed = true;
          break;
        }
      }
    });
  }

  if (created.length === 0) {
    return {
      blocks: working,
      created,
      note: `Could not find open space over the next ${weeksCount} weeks.`,
    };
  }

  return {
    blocks: working,
    created,
    note: `Scheduled "${canonicalTitle}" (${formatDuration(
      minutesPerWeek
    )}/week × ${weeksCount} weeks → ${created.length} blocks) on ${
      settings.writableCalendarTitle
    }.`,
  };
}

/**
 * Schedules N blocks of M minutes specifically linked to a target event
 * (e.g. "add two one-hour blocks to prepare for this anytime from today until the meeting time").
 */
export function scheduleBlocksForTargetEvent(params: {
  targetEvent: CalendarBlock;
  count: number;
  durationMinutesEach: number;
  beforeEventTime: boolean;
  blocks: CalendarBlock[];
  rules: StandingRule[];
  settings: OrganizerSettings;
  todayKey: string;
}): {
  blocks: CalendarBlock[];
  created: CalendarBlock[];
  note: string;
} {
  const {
    targetEvent,
    count,
    durationMinutesEach,
    beforeEventTime,
    rules,
    settings,
    todayKey,
  } = params;

  const cleanParent = targetEvent.title
    .replace(/^\[(Prep|Task|Focus|Solo Hold)\]\s+/i, "")
    .trim();
  let working = [...params.blocks];
  const created: CalendarBlock[] = [];
  const usedDays = new Set<string>();

  const maxDaySpan = beforeEventTime
    ? Math.max(0, daysBetweenDateKeys(todayKey, targetEvent.dateKey))
    : 14;

  for (let i = 0; i < count; i++) {
    let placed = false;

    // Pass 1: Spread across distinct days before the meeting; Pass 2: Allow multiple blocks on same day; Pass 3: Relax daily buffer/weekends if tight
    const passes = [
      { distinctDay: true, relax: false },
      { distinctDay: false, relax: false },
      { distinctDay: false, relax: true },
    ];

    for (const pass of passes) {
      if (placed) break;
      for (let d = 0; d <= maxDaySpan; d++) {
        const dateKey = beforeEventTime
          ? addDaysToDateKey(todayKey, d)
          : addDaysToDateKey(
              targetEvent.dateKey > todayKey ? targetEvent.dateKey : todayKey,
              d
            );
        if (pass.distinctDay && usedDays.has(dateKey)) continue;

        const isEventDay = beforeEventTime && dateKey === targetEvent.dateKey;
        const finishCutoff = isEventDay
          ? Math.max(settings.workdayStartMinutes, targetEvent.startMinutes - 15)
          : undefined;

        if (
          isEventDay &&
          finishCutoff !== undefined &&
          finishCutoff - settings.workdayStartMinutes < durationMinutesEach
        ) {
          continue;
        }

        const slot = findOpenSlot({
          dateKey,
          durationMinutes: durationMinutesEach,
          blocks: working,
          rules,
          settings,
          mustFinishByMinutes: finishCutoff,
          allowWeekend: pass.relax,
          ignoreDailyBuffer: pass.relax || isEventDay,
          allowEarlyMorning: isEventDay,
        });
        if (slot === null) continue;

        const label =
          count > 1
            ? `Prep: ${cleanParent} (${i + 1}/${count})`
            : `Prep: ${cleanParent}`;

        const blk: CalendarBlock = {
          id: `evprep-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
          title: label,
          kind: "prep",
          status: "confirmed",
          dateKey,
          startMinutes: slot,
          durationMinutes: durationMinutesEach,
          gutMinutes: durationMinutesEach,
          linkedMeetingId: targetEvent.id,
          taskModelId: targetEvent.taskModelId,
          calendarId: settings.writableCalendarId,
          calendarTitle: settings.writableCalendarTitle,
          isDayframeCreated: true,
          sourceLabel: `Event Chat (${cleanParent})`,
          rationale: `Scheduled for "${cleanParent}" (${targetEvent.dateKey} at ${formatMinutesToTime(
            targetEvent.startMinutes
          )}).`,
          confidence: 1,
        };

        usedDays.add(dateKey);
        working = [...working, blk].sort(
          (a, b) =>
            a.dateKey.localeCompare(b.dateKey) ||
            a.startMinutes - b.startMinutes
        );
        created.push(blk);
        placed = true;
        break;
      }
    }
  }

  if (created.length === 0) {
    return {
      blocks: working,
      created,
      note: beforeEventTime
        ? `No open ${formatDuration(durationMinutesEach)} slots available between now and "${cleanParent}" (${targetEvent.dateKey} ${formatMinutesToTime(targetEvent.startMinutes)}).`
        : `No open ${formatDuration(durationMinutesEach)} slots found.`,
    };
  }

  const slotSummary = created
    .map((c) => `${c.dateKey} ${formatMinutesToTime(c.startMinutes)}`)
    .join(", ");

  return {
    blocks: working,
    created,
    note: `Added ${created.length}/${count} block${
      created.length === 1 ? "" : "s"
    } (${formatDuration(durationMinutesEach)} each: ${slotSummary}) onto ${
      settings.writableCalendarTitle
    }.`,
  };
}

export interface CompiledSessionSpec {
  sessionTitle: string;
  durationMinutes: number;
  earliestDateKey: string;
  latestDateKey: string;
  mustFinishBeforeMinutes?: number;
  preferredTimeOfDay?: "morning" | "afternoon" | "any";
  kind?: "prep" | "deep-work" | "follow-up";
}

/**
 * Constraint-verified placement engine for Gemma 4's structured CompiledSessionSpec[].
 * Gemma 4 handles open-ended natural language, canonical naming, cadence, and day-of-week windows;
 * this solver guarantees zero double-booking, buffer protection, and strict UMich calendar targeting.
 */
export function placeCompiledSessionsOntoCalendar(params: {
  canonicalTitle: string;
  sessions: CompiledSessionSpec[];
  taskModelId?: string;
  linkedMeetingId?: string;
  deadlineDateKey?: string;
  notes?: string;
  sourceLabel?: string;
  blocks: CalendarBlock[];
  rules: StandingRule[];
  settings: OrganizerSettings;
  todayKey: string;
}): {
  blocks: CalendarBlock[];
  created: CalendarBlock[];
  note: string;
  scarcityWarning?: string;
} {
  const {
    canonicalTitle,
    sessions,
    taskModelId,
    linkedMeetingId,
    deadlineDateKey,
    notes,
    sourceLabel = "Gemma 4 Planner",
    rules,
    settings,
    todayKey,
  } = params;

  let working = [...params.blocks];
  const created: CalendarBlock[] = [];
  const usedDays = new Set<string>();
  const projectGroupId =
    sessions.length > 1 ? `gproj-${Date.now()}` : undefined;

  let requestedTotalMins = 0;

  for (let i = 0; i < sessions.length; i++) {
    const spec = sessions[i];
    const dur = roundTo15(Math.max(15, Math.min(180, spec.durationMinutes || 60)));
    requestedTotalMins += dur;

    const startKey =
      spec.earliestDateKey && spec.earliestDateKey >= todayKey
        ? spec.earliestDateKey
        : todayKey;
    const endKey =
      spec.latestDateKey && spec.latestDateKey >= startKey
        ? spec.latestDateKey
        : addDaysToDateKey(startKey, 14);
    const spanDays = Math.max(0, Math.min(45, daysBetweenDateKeys(startKey, endKey)));

    const preferAfternoon = spec.preferredTimeOfDay === "afternoon";
    const morningCutoff =
      spec.preferredTimeOfDay === "morning" ? 13 * 60 : undefined;

    let placed = false;
    const passes = [
      { distinctDay: true, relax: false, strictTimePref: true },
      { distinctDay: false, relax: false, strictTimePref: false },
      { distinctDay: false, relax: true, strictTimePref: false },
    ];

    for (const pass of passes) {
      if (placed) break;
      for (let d = 0; d <= spanDays; d++) {
        const dateKey = addDaysToDateKey(startKey, d);
        if (pass.distinctDay && usedDays.has(dateKey)) continue;

        const isCutoffDay =
          spec.mustFinishBeforeMinutes !== undefined && dateKey === endKey;
        const finishCap = isCutoffDay
          ? spec.mustFinishBeforeMinutes
          : pass.strictTimePref && morningCutoff
            ? morningCutoff
            : undefined;

        const slot = findOpenSlot({
          dateKey,
          durationMinutes: dur,
          blocks: working,
          rules,
          settings,
          mustFinishByMinutes: finishCap,
          preferAfternoon,
          allowWeekend: pass.relax || startKey === endKey,
          ignoreDailyBuffer: pass.relax || isCutoffDay,
          allowEarlyMorning: isCutoffDay,
        });
        if (slot === null) continue;

        const blk: CalendarBlock = {
          id: `gblk-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
          title: spec.sessionTitle.trim() || canonicalTitle,
          kind:
            spec.kind ||
            (linkedMeetingId ? "prep" : dur <= 30 ? "follow-up" : "deep-work"),
          status: "confirmed",
          dateKey,
          startMinutes: slot,
          durationMinutes: dur,
          gutMinutes: dur,
          deadlineDateKey,
          projectGroupId,
          taskModelId,
          linkedMeetingId,
          notes,
          calendarId: settings.writableCalendarId,
          calendarTitle: settings.writableCalendarTitle,
          isDayframeCreated: true,
          sourceLabel,
          rationale: `Scheduled for "${canonicalTitle}" (${startKey}${
            endKey !== startKey ? ` → ${endKey}` : ""
          }).`,
          confidence: 0.95,
        };

        usedDays.add(dateKey);
        working = [...working, blk].sort(
          (a, b) =>
            a.dateKey.localeCompare(b.dateKey) ||
            a.startMinutes - b.startMinutes
        );
        created.push(blk);
        placed = true;
        break;
      }
    }
  }

  if (created.length === 0) {
    const msg = `No open space matched the requested window for "${canonicalTitle}".`;
    return { blocks: working, created, note: msg, scarcityWarning: msg };
  }

  const placedMins = created.reduce((s, b) => s + b.durationMinutes, 0);
  const overflow = Math.max(0, requestedTotalMins - placedMins);
  const scarcityWarning =
    overflow > 0
      ? `Only ${formatDuration(placedMins)} of ${formatDuration(
          requestedTotalMins
        )} physically fit in the requested window.`
      : undefined;

  const summary =
    created.length === 1
      ? `Scheduled "${created[0].title}" on ${created[0].dateKey} at ${formatMinutesToTime(
          created[0].startMinutes
        )} (${formatDuration(created[0].durationMinutes)}).`
      : `Scheduled ${created.length} blocks (${formatDuration(
          placedMins
        )}) for "${canonicalTitle}" (${created[0].dateKey} → ${
          created[created.length - 1].dateKey
        }).`;

  return {
    blocks: working,
    created,
    note: scarcityWarning ? `${summary} ${scarcityWarning}` : summary,
    scarcityWarning,
  };
}


