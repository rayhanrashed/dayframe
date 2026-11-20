"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BusyDateRange,
  CalibrationSample,
  MacCalendarDescriptor,
  OrganizerSettings,
} from "@/lib/types";
import { computeMeasuredMultiplier } from "@/lib/place-on-calendar";
import { parseNaturalTaskInput } from "@/lib/nl-schedule-parser";
import { formatDuration } from "@/lib/scheduler";
import {
  describeCalendar,
  isPersonalUmichCalendar,
} from "@/lib/umich-calendar";
import {
  ArrowDownLeft,
  CalendarCog,
  CalendarPlus,
  Check,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";

interface TaskComposerProps {
  settings: OrganizerSettings;
  onUpdateSettings: (patch: Partial<OrganizerSettings>) => void;
  calendars: MacCalendarDescriptor[];
  onSelectWriteCalendar: (calendarId: string) => void;
  onToggleReadCalendar: (calendarId: string, checked: boolean) => void;
  onSelectOnlyUmichReadCalendar: () => void;
  onRefreshCalendars: () => void;
  calibrationSamples: CalibrationSample[];
  busy: boolean;
  decomposingWithAi: boolean;
  overdueCount: number;
  futurePullableCount: number;
  scarcityWarning: string | null;
  onDismissScarcityWarning: () => void;
  scopeDialogOpen: boolean;
  onScopeDialogOpenChange: (open: boolean) => void;
  onAddTask: (task: {
    title: string;
    gutMinutes: number;
    applyMultiplier: boolean;
    deadlineDateKey?: string;
    useGemmaBreakdown?: boolean;
  }) => void;
  onReplanOverdue: () => void;
  onPullFutureTaskIntoToday: () => void;
}

const GUT_ESTIMATES = [
  { mins: 15, label: "15m" },
  { mins: 30, label: "30m" },
  { mins: 45, label: "45m" },
  { mins: 60, label: "1h" },
  { mins: 90, label: "1.5h" },
  { mins: 120, label: "2h" },
  { mins: 180, label: "3h" },
  { mins: 300, label: "5h (project)" },
  { mins: 480, label: "8h (project)" },
  { mins: 720, label: "12h (fellowship)" },
  { mins: 1200, label: "20h (major deadline)" },
];

export function TaskComposer({
  settings,
  onUpdateSettings,
  calendars,
  onSelectWriteCalendar,
  onToggleReadCalendar,
  onSelectOnlyUmichReadCalendar,
  onRefreshCalendars,
  calibrationSamples,
  busy,
  decomposingWithAi,
  overdueCount,
  futurePullableCount,
  scarcityWarning,
  onDismissScarcityWarning,
  scopeDialogOpen,
  onScopeDialogOpenChange,
  onAddTask,
  onReplanOverdue,
  onPullFutureTaskIntoToday,
}: TaskComposerProps) {
  const [title, setTitle] = useState("");
  const [gutMinutes, setGutMinutes] = useState("60");
  const [deadline, setDeadline] = useState("");
  const [applyMultiplier, setApplyMultiplier] = useState(true);

  const [busyLabel, setBusyLabel] = useState("");
  const [busyStart, setBusyStart] = useState("");
  const [busyEnd, setBusyEnd] = useState("");

  const writableCalendars = useMemo(
    () => calendars.filter((c) => c.allowsModify),
    [calendars]
  );

  const { measured, sampleCount } = useMemo(
    () => computeMeasuredMultiplier(calibrationSamples),
    [calibrationSamples]
  );

  const rawGut = Number(gutMinutes) || 60;
  const parsedIntent = useMemo(
    () =>
      title.trim()
        ? parseNaturalTaskInput({
            rawText: title,
            fallbackGutMinutes: rawGut,
            explicitDeadlineDateKey: deadline || undefined,
            todayKey: "2026-11-20",
          })
        : null,
    [deadline, rawGut, title]
  );

  const effectiveMultiplier =
    applyMultiplier && !parsedIntent?.hasExplicitDuration
      ? settings.calibrationMultiplier
      : 1;
  const effectiveGut = parsedIntent?.gutMinutes ?? rawGut;
  const calibratedMins = Math.max(
    15,
    Math.round((effectiveGut * effectiveMultiplier) / 15) * 15
  );
  const approxSegments =
    parsedIntent?.mode === "weekly-cadence"
      ? (parsedIntent.weeklyCadence?.weeksCount ?? 2) *
        Math.max(
          1,
          Math.ceil((parsedIntent.weeklyCadence?.minutesPerWeek ?? 60) / 60)
        )
      : parsedIntent?.mode === "explicit-block-count"
        ? parsedIntent.explicitBlocks?.count ?? 2
        : calibratedMins <= 90
          ? 1
          : calibratedMins >= 180
            ? 1 + Math.ceil((calibratedMins - 45) / 90)
            : Math.ceil(calibratedMins / 75);

  const destinationLabel = settings.writableCalendarId
    ? describeCalendar({
        title: settings.writableCalendarTitle,
        sourceTitle: settings.writableCalendarSource,
      })
    : "Select UMich write calendar";

  const activeReadCount = settings.readCalendarIds.length;

  const submitTask = (useGemmaBreakdown: boolean) => {
    if (!title.trim() || busy || decomposingWithAi) return;
    onAddTask({
      title: title.trim(),
      gutMinutes: rawGut,
      applyMultiplier,
      deadlineDateKey: deadline || undefined,
      useGemmaBreakdown,
    });
    setTitle("");
    setDeadline("");
  };

  const handleAddBusyRange = (e: React.FormEvent) => {
    e.preventDefault();
    if (!busyStart) return;
    const end = busyEnd && busyEnd >= busyStart ? busyEnd : busyStart;
    const nextRange: BusyDateRange = {
      id: `busy-${Date.now()}`,
      label: busyLabel.trim() || "Busy / Out of Pocket",
      startDateKey: busyStart,
      endDateKey: end,
    };
    onUpdateSettings({
      busyDateRanges: [...(settings.busyDateRanges ?? []), nextRange],
    });
    setBusyLabel("");
    setBusyStart("");
    setBusyEnd("");
  };

  return (
    <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-2xs">
      {/* Top Bar: Calendar Scope Summary + Principle 4 Re-Plan & Pull Forward */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onScopeDialogOpenChange(true)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted ${
              settings.writableCalendarId
                ? "border-border bg-muted/40 text-foreground"
                : "border-amber-500/60 bg-amber-500/10 text-amber-900 dark:text-amber-200"
            }`}
          >
            <CalendarCog className="size-3.5" />
            <span>
              Write: <strong>{destinationLabel}</strong>
            </span>
            <span className="text-muted-foreground">
              · Read:{" "}
              {activeReadCount > 0
                ? `${activeReadCount} calendar${activeReadCount === 1 ? "" : "s"}`
                : "UMich only"}
            </span>
          </button>

          {measured !== null && (
            <Badge
              variant="outline"
              className="font-mono text-[10.5px]"
              title={`Measured across ${sampleCount} completed blocks`}
            >
              Measured ×{measured.toFixed(2)} ({sampleCount} done)
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {overdueCount > 0 && (
            <Button
              size="xs"
              variant="secondary"
              disabled={busy}
              onClick={onReplanOverdue}
              className="gap-1"
              title="Move unfinished blocks from earlier today & past days into fresh open slots"
            >
              <RotateCcw className="size-3" />
              Re-plan {overdueCount} unfinished
            </Button>
          )}

          {futurePullableCount > 0 && (
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={onPullFutureTaskIntoToday}
              className="gap-1"
              title="Finished early today? Pull 1 upcoming task segment into open space today"
            >
              <ArrowDownLeft className="size-3" />
              Pull 1 task into today
            </Button>
          )}
        </div>
      </div>

      {/* Main Composer Form */}
      <form
        className="mt-3 space-y-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          submitTask(false);
        }}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder='e.g. "AIIM fellowship. 2 hours each week for the next two weeks" or "Review UIST draft 90m"'
            className="flex-1 text-xs"
          />
          <Button
            type="submit"
            size="sm"
            disabled={
              busy ||
              decomposingWithAi ||
              !title.trim() ||
              !settings.writableCalendarId
            }
            className="gap-1.5 shrink-0"
          >
            {busy && !decomposingWithAi ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CalendarPlus className="size-3.5" />
            )}
            {parsedIntent?.mode === "weekly-cadence"
              ? `Schedule "${parsedIntent.canonicalTitle}" (${formatDuration(
                  parsedIntent.weeklyCadence!.minutesPerWeek
                )}/wk × ${parsedIntent.weeklyCadence!.weeksCount}w)`
              : approxSegments > 1
                ? `Schedule ${approxSegments} Blocks (${formatDuration(calibratedMins)})`
                : `Put ${formatDuration(calibratedMins)} on Calendar`}
          </Button>
        </div>

        {parsedIntent && parsedIntent.canonicalTitle !== title.trim() && (
          <div className="rounded-lg border bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground">
            Standard title:{" "}
            <strong className="text-foreground">
              {parsedIntent.canonicalTitle}
            </strong>
            {parsedIntent.mode === "weekly-cadence" &&
              parsedIntent.weeklyCadence &&
              ` · ${formatDuration(
                parsedIntent.weeklyCadence.minutesPerWeek
              )}/week across ${parsedIntent.weeklyCadence.weeksCount} weeks (auto-links Mail & PDFs)`}
            {parsedIntent.mode === "explicit-block-count" &&
              parsedIntent.explicitBlocks &&
              ` · ${parsedIntent.explicitBlocks.count} × ${formatDuration(
                parsedIntent.explicitBlocks.durationMinutesEach
              )} blocks`}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={gutMinutes}
              onValueChange={(v) => {
                if (v) setGutMinutes(v);
              }}
            >
              <SelectTrigger size="sm" className="h-7 min-w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GUT_ESTIMATES.map((item) => (
                  <SelectItem key={item.mins} value={String(item.mins)}>
                    Gut: {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">
                Deadline:
              </span>
              <Input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="h-7 w-[142px] text-xs"
                aria-label="Optional deadline for backtracking"
              />
            </div>

            <button
              type="button"
              onClick={() => setApplyMultiplier((p) => !p)}
              className={`rounded-md border px-2 py-1 font-mono text-[11px] transition-colors ${
                applyMultiplier
                  ? "border-orange-500/40 bg-orange-500/10 text-orange-900 dark:text-orange-200"
                  : "bg-muted/40 text-muted-foreground"
              }`}
              title="Toggle calibration multiplier (turn off for fixed-length workouts/meals)"
            >
              {applyMultiplier
                ? `×${settings.calibrationMultiplier} → ${formatDuration(calibratedMins)}`
                : "Exact (×1.0)"}
            </button>
          </div>

          {approxSegments > 1 && title.trim().length > 2 && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={
                busy || decomposingWithAi || !settings.writableCalendarId
              }
              onClick={() => submitTask(true)}
              className="gap-1"
              title="Wake local Gemma 4 briefly to name each milestone concretely, place on UMich calendar, then sleep"
            >
              {decomposingWithAi ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Sparkles className="size-3" />
              )}
              Smart Breakdown with Gemma 4
            </Button>
          )}
        </div>
      </form>

      {!settings.writableCalendarId && (
        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          <span>
            Choose your personal UMich calendar so Dayframe knows which single calendar to write to.
          </span>
          <Button
            size="xs"
            variant="outline"
            onClick={() => onScopeDialogOpenChange(true)}
          >
            Select Calendar
          </Button>
        </div>
      )}

      {scarcityWarning && (
        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl border border-orange-500/45 bg-orange-500/10 px-3 py-2 text-xs text-orange-950 dark:text-orange-200">
          <span>{scarcityWarning}</span>
          <Button size="xs" variant="ghost" onClick={onDismissScarcityWarning}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Calendar Scope (Read + Write) & Rhythm / Buffers / Blackout Dates Dialog */}
      <Dialog open={scopeDialogOpen} onOpenChange={onScopeDialogOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Calendars, Calibration &amp; Rhythm</DialogTitle>
            <DialogDescription>
              Control exactly which calendars Dayframe reads from, lock writes to your personal UMich calendar, and set your real buffers.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="calendars" className="w-full text-xs">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="calendars" className="text-xs">
                1. Read &amp; Write Calendars
              </TabsTrigger>
              <TabsTrigger value="rhythm" className="text-xs">
                2. Multiplier, Buffers &amp; Busy Days
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: Explicit Write Target + Read/Take-From Checkboxes */}
            <TabsContent value="calendars" className="mt-3 space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-semibold">
                    Write New Tasks, Segments &amp; Prep ONLY To:
                  </label>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={onRefreshCalendars}
                  >
                    Refresh List
                  </Button>
                </div>
                {writableCalendars.length === 0 ? (
                  <p className="rounded-lg border bg-muted/30 p-3 text-muted-foreground">
                    Pair with <code>./dayframe</code> and run Sync Calendar once to load your macOS Calendar.app accounts.
                  </p>
                ) : (
                  <Select
                    value={settings.writableCalendarId || undefined}
                    onValueChange={(val) => {
                      if (val) onSelectWriteCalendar(val);
                    }}
                  >
                    <SelectTrigger className="w-full text-xs">
                      <SelectValue placeholder="Choose your personal UMich calendar" />
                    </SelectTrigger>
                    <SelectContent>
                      {writableCalendars.map((cal) => (
                        <SelectItem key={cal.id} value={cal.id}>
                          {describeCalendar(cal)}
                          {isPersonalUmichCalendar(cal.title, cal.sourceTitle)
                            ? " (UMich)"
                            : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Hard-locked: Dayframe never writes to any other calendar.
                </p>
              </div>

              <div className="space-y-2 border-t pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold">
                      Take / Read Meetings &amp; Busy Slots From:
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Unchecked calendars are completely ignored — zero clutter from shared or holiday calendars.
                    </p>
                  </div>
                  {calendars.length > 0 && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={onSelectOnlyUmichReadCalendar}
                    >
                      Only My UMich Calendar
                    </Button>
                  )}
                </div>

                <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border bg-muted/20 p-2">
                  {calendars.length === 0 ? (
                    <p className="py-4 text-center text-[11px] text-muted-foreground">
                      No calendars loaded yet.
                    </p>
                  ) : (
                    calendars.map((cal) => {
                      const isWriteTarget =
                        cal.id === settings.writableCalendarId;
                      const isChecked =
                        isWriteTarget ||
                        settings.readCalendarIds.includes(cal.id);

                      return (
                        <label
                          key={cal.id}
                          className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border bg-background px-2.5 py-2 hover:bg-muted/40"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 font-medium">
                              <span className="truncate">
                                {describeCalendar(cal)}
                              </span>
                              {isWriteTarget && (
                                <Badge variant="default" className="text-[9.5px]">
                                  Write Target
                                </Badge>
                              )}
                              {!isWriteTarget && isChecked && (
                                <Badge variant="outline" className="text-[9.5px]">
                                  Busy Only
                                </Badge>
                              )}
                            </div>
                          </div>

                          <Switch
                            checked={isChecked}
                            disabled={isWriteTarget}
                            onCheckedChange={(checked) =>
                              onToggleReadCalendar(cal.id, checked)
                            }
                          />
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </TabsContent>

            {/* TAB 2: Calibration Multiplier, Buffers, Morning Rhythm & Travel/Busy Days */}
            <TabsContent value="rhythm" className="mt-3 space-y-3.5">
              <div className="grid grid-cols-2 gap-3 rounded-xl border p-3">
                <div className="space-y-1">
                  <label className="font-medium">
                    Calibration Multiplier (Principle 2)
                  </label>
                  <Select
                    value={String(settings.calibrationMultiplier)}
                    onValueChange={(v) => {
                      if (v)
                        onUpdateSettings({ calibrationMultiplier: Number(v) });
                    }}
                  >
                    <SelectTrigger className="w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">×1.0 (Exact gut)</SelectItem>
                      <SelectItem value="1.25">×1.25 (+25% buffer)</SelectItem>
                      <SelectItem value="1.5">×1.5 (Recommended)</SelectItem>
                      <SelectItem value="1.75">×1.75 (+75% buffer)</SelectItem>
                      <SelectItem value="2">×2.0 (Double gut)</SelectItem>
                    </SelectContent>
                  </Select>
                  {measured !== null && (
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings({ calibrationMultiplier: measured })
                      }
                      className="inline-flex items-center gap-1 text-[10.5px] font-medium text-primary hover:underline"
                    >
                      <Check className="size-3" />
                      Apply measured ×{measured} ({sampleCount} tasks)
                    </button>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="font-medium">
                    Daily Unexpected Buffer (Principle 3)
                  </label>
                  <Select
                    value={String(settings.dailyBufferMinutes)}
                    onValueChange={(v) => {
                      if (v)
                        onUpdateSettings({ dailyBufferMinutes: Number(v) });
                    }}
                  >
                    <SelectTrigger className="w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0m buffer</SelectItem>
                      <SelectItem value="30">30m / day empty</SelectItem>
                      <SelectItem value="60">60m / day empty (Default)</SelectItem>
                      <SelectItem value="90">90m / day empty</SelectItem>
                      <SelectItem value="120">2h / day empty</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-xl border p-3">
                  <div className="pr-2">
                    <div className="font-medium">Protect Weekends</div>
                    <div className="text-[10.5px] text-muted-foreground">
                      Keep Sat/Sun open (&ldquo;Goof Off&rdquo;) unless deadline forces it
                    </div>
                  </div>
                  <Switch
                    checked={settings.protectWeekends}
                    onCheckedChange={(checked) =>
                      onUpdateSettings({ protectWeekends: checked })
                    }
                  />
                </div>

                <div className="space-y-1 rounded-xl border p-3">
                  <label className="font-medium">Morning Temperament</label>
                  <Select
                    value={String(settings.notAMorningPersonUntilMinutes || 0)}
                    onValueChange={(v) => {
                      if (v)
                        onUpdateSettings({
                          notAMorningPersonUntilMinutes: Number(v),
                        });
                    }}
                  >
                    <SelectTrigger className="h-7 w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Start at 9:00 AM</SelectItem>
                      <SelectItem value="600">
                        Not a morning person (after 10:00 AM)
                      </SelectItem>
                      <SelectItem value="660">
                        Protect mornings until 11:00 AM
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Principle 6: Mark Travel / Conference / Crunch Weeks Busy */}
              <div className="space-y-2 rounded-xl border p-3">
                <div>
                  <div className="font-medium">
                    Travel, Family, or Pre-Deadline Crunch Days (Principle 6)
                  </div>
                  <p className="text-[10.5px] text-muted-foreground">
                    Mark days where tasks won&apos;t happen so Dayframe backtracks deadlines into earlier open weeks.
                  </p>
                </div>

                <form
                  onSubmit={handleAddBusyRange}
                  className="flex flex-wrap items-center gap-1.5"
                >
                  <Input
                    value={busyLabel}
                    onChange={(e) => setBusyLabel(e.target.value)}
                    placeholder="e.g. Conference travel / Crunch week"
                    className="h-7 min-w-[140px] flex-1 text-xs"
                  />
                  <Input
                    type="date"
                    value={busyStart}
                    onChange={(e) => setBusyStart(e.target.value)}
                    className="h-7 w-[130px] text-xs"
                  />
                  <span className="text-muted-foreground">to</span>
                  <Input
                    type="date"
                    value={busyEnd}
                    onChange={(e) => setBusyEnd(e.target.value)}
                    className="h-7 w-[130px] text-xs"
                  />
                  <Button type="submit" size="xs" disabled={!busyStart}>
                    Mark Busy
                  </Button>
                </form>

                {(settings.busyDateRanges ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {settings.busyDateRanges.map((r) => (
                      <Badge
                        key={r.id}
                        variant="secondary"
                        className="gap-1 text-[10px]"
                      >
                        {r.label} ({r.startDateKey}
                        {r.endDateKey !== r.startDateKey
                          ? ` → ${r.endDateKey}`
                          : ""}
                        )
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateSettings({
                              busyDateRanges: settings.busyDateRanges.filter(
                                (x) => x.id !== r.id
                              ),
                            })
                          }
                          className="ml-0.5 hover:text-destructive"
                        >
                          <Trash2 className="size-2.5" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </section>
  );
}
