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
  getProtectedIntervals,
} from "@/lib/scheduler";
import {
  ArrowRight,
  Calendar,
  CalendarCheck,
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
  blocks: CalendarBlock[];
  captures: ScreenshotCapture[];
  rules: StandingRule[];
  settings: OrganizerSettings;
  selectedBlockId: string | null;
  onSelectBlockId: (id: string | null) => void;
  onConfirmAndSyncBlock: (id: string) => void;
  onConfirmAndSyncAllAutoBlocks: () => void;
  onAdjustBlockDuration: (
    id: string,
    deltaMinutes: number,
    saveRule: boolean
  ) => void;
  onMoveBlockToNextSlot: (id: string) => void;
  onShiftBlockDate: (id: string, deltaDays: number) => void;
  onDeleteBlock: (id: string) => void;
  onRunCalendarScanNow: () => void;
  onOpenSetupWizard: () => void;
}

const GRID_START_MIN = 8 * 60;
const GRID_END_MIN = 19 * 60;
const PX_PER_MINUTE = 1.02;

function getBlockColors(block: CalendarBlock) {
  if (block.kind === "prep") {
    return {
      card: "border-amber-500/45 bg-amber-500/12 text-amber-950 hover:border-amber-500 dark:text-amber-100",
      pill: "bg-amber-500/20 text-amber-900 dark:text-amber-200",
      label: "Prep ≥2h Rule",
    };
  }
  if (block.isSoloHold) {
    return {
      card: "border-sky-500/45 bg-sky-500/12 text-sky-950 hover:border-sky-500 dark:text-sky-100",
      pill: "bg-sky-500/20 text-sky-900 dark:text-sky-200",
      label: "Solo Hold",
    };
  }
  if (block.kind === "deep-work") {
    return {
      card: "border-emerald-500/45 bg-emerald-500/12 text-emerald-950 hover:border-emerald-500 dark:text-emerald-100",
      pill: "bg-emerald-500/20 text-emerald-900 dark:text-emerald-200",
      label: "Focus Block",
    };
  }
  if (block.kind === "follow-up") {
    return {
      card: "border-violet-500/45 bg-violet-500/12 text-violet-950 hover:border-violet-500 dark:text-violet-100",
      pill: "bg-violet-500/20 text-violet-900 dark:text-violet-200",
      label: "Follow-Up",
    };
  }
  return {
    card: "border-slate-400/50 bg-slate-500/10 text-foreground hover:border-slate-500 dark:border-slate-600 dark:bg-slate-800/70",
    pill: "bg-muted text-muted-foreground",
    label: block.isRecurring ? "Recurring" : "Calendar",
  };
}

export function CalendarTimeline({
  todayKey,
  anchorDateKey,
  onChangeAnchorDateKey,
  blocks,
  captures,
  rules,
  settings,
  selectedBlockId,
  onSelectBlockId,
  onConfirmAndSyncBlock,
  onConfirmAndSyncAllAutoBlocks,
  onAdjustBlockDuration,
  onMoveBlockToNextSlot,
  onShiftBlockDate,
  onDeleteBlock,
  onRunCalendarScanNow,
  onOpenSetupWizard,
}: CalendarTimelineProps) {
  const nextDateKey = addDaysToDateKey(anchorDateKey, 1);
  const visibleDateKeys = [anchorDateKey, nextDateKey];

  const hours = useMemo(() => {
    const arr: number[] = [];
    for (let m = GRID_START_MIN; m <= GRID_END_MIN; m += 60) arr.push(m);
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

  const unconfirmedCount = blocks.filter((b) => b.status !== "confirmed").length;
  const totalGridHeight = (GRID_END_MIN - GRID_START_MIN) * PX_PER_MINUTE;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-2xs">
      {/* Header & Date Navigator */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight">
            Your Time-Blocked Calendar
          </h1>
          <p className="text-xs text-muted-foreground">
            {blocks.length === 0
              ? `Workday ${formatMinutesToTime(
                  settings.workdayStartMinutes
                )} – ${formatMinutesToTime(
                  settings.workdayEndMinutes
                )} • Connect your Mac or Google calendar to populate your real schedule.`
              : `${blocks.length} total blocks across your week • ${
                  blocks.filter((b) => b.syncedToExternalCalendar).length
                } synced with external calendar`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {unconfirmedCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={onConfirmAndSyncAllAutoBlocks}
              className="gap-1.5 text-xs"
            >
              <CalendarCheck className="size-3.5 text-emerald-600" />
              Approve &amp; Sync {unconfirmedCount}
            </Button>
          )}

          <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-0.5">
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() =>
                onChangeAnchorDateKey(addDaysToDateKey(anchorDateKey, -1))
              }
              title="Previous day"
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
                onChangeAnchorDateKey(addDaysToDateKey(anchorDateKey, 1))
              }
              title="Next day"
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Empty State when user hasn't connected a calendar yet */}
      {blocks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
          <Calendar className="mb-3 size-8 text-muted-foreground" />
          <h2 className="text-sm font-semibold">
            Your calendar workspace is clean and ready
          </h2>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            Connect your MacBook&apos;s native <span className="font-medium text-foreground">Calendar.app</span> &amp; <span className="font-medium text-foreground">Mail.app</span> via <code className="rounded bg-muted px-1">npm run mac</code> (or connect Google Calendar in Setup) to pull in your real schedule and let Gemma 4 organize your prep and focus blocks.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={onOpenSetupWizard}>
              Open Connection Setup
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onRunCalendarScanNow}
              className="gap-1.5"
            >
              <RefreshCw className="size-3.5" />
              Scan Calendar &amp; Mail Now
            </Button>
          </div>
        </div>
      ) : (
        <>
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
              Synced Calendar Event
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {visibleDateKeys.map((dateKey) => {
              const dayBlocks = blocks.filter((b) => b.dateKey === dateKey);

              return (
                <div
                  key={dateKey}
                  className="overflow-hidden rounded-xl border bg-background"
                >
                  <div className="flex items-center justify-between border-b bg-muted/30 px-3.5 py-2">
                    <span className="text-xs font-semibold">
                      {formatDateKeyLabel(dateKey, todayKey)}
                    </span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {dayBlocks.length} blocks
                    </Badge>
                  </div>

                  <div
                    className="relative select-none"
                    style={{ height: `${totalGridHeight}px` }}
                  >
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
                          className="pointer-events-none absolute right-2 left-16 flex items-center justify-end rounded-md border border-dashed border-border/70 bg-muted/25 px-2.5"
                        >
                          <span className="text-[10px] font-medium text-muted-foreground">
                            {pw.label}
                          </span>
                        </div>
                      );
                    })}

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
                      const theme = getBlockColors(block);

                      return (
                        <button
                          key={block.id}
                          type="button"
                          onClick={() => onSelectBlockId(block.id)}
                          style={{ top: `${top}px`, height: `${height}px` }}
                          className={`absolute right-2.5 left-16 flex flex-col justify-between overflow-hidden rounded-lg border px-2.5 py-1.5 text-left transition-all ${
                            theme.card
                          } ${
                            block.status !== "confirmed"
                              ? "border-dashed"
                              : "border-solid"
                          }`}
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
                                {block.syncedToExternalCalendar && (
                                  <CheckCircle2 className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                )}
                                <span className="truncate text-xs font-semibold leading-tight">
                                  {block.title}
                                </span>
                              </div>
                              {height >= 48 && (
                                <p className="mt-0.5 line-clamp-1 text-[10.5px] opacity-80">
                                  {formatMinutesToTime(block.startMinutes)} –{" "}
                                  {formatMinutesToTime(
                                    block.startMinutes + block.durationMinutes
                                  )}{" "}
                                  ({formatDuration(block.durationMinutes)}) •{" "}
                                  {block.sourceLabel}
                                </p>
                              )}
                            </div>

                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-semibold ${theme.pill}`}
                            >
                              {block.status !== "confirmed"
                                ? theme.label
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
        </>
      )}

      {/* Block Inspector & Feedback Modal */}
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
                  {selectedBlock.syncedToExternalCalendar && (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <CheckCircle2 className="size-3 text-emerald-500" />
                      Synced to Calendar
                    </Badge>
                  )}
                </div>
                <DialogTitle className="pt-1">{selectedBlock.title}</DialogTitle>
                <DialogDescription>{selectedBlock.rationale}</DialogDescription>
              </DialogHeader>

              <div className="space-y-3 py-1 text-xs">
                {linkedCapture && (
                  <div className="space-y-1.5 rounded-xl border bg-muted/30 p-2.5">
                    <div className="font-medium">
                      Source Screenshot ({linkedCapture.appName})
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={linkedCapture.imageDataUrl}
                      alt={linkedCapture.windowTitle}
                      className="max-h-40 w-full rounded-lg border object-cover"
                    />
                  </div>
                )}

                <div className="space-y-2 rounded-xl border p-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Clock className="size-3.5" />
                      Calibrate Duration (Teaches Future Estimates)
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
                      15m faster
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
                    {!selectedBlock.syncedToExternalCalendar && (
                      <Button
                        size="sm"
                        onClick={() => {
                          onConfirmAndSyncBlock(selectedBlock.id);
                          onSelectBlockId(null);
                        }}
                        className="gap-1.5"
                      >
                        <Sparkles className="size-3.5" />
                        Approve &amp; Write to Calendar
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
                      onClick={() => onShiftBlockDate(selectedBlock.id, 1)}
                    >
                      Push +1 Day
                    </Button>
                  </div>

                  <Button
                    size="icon-sm"
                    variant="destructive"
                    onClick={() => {
                      onDeleteBlock(selectedBlock.id);
                      onSelectBlockId(null);
                    }}
                    title="Remove from Dayframe"
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
