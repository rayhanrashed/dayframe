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
  CaptureSettings,
  ScreenshotCapture,
  StandingRule,
} from "@/lib/types";
import {
  formatDuration,
  formatMinutesToTime,
  getProtectedIntervals,
} from "@/lib/scheduler";
import {
  ArrowRight,
  CalendarCheck,
  Clock,
  Download,
  Minus,
  Plus,
  Repeat,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
} from "lucide-react";

interface CalendarTimelineProps {
  blocks: CalendarBlock[];
  captures: ScreenshotCapture[];
  rules: StandingRule[];
  settings: CaptureSettings;
  viewMode: "split" | "today" | "tomorrow";
  onChangeViewMode: (mode: "split" | "today" | "tomorrow") => void;
  selectedBlockId: string | null;
  onSelectBlockId: (id: string | null) => void;
  onConfirmBlock: (id: string) => void;
  onConfirmAllAutoBlocks: () => void;
  onAdjustBlockDuration: (
    id: string,
    deltaMinutes: number,
    saveCalibrationRule: boolean
  ) => void;
  onMoveBlockToNextSlot: (id: string) => void;
  onToggleBlockDay: (id: string) => void;
  onDeleteBlock: (id: string) => void;
  onDownloadSingleIcs: (block: CalendarBlock) => void;
}

const GRID_START_MIN = 8 * 60; // 8:00 AM
const GRID_END_MIN = 19 * 60; // 7:00 PM
const PX_PER_MINUTE = 1.05; // ~63px per hour

function getBlockTheme(block: CalendarBlock): {
  container: string;
  badge: string;
  typeLabel: string;
} {
  if (block.kind === "prep") {
    return {
      container:
        "border-amber-500/45 bg-amber-500/12 text-amber-950 hover:border-amber-500 dark:text-amber-100",
      badge: "bg-amber-500/20 text-amber-900 dark:text-amber-200",
      typeLabel: "Prep ≥2h Rule",
    };
  }
  if (block.isSoloHold) {
    return {
      container:
        "border-sky-500/45 bg-sky-500/12 text-sky-950 hover:border-sky-500 dark:text-sky-100",
      badge: "bg-sky-500/20 text-sky-900 dark:text-sky-200",
      typeLabel: "Solo Invite (Just You)",
    };
  }
  if (block.kind === "deep-work") {
    return {
      container:
        "border-emerald-500/45 bg-emerald-500/12 text-emerald-950 hover:border-emerald-500 dark:text-emerald-100",
      badge: "bg-emerald-500/20 text-emerald-900 dark:text-emerald-200",
      typeLabel: "Focus Time-Block",
    };
  }
  if (block.kind === "follow-up") {
    return {
      container:
        "border-violet-500/45 bg-violet-500/12 text-violet-950 hover:border-violet-500 dark:text-violet-100",
      badge: "bg-violet-500/20 text-violet-900 dark:text-violet-200",
      typeLabel: "Reply Window",
    };
  }
  return {
    container:
      "border-slate-400/50 bg-slate-500/10 text-foreground hover:border-slate-500 dark:border-slate-600 dark:bg-slate-800/70",
    badge: "bg-muted text-muted-foreground",
    typeLabel: block.isRecurring ? "Recurring Meeting" : "Meeting",
  };
}

export function CalendarTimeline({
  blocks,
  captures,
  rules,
  settings,
  viewMode,
  onChangeViewMode,
  selectedBlockId,
  onSelectBlockId,
  onConfirmBlock,
  onConfirmAllAutoBlocks,
  onAdjustBlockDuration,
  onMoveBlockToNextSlot,
  onToggleBlockDay,
  onDeleteBlock,
  onDownloadSingleIcs,
}: CalendarTimelineProps) {
  const hours = useMemo(() => {
    const arr: number[] = [];
    for (let m = GRID_START_MIN; m <= GRID_END_MIN; m += 60) {
      arr.push(m);
    }
    return arr;
  }, []);

  const protectedIntervals = useMemo(
    () => getProtectedIntervals(rules),
    [rules]
  );

  const selectedBlock = useMemo(
    () => blocks.find((b) => b.id === selectedBlockId) ?? null,
    [blocks, selectedBlockId]
  );

  const linkedCapture = useMemo(() => {
    if (!selectedBlock?.sourceCaptureId) return null;
    return captures.find((c) => c.id === selectedBlock.sourceCaptureId) ?? null;
  }, [captures, selectedBlock]);

  const autoScheduledCount = blocks.filter(
    (b) => b.status === "auto-scheduled"
  ).length;
  const prepCount = blocks.filter((b) => b.kind === "prep").length;
  const soloHoldCount = blocks.filter((b) => b.isSoloHold).length;

  const todayBookedMinutes = blocks
    .filter((b) => b.dayOffset === 0)
    .reduce((acc, b) => acc + b.durationMinutes, 0);
  const totalWorkdayMinutes = Math.max(
    60,
    settings.workdayEndMinutes - settings.workdayStartMinutes
  );
  const openTodayMinutes = Math.max(0, totalWorkdayMinutes - todayBookedMinutes);

  const daysToRender =
    viewMode === "today"
      ? [{ dayOffset: 0, label: "Today", sublabel: "Active MacBook Day" }]
      : viewMode === "tomorrow"
        ? [
            {
              dayOffset: 1,
              label: "Tomorrow",
              sublabel: "Prep + Nightly Sync Target",
            },
          ]
        : [
            { dayOffset: 0, label: "Today", sublabel: "Active MacBook Day" },
            {
              dayOffset: 1,
              label: "Tomorrow",
              sublabel: "Prep + Nightly Sync Target",
            },
          ];

  const totalGridHeight = (GRID_END_MIN - GRID_START_MIN) * PX_PER_MINUTE;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-2xs">
      {/* Top Bar: Calendar Summary & View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold tracking-tight">
              Time-Blocked Schedule
            </h1>
            <Badge variant="secondary" className="text-[11px]">
              {formatDuration(openTodayMinutes)} open today
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Tasks &amp; invites from screenshots are slotted directly by duration, availability &amp;{" "}
            <span className="font-medium text-foreground">
              {prepCount} prep block{prepCount === 1 ? "" : "s"}
            </span>{" "}
            •{" "}
            <span className="font-medium text-foreground">
              {soloHoldCount} solo invite{soloHoldCount === 1 ? "" : "s"}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {autoScheduledCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={onConfirmAllAutoBlocks}
              className="gap-1.5 text-xs"
            >
              <CalendarCheck className="size-3.5 text-emerald-600" />
              Confirm {autoScheduledCount} Auto-Placed
            </Button>
          )}

          <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
            <Button
              size="xs"
              variant={viewMode === "split" ? "default" : "ghost"}
              onClick={() => onChangeViewMode("split")}
              className="hidden sm:inline-flex"
            >
              Today + Tomorrow
            </Button>
            <Button
              size="xs"
              variant={viewMode === "today" ? "default" : "ghost"}
              onClick={() => onChangeViewMode("today")}
            >
              Today
            </Button>
            <Button
              size="xs"
              variant={viewMode === "tomorrow" ? "default" : "ghost"}
              onClick={() => onChangeViewMode("tomorrow")}
            >
              Tomorrow
            </Button>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-xs bg-amber-500/70" />
          Auto Prep (≥2h ahead)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-xs bg-sky-500/70" />
          Solo Invite (Just for You)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-xs bg-emerald-500/70" />
          Focus Block (By Duration)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-xs bg-slate-500/50" />
          Confirmed Meeting
        </span>
      </div>

      {/* Day Columns */}
      <div
        className={`grid gap-4 pt-1 ${
          daysToRender.length === 2 ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1"
        }`}
      >
        {daysToRender.map((dayCol) => {
          const dayBlocks = blocks.filter(
            (b) => b.dayOffset === dayCol.dayOffset
          );

          return (
            <div
              key={dayCol.dayOffset}
              className="overflow-hidden rounded-xl border bg-background"
            >
              <div className="flex items-center justify-between border-b bg-muted/30 px-3.5 py-2">
                <div>
                  <span className="text-xs font-semibold">{dayCol.label}</span>
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    {dayCol.sublabel}
                  </span>
                </div>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {dayBlocks.length} blocks
                </Badge>
              </div>

              <div
                className="relative select-none"
                style={{ height: `${totalGridHeight}px` }}
              >
                {/* Hour Grid Lines */}
                {hours.map((hMin) => {
                  const top = (hMin - GRID_START_MIN) * PX_PER_MINUTE;
                  return (
                    <div
                      key={hMin}
                      className="pointer-events-none absolute inset-x-0 flex items-start border-t border-border/50"
                      style={{ top: `${top}px` }}
                    >
                      <span className="w-16 shrink-0 -translate-y-2 bg-background pr-2 pl-2.5 text-right font-mono text-[10px] text-muted-foreground">
                        {formatMinutesToTime(hMin)}
                      </span>
                    </div>
                  );
                })}

                {/* Protected Windows (e.g. Midday Lunch / Wind-Down) */}
                {protectedIntervals.map((pw, idx) => {
                  const clampedStart = Math.max(GRID_START_MIN, pw.startMinutes);
                  const clampedEnd = Math.min(GRID_END_MIN, pw.endMinutes);
                  if (clampedEnd <= clampedStart) return null;
                  const top = (clampedStart - GRID_START_MIN) * PX_PER_MINUTE;
                  const height = (clampedEnd - clampedStart) * PX_PER_MINUTE;
                  return (
                    <div
                      key={`${pw.label}-${idx}`}
                      style={{ top: `${top}px`, height: `${height}px` }}
                      className="pointer-events-none absolute right-2 left-16 flex items-center justify-end rounded-md border border-dashed border-border/70 bg-muted/25 px-2.5"
                    >
                      <span className="text-[10px] font-medium text-muted-foreground">
                        {pw.label}
                      </span>
                    </div>
                  );
                })}

                {/* Scheduled Calendar Blocks */}
                {dayBlocks.map((block) => {
                  const clampedStart = Math.max(
                    GRID_START_MIN,
                    Math.min(GRID_END_MIN - 20, block.startMinutes)
                  );
                  const top = (clampedStart - GRID_START_MIN) * PX_PER_MINUTE;
                  const height = Math.max(
                    32,
                    block.durationMinutes * PX_PER_MINUTE - 2
                  );
                  const theme = getBlockTheme(block);
                  const isSelected = block.id === selectedBlockId;

                  return (
                    <button
                      key={block.id}
                      type="button"
                      onClick={() => onSelectBlockId(block.id)}
                      style={{ top: `${top}px`, height: `${height}px` }}
                      className={`absolute right-2.5 left-16 flex flex-col justify-between overflow-hidden rounded-lg border px-2.5 py-1.5 text-left transition-all ${
                        theme.container
                      } ${
                        block.status === "auto-scheduled"
                          ? "border-dashed"
                          : "border-solid"
                      } ${isSelected ? "ring-2 ring-ring" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {block.isRecurring && (
                              <Repeat className="size-3 shrink-0 opacity-75" />
                            )}
                            {block.isSoloHold && (
                              <UserCheck className="size-3 shrink-0 opacity-80" />
                            )}
                            {block.kind === "prep" && (
                              <ShieldCheck className="size-3 shrink-0 opacity-80" />
                            )}
                            <span className="truncate text-xs font-semibold leading-tight">
                              {block.title}
                            </span>
                          </div>
                          {height >= 50 && (
                            <p className="mt-0.5 line-clamp-1 text-[10.5px] opacity-80">
                              {formatMinutesToTime(block.startMinutes)} –{" "}
                              {formatMinutesToTime(
                                block.startMinutes + block.durationMinutes
                              )}{" "}
                              ({formatDuration(block.durationMinutes)})
                              {block.sourceLabel ? ` • ${block.sourceLabel}` : ""}
                            </p>
                          )}
                        </div>

                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-semibold ${theme.badge}`}
                        >
                          {block.status === "auto-scheduled"
                            ? theme.typeLabel
                            : formatDuration(block.durationMinutes)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Block Inspector & One-Click Feedback Dialog */}
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
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">
                    {selectedBlock.dayOffset === 0 ? "Today" : "Tomorrow"} •{" "}
                    {formatMinutesToTime(selectedBlock.startMinutes)} –{" "}
                    {formatMinutesToTime(
                      selectedBlock.startMinutes + selectedBlock.durationMinutes
                    )}
                  </Badge>
                  {selectedBlock.isSoloHold && (
                    <Badge variant="outline" className="text-[10px]">
                      Solo Calendar Invite (Just for You)
                    </Badge>
                  )}
                  {selectedBlock.kind === "prep" && (
                    <Badge variant="outline" className="text-[10px]">
                      Standing Prep Rule
                    </Badge>
                  )}
                </div>
                <DialogTitle className="pt-1">{selectedBlock.title}</DialogTitle>
                <DialogDescription>{selectedBlock.rationale}</DialogDescription>
              </DialogHeader>

              <div className="space-y-3 py-1 text-xs">
                {linkedCapture && (
                  <div className="space-y-2 rounded-xl border bg-muted/30 p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        Source Screenshot ({linkedCapture.appName})
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {linkedCapture.device === "android"
                          ? "Synced from Android"
                          : "MacBook Capture"}
                      </span>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={linkedCapture.imageDataUrl}
                      alt={linkedCapture.windowTitle}
                      className="max-h-40 w-full rounded-lg border object-cover"
                    />
                  </div>
                )}

                {/* Quick Duration & Slot Calibration ("Taking feedback from me") */}
                <div className="space-y-2 rounded-xl border p-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Clock className="size-3.5" />
                      How much time will this actually take?
                    </span>
                    <span className="font-mono font-semibold">
                      {formatDuration(selectedBlock.durationMinutes)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
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
                      15m faster (remember)
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
                      15m more (remember)
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
                      30m more (remember)
                    </Button>
                  </div>
                </div>

                {/* Placement & Export Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {selectedBlock.status !== "confirmed" && (
                      <Button
                        size="sm"
                        onClick={() => {
                          onConfirmBlock(selectedBlock.id);
                          onSelectBlockId(null);
                        }}
                        className="gap-1.5"
                      >
                        <Sparkles className="size-3.5" />
                        Confirm Slot
                      </Button>
                    )}

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
                      onClick={() => onToggleBlockDay(selectedBlock.id)}
                    >
                      Move to{" "}
                      {selectedBlock.dayOffset === 0 ? "Tomorrow" : "Today"}
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onDownloadSingleIcs(selectedBlock)}
                      className="gap-1"
                    >
                      <Download className="size-3.5" />
                      Solo .ics
                    </Button>
                  </div>

                  <Button
                    size="icon-sm"
                    variant="destructive"
                    onClick={() => {
                      onDeleteBlock(selectedBlock.id);
                      onSelectBlockId(null);
                    }}
                    title="Remove from calendar"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
