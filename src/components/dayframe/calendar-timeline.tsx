"use client";

import React, { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CalendarBlock,
  OrganizerSettings,
  ScreenshotCapture,
  StandingRule,
} from "@/lib/types";
import {
  addDaysToDateKey,
  formatDateKeyLabel,
  formatDuration,
  formatMinutesToTime,
  getBusyRangeForDate,
  getProtectedIntervals,
  isWeekendDateKey,
} from "@/lib/scheduler";
import {
  ArrowRight,
  Calendar,
  CalendarCheck,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Minus,
  Plus,
  RefreshCw,
  Repeat,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
} from "lucide-react";

interface CalendarTimelineProps {
  todayKey: string;
  anchorDateKey: string;
  onChangeAnchorDateKey: (dateKey: string) => void;
  horizonDays: 2 | 7;
  onChangeHorizonDays: (days: 2 | 7) => void;
  blocks: CalendarBlock[];
  captures: ScreenshotCapture[];
  rules: StandingRule[];
  settings: OrganizerSettings;
  selectedBlockId: string | null;
  onSelectBlockId: (id: string | null) => void;
  onConfirmAndSyncBlock: (id: string) => void;
  onConfirmAndSyncAllAutoBlocks: () => void;
  onToggleBlockDone: (id: string, actualMinutesOverride?: number) => void;
  onAdjustBlockDuration: (
    id: string,
    deltaMinutes: number,
    saveRule: boolean
  ) => void;
  onMoveBlockToNextSlot: (id: string) => void;
  onShiftBlockDate: (id: string, deltaDays: number) => void;
  onDeleteBlock: (id: string) => void;
  onRunCalendarScanNow: () => void;
  onOpenCalendarScope: () => void;
}

const GRID_START_MIN = 8 * 60;
const GRID_END_MIN = 19 * 60;
const PX_PER_MINUTE = 0.96;

/**
 * Principle 7 visual language:
 * - Blue   = Meetings (confirmed interpersonal / external events)
 * - Orange = Tasks & Backtracked Project/Fellowship Segments
 * - Green  = Buffers, Protected Rhythm & Meeting Prep (>=2h ahead)
 * - Done   = Checked emerald completed state
 */
function getBlockColors(block: CalendarBlock) {
  if (block.done) {
    return {
      card: "border-emerald-600/40 bg-emerald-500/10 text-emerald-950/80 dark:text-emerald-100/80",
      pill: "bg-emerald-600/20 text-emerald-900 dark:text-emerald-200",
      label: "Done",
    };
  }
  if (block.occupiesTimeOnly) {
    return {
      card: "border-sky-400/35 bg-sky-500/8 text-foreground/85 hover:border-sky-500/60",
      pill: "bg-sky-500/15 text-sky-900 dark:text-sky-200",
      label: "Busy",
    };
  }
  if (block.kind === "prep") {
    return {
      card: "border-emerald-500/55 bg-emerald-500/14 text-emerald-950 hover:border-emerald-500 dark:text-emerald-100",
      pill: "bg-emerald-500/25 text-emerald-900 dark:text-emerald-200",
      label: "Prep",
    };
  }
  if (block.kind === "deep-work" || block.kind === "follow-up") {
    return {
      card: "border-orange-500/55 bg-orange-500/15 text-orange-950 hover:border-orange-500 dark:text-orange-100",
      pill: "bg-orange-500/25 text-orange-900 dark:text-orange-200",
      label: block.projectGroupId ? "Segment" : "Task",
    };
  }
  return {
    card: "border-sky-500/55 bg-sky-500/14 text-sky-950 hover:border-sky-500 dark:text-sky-100",
    pill: "bg-sky-500/25 text-sky-900 dark:text-sky-200",
    label: block.isSoloHold ? "Solo Hold" : "Meeting",
  };
}

function formatCompactDayHeader(dateKey: string, todayKey: string): string {
  const tomorrowKey = addDaysToDateKey(todayKey, 1);
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
  const label = dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
  if (dateKey === todayKey) return `Today · ${label}`;
  if (dateKey === tomorrowKey) return `Tmrw · ${label}`;
  return label;
}

export function CalendarTimeline({
  todayKey,
  anchorDateKey,
  onChangeAnchorDateKey,
  horizonDays,
  onChangeHorizonDays,
  blocks,
  captures,
  rules,
  settings,
  selectedBlockId,
  onSelectBlockId,
  onConfirmAndSyncBlock,
  onConfirmAndSyncAllAutoBlocks,
  onToggleBlockDone,
  onAdjustBlockDuration,
  onMoveBlockToNextSlot,
  onShiftBlockDate,
  onDeleteBlock,
  onRunCalendarScanNow,
  onOpenCalendarScope,
}: CalendarTimelineProps) {
  const visibleDateKeys = useMemo(() => {
    const start = anchorDateKey || todayKey;
    if (!start) return [];
    const list: string[] = [];
    for (let i = 0; i < horizonDays; i++) {
      list.push(addDaysToDateKey(start, i));
    }
    return list;
  }, [anchorDateKey, horizonDays, todayKey]);

  const hours = useMemo(() => {
    const arr: number[] = [];
    for (let m = GRID_START_MIN; m <= GRID_END_MIN; m += 60) arr.push(m);
    return arr;
  }, []);

  const protectedIntervals = useMemo(() => {
    const base = [...getProtectedIntervals(rules)];
    if (settings.notAMorningPersonUntilMinutes > settings.workdayStartMinutes) {
      base.push({
        startMinutes: settings.workdayStartMinutes,
        endMinutes: settings.notAMorningPersonUntilMinutes,
        label: "Protected Morning",
      });
    }
    if (settings.dailyBufferMinutes > 0) {
      base.push({
        startMinutes: Math.max(
          settings.workdayStartMinutes,
          settings.workdayEndMinutes - settings.dailyBufferMinutes
        ),
        endMinutes: settings.workdayEndMinutes,
        label: "Daily Buffer",
      });
    }
    return base;
  }, [
    rules,
    settings.dailyBufferMinutes,
    settings.notAMorningPersonUntilMinutes,
    settings.workdayEndMinutes,
    settings.workdayStartMinutes,
  ]);

  const selectedBlock = useMemo(
    () => blocks.find((b) => b.id === selectedBlockId) ?? null,
    [blocks, selectedBlockId]
  );

  const linkedCapture = useMemo(() => {
    if (!selectedBlock?.sourceCaptureId) return null;
    return captures.find((c) => c.id === selectedBlock.sourceCaptureId) ?? null;
  }, [captures, selectedBlock]);

  // Principle 7: Compute visible load & Tomorrow's preview so finite space is unmistakable
  const loadSummary = useMemo(() => {
    const visibleSet = new Set(visibleDateKeys);
    let meetingMins = 0;
    let taskMins = 0;
    let prepMins = 0;
    let doneCount = 0;

    for (const b of blocks) {
      if (!visibleSet.has(b.dateKey)) continue;
      if (b.done) doneCount++;
      if (b.kind === "prep") prepMins += b.durationMinutes;
      else if (b.kind === "deep-work" || b.kind === "follow-up")
        taskMins += b.durationMinutes;
      else meetingMins += b.durationMinutes;
    }

    const tomorrowKey = todayKey ? addDaysToDateKey(todayKey, 1) : "";
    const tmrwBlocks = blocks.filter((b) => b.dateKey === tomorrowKey);
    const tmrwMeetingMins = tmrwBlocks
      .filter((b) => b.kind === "meeting")
      .reduce((s, b) => s + b.durationMinutes, 0);
    const tmrwTaskMins = tmrwBlocks
      .filter((b) => b.kind !== "meeting")
      .reduce((s, b) => s + b.durationMinutes, 0);

    return {
      meetingMins,
      taskMins,
      prepMins,
      doneCount,
      tmrwMeetingMins,
      tmrwTaskMins,
    };
  }, [blocks, todayKey, visibleDateKeys]);

  const unconfirmedCount = blocks.filter(
    (b) => b.status !== "confirmed"
  ).length;
  const totalGridHeight = (GRID_END_MIN - GRID_START_MIN) * PX_PER_MINUTE;
  const stepDays = horizonDays === 7 ? 7 : 1;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-2xs">
      {/* Header, Horizon Toggle & Date Navigator */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight">
            Time Converted to Space
          </h1>
          <p className="text-xs text-muted-foreground">
            Tomorrow snapshot: {formatDuration(loadSummary.tmrwMeetingMins)}{" "}
            meetings · {formatDuration(loadSummary.tmrwTaskMins)} scheduled
            tasks/prep
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {unconfirmedCount > 0 && (
            <Button
              size="xs"
              variant="outline"
              onClick={onConfirmAndSyncAllAutoBlocks}
              className="gap-1"
            >
              <CalendarCheck className="size-3 text-emerald-600" />
              Approve {unconfirmedCount}
            </Button>
          )}

          <div className="flex items-center rounded-lg border bg-muted/40 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => onChangeHorizonDays(2)}
              className={`rounded-md px-2 py-1 font-medium transition-colors ${
                horizonDays === 2
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              2-Day
            </button>
            <button
              type="button"
              onClick={() => onChangeHorizonDays(7)}
              className={`rounded-md px-2 py-1 font-medium transition-colors ${
                horizonDays === 7
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              7-Day Week
            </button>
          </div>

          <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-0.5">
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() =>
                onChangeAnchorDateKey(
                  addDaysToDateKey(anchorDateKey, -stepDays)
                )
              }
              title="Previous"
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button
              size="xs"
              variant={anchorDateKey === todayKey ? "default" : "ghost"}
              onClick={() => onChangeAnchorDateKey(todayKey)}
            >
              Today
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() =>
                onChangeAnchorDateKey(addDaysToDateKey(anchorDateKey, stepDays))
              }
              title="Next"
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Color-Coded Time Budget Legend (Blue = Meetings, Orange = Tasks, Green = Buffers/Prep) */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/25 px-3 py-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className="size-2.5 rounded-xs bg-sky-500" />
            Meetings ({formatDuration(loadSummary.meetingMins)})
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className="size-2.5 rounded-xs bg-orange-500" />
            Tasks &amp; Segments ({formatDuration(loadSummary.taskMins)})
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className="size-2.5 rounded-xs bg-emerald-500" />
            Prep &amp; Buffers ({formatDuration(loadSummary.prepMins)})
          </span>
        </div>
        {loadSummary.doneCount > 0 && (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <CheckCircle2 className="size-3 text-emerald-600" />
            {loadSummary.doneCount} completed
          </Badge>
        )}
      </div>

      {blocks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <Calendar className="mb-3 size-8 text-muted-foreground" />
          <h2 className="text-sm font-semibold">
            Ready to convert your time into calendar space
          </h2>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            Select which calendars to read from and lock your personal UMich calendar as the write target, then click{" "}
            <span className="font-medium text-foreground">Sync Calendar</span>{" "}
            or add a task/deadline above.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={onOpenCalendarScope}>
              Choose Read &amp; Write Calendars
            </Button>
            <Button size="sm" onClick={onRunCalendarScanNow} className="gap-1.5">
              <RefreshCw className="size-3.5" />
              Sync Calendar Now
            </Button>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto pb-1">
          <div
            className={
              horizonDays === 7
                ? "grid min-w-[920px] grid-cols-7 gap-2"
                : "grid grid-cols-1 gap-3 xl:grid-cols-2"
            }
          >
            {visibleDateKeys.map((dateKey, colIdx) => {
              const dayBlocks = blocks.filter((b) => b.dateKey === dateKey);
              const busyRange = getBusyRangeForDate(dateKey, settings);
              const weekendProtected =
                settings.protectWeekends && isWeekendDateKey(dateKey);
              const isWeekMode = horizonDays === 7;
              const leftGutterClass = isWeekMode
                ? colIdx === 0
                  ? "left-11"
                  : "left-1.5"
                : "left-14";

              return (
                <div
                  key={dateKey}
                  className={`overflow-hidden rounded-xl border bg-background ${
                    dateKey === todayKey ? "ring-1 ring-foreground/25" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 border-b bg-muted/30 px-2.5 py-1.5">
                    <span className="truncate text-[11px] font-semibold">
                      {isWeekMode
                        ? formatCompactDayHeader(dateKey, todayKey)
                        : formatDateKeyLabel(dateKey, todayKey)}
                    </span>
                    {busyRange ? (
                      <Badge
                        variant="secondary"
                        className="truncate text-[9px]"
                        title={busyRange.label}
                      >
                        {busyRange.label}
                      </Badge>
                    ) : weekendProtected ? (
                      <span className="text-[9.5px] text-emerald-700 dark:text-emerald-300">
                        Recharge
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {dayBlocks.length}
                      </span>
                    )}
                  </div>

                  <div
                    className={`relative select-none ${
                      busyRange ? "bg-muted/35" : ""
                    }`}
                    style={{ height: `${totalGridHeight}px` }}
                  >
                    {hours.map((hMin) => {
                      const top = (hMin - GRID_START_MIN) * PX_PER_MINUTE;
                      const showLabel = !isWeekMode || colIdx === 0;
                      return (
                        <div
                          key={hMin}
                          className="pointer-events-none absolute inset-x-0 flex items-start border-t border-border/45"
                          style={{ top: `${top}px` }}
                        >
                          {showLabel && (
                            <span
                              className={`${
                                isWeekMode ? "w-10 text-[9px]" : "w-13 text-[10px]"
                              } shrink-0 -translate-y-2 bg-background pr-1.5 pl-1 text-right font-mono text-muted-foreground`}
                            >
                              {isWeekMode
                                ? formatMinutesToTime(hMin).replace(":00 ", "")
                                : formatMinutesToTime(hMin)}
                            </span>
                          )}
                        </div>
                      );
                    })}

                    {/* Green Protected Buffers & Rhythm Windows */}
                    {protectedIntervals.map((pw, idx) => {
                      const s = Math.max(GRID_START_MIN, pw.startMinutes);
                      const e = Math.min(GRID_END_MIN, pw.endMinutes);
                      if (e <= s) return null;
                      return (
                        <div
                          key={`${pw.label}-${idx}`}
                          style={{
                            top: `${(s - GRID_START_MIN) * PX_PER_MINUTE}px`,
                            height: `${(e - s) * PX_PER_MINUTE}px`,
                          }}
                          className={`pointer-events-none absolute right-1 ${leftGutterClass} flex items-center justify-end rounded-md border border-dashed border-emerald-500/30 bg-emerald-500/[0.06] px-1.5`}
                        >
                          {!isWeekMode && (
                            <span className="text-[9.5px] font-medium text-emerald-800/80 dark:text-emerald-200/80">
                              {pw.label}
                            </span>
                          )}
                        </div>
                      );
                    })}

                    {dayBlocks.map((block) => {
                      const clampedStart = Math.max(
                        GRID_START_MIN,
                        Math.min(GRID_END_MIN - 20, block.startMinutes)
                      );
                      const top =
                        (clampedStart - GRID_START_MIN) * PX_PER_MINUTE;
                      const height = Math.max(
                        28,
                        block.durationMinutes * PX_PER_MINUTE - 2
                      );
                      const theme = getBlockColors(block);
                      const canMarkDone =
                        Boolean(block.isDayframeCreated) &&
                        (block.kind !== "meeting" || Boolean(block.isSoloHold));

                      return (
                        <div
                          key={block.id}
                          style={{ top: `${top}px`, height: `${height}px` }}
                          onClick={() => onSelectBlockId(block.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onSelectBlockId(block.id);
                            }
                          }}
                          className={`absolute right-1 ${leftGutterClass} flex cursor-pointer flex-col justify-between overflow-hidden rounded-lg border px-2 py-1 text-left transition-all ${
                            theme.card
                          } ${
                            block.status !== "confirmed"
                              ? "border-dashed"
                              : "border-solid"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1">
                                {canMarkDone && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onToggleBlockDone(block.id);
                                    }}
                                    title={
                                      block.done
                                        ? "Completed — click to reopen"
                                        : "Mark done (moves to Done state & calibrates multiplier)"
                                    }
                                    className={`flex size-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors ${
                                      block.done
                                        ? "border-emerald-600 bg-emerald-600 text-white"
                                        : "border-current/40 bg-background/60 hover:bg-emerald-500/20"
                                    }`}
                                  >
                                    {block.done && <Check className="size-2.5" />}
                                  </button>
                                )}
                                {!canMarkDone && block.isRecurring && (
                                  <Repeat className="size-2.5 shrink-0 opacity-75" />
                                )}
                                {!canMarkDone && block.isSoloHold && (
                                  <UserCheck className="size-2.5 shrink-0 opacity-80" />
                                )}
                                {!canMarkDone && block.kind === "prep" && (
                                  <ShieldCheck className="size-2.5 shrink-0 opacity-80" />
                                )}
                                <span
                                  className={`truncate text-[11px] font-semibold leading-tight ${
                                    block.done ? "line-through opacity-75" : ""
                                  }`}
                                >
                                  {block.title}
                                </span>
                              </div>
                              {!isWeekMode && height >= 46 && (
                                <p className="mt-0.5 line-clamp-1 text-[10px] opacity-80">
                                  {formatMinutesToTime(block.startMinutes)} –{" "}
                                  {formatMinutesToTime(
                                    block.startMinutes + block.durationMinutes
                                  )}{" "}
                                  ({formatDuration(block.durationMinutes)})
                                </p>
                              )}
                            </div>

                            {!isWeekMode && (
                              <span
                                className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold ${theme.pill}`}
                              >
                                {block.status === "proposed"
                                  ? `? ${formatDuration(block.durationMinutes)}`
                                  : theme.label}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Block Inspector, Done State & Principle 2 Multiplier Calibration Modal */}
      <Dialog
        open={Boolean(selectedBlock)}
        onOpenChange={(open) => {
          if (!open) onSelectBlockId(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {selectedBlock && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">
                    {formatDateKeyLabel(selectedBlock.dateKey, todayKey)} •{" "}
                    {formatMinutesToTime(selectedBlock.startMinutes)} (
                    {formatDuration(selectedBlock.durationMinutes)})
                  </Badge>
                  {selectedBlock.calendarTitle && (
                    <Badge variant="outline" className="text-[10px]">
                      {selectedBlock.calendarTitle}
                    </Badge>
                  )}
                  {selectedBlock.syncedToExternalCalendar && (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <CheckCircle2 className="size-3 text-emerald-500" />
                      On Calendar.app
                    </Badge>
                  )}
                </div>
                <DialogTitle className="pt-1">{selectedBlock.title}</DialogTitle>
                <DialogDescription>{selectedBlock.rationale}</DialogDescription>
              </DialogHeader>

              <div className="space-y-3 py-1 text-xs">
                {linkedCapture?.imageDataUrl && (
                  <div className="space-y-1.5 rounded-xl border bg-muted/30 p-2.5">
                    <div className="font-medium">
                      Source ({linkedCapture.appName})
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={linkedCapture.imageDataUrl}
                      alt={linkedCapture.windowTitle}
                      className="max-h-40 w-full rounded-lg border object-cover"
                    />
                  </div>
                )}

                {/* Principle 2 + Principle 4: Done & Actual Time Taken */}
                {selectedBlock.isDayframeCreated && (
                  <div className="space-y-2 rounded-xl border bg-emerald-500/[0.06] p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">
                        Done &amp; Calibrate Multiplier
                      </span>
                      {selectedBlock.gutMinutes && (
                        <span className="font-mono text-[10.5px] text-muted-foreground">
                          Gut {formatDuration(selectedBlock.gutMinutes)} →
                          Scheduled {formatDuration(selectedBlock.durationMinutes)}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        size="xs"
                        variant={selectedBlock.done ? "secondary" : "default"}
                        onClick={() => {
                          onToggleBlockDone(
                            selectedBlock.id,
                            selectedBlock.durationMinutes
                          );
                          onSelectBlockId(null);
                        }}
                        className="gap-1"
                      >
                        <Check className="size-3" />
                        {selectedBlock.done
                          ? "Reopen Task"
                          : `Done (${formatDuration(selectedBlock.durationMinutes)})`}
                      </Button>
                      {!selectedBlock.done && (
                        <>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => {
                              onToggleBlockDone(
                                selectedBlock.id,
                                Math.max(15, selectedBlock.durationMinutes - 30)
                              );
                              onSelectBlockId(null);
                            }}
                          >
                            Done (30m faster)
                          </Button>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => {
                              onToggleBlockDone(
                                selectedBlock.id,
                                selectedBlock.durationMinutes + 30
                              );
                              onSelectBlockId(null);
                            }}
                          >
                            Done (+30m longer)
                          </Button>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => {
                              onToggleBlockDone(
                                selectedBlock.id,
                                selectedBlock.durationMinutes * 2
                              );
                              onSelectBlockId(null);
                            }}
                          >
                            Done (2× longer)
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                <div className="space-y-2 rounded-xl border p-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Clock className="size-3.5" />
                      Resize Block Duration
                    </span>
                    <span className="font-mono font-semibold">
                      {formatDuration(selectedBlock.durationMinutes)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={selectedBlock.durationMinutes <= 15}
                      onClick={() =>
                        onAdjustBlockDuration(selectedBlock.id, -15, true)
                      }
                      className="gap-1"
                    >
                      <Minus className="size-3" />
                      15m less
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        onAdjustBlockDuration(selectedBlock.id, 15, true)
                      }
                      className="gap-1"
                    >
                      <Plus className="size-3" />
                      15m more
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        onAdjustBlockDuration(selectedBlock.id, 30, true)
                      }
                      className="gap-1"
                    >
                      <Plus className="size-3" />
                      30m more
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {!selectedBlock.syncedToExternalCalendar &&
                      !selectedBlock.occupiesTimeOnly && (
                        <Button
                          size="sm"
                          onClick={() => {
                            onConfirmAndSyncBlock(selectedBlock.id);
                            onSelectBlockId(null);
                          }}
                          className="gap-1.5"
                        >
                          <Sparkles className="size-3.5" />
                          Write to UMich Calendar
                        </Button>
                      )}

                    {!selectedBlock.occupiesTimeOnly && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onMoveBlockToNextSlot(selectedBlock.id)}
                          className="gap-1"
                        >
                          Next Open Slot
                          <ArrowRight className="size-3.5" />
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onShiftBlockDate(selectedBlock.id, 1)}
                        >
                          Move +1 Day
                        </Button>
                      </>
                    )}
                  </div>

                  {!selectedBlock.occupiesTimeOnly && (
                    <Button
                      size="icon-sm"
                      variant="destructive"
                      onClick={() => {
                        onDeleteBlock(selectedBlock.id);
                        onSelectBlockId(null);
                      }}
                      title="Remove block"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
