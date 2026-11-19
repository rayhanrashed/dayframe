"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarBlock, ConfirmationPolicy } from "@/lib/types";
import {
  formatDateKeyLabel,
  formatDuration,
  formatMinutesToTime,
} from "@/lib/scheduler";
import {
  ArrowRight,
  CalendarCheck,
  Check,
  CheckCheck,
  Clock,
  HelpCircle,
  Sparkles,
  X,
} from "lucide-react";

interface PendingConfirmationsDeckProps {
  todayKey: string;
  proposedBlocks: CalendarBlock[];
  confirmationPolicy: ConfirmationPolicy;
  onChangeConfirmationPolicy: (policy: ConfirmationPolicy) => void;
  onApproveBlock: (id: string, rememberAlwaysRule: boolean) => void;
  onSkipBlock: (id: string, rememberNeverRule: boolean) => void;
  onApproveAll: () => void;
  onSetBlockExactDuration: (id: string, minutes: number) => void;
  onMoveBlockToNextSlot: (id: string) => void;
  onPushBlockTomorrow: (id: string) => void;
}

const QUICK_DURATIONS = [15, 30, 45, 60, 90];

export function PendingConfirmationsDeck({
  todayKey,
  proposedBlocks,
  confirmationPolicy,
  onChangeConfirmationPolicy,
  onApproveBlock,
  onSkipBlock,
  onApproveAll,
  onSetBlockExactDuration,
  onMoveBlockToNextSlot,
  onPushBlockTomorrow,
}: PendingConfirmationsDeckProps) {
  return (
    <section
      className={`rounded-2xl border p-4 shadow-2xs transition-colors ${
        proposedBlocks.length > 0
          ? "border-amber-500/45 bg-amber-500/[0.06]"
          : "border-border/80 bg-card"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex size-7 items-center justify-center rounded-xl ${
              proposedBlocks.length > 0
                ? "bg-amber-500/20 text-amber-800 dark:text-amber-200"
                : "bg-muted text-muted-foreground"
            }`}
          >
            <HelpCircle className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold tracking-tight">
                {proposedBlocks.length > 0
                  ? `Should I Put ${
                      proposedBlocks.length === 1
                        ? "This"
                        : `These (${proposedBlocks.length})`
                    } on Your Calendar?`
                  : "Calendar Confirmation Queue"}
              </h2>
              {proposedBlocks.length > 0 && (
                <Badge className="bg-amber-600 text-[10px] text-white hover:bg-amber-600">
                  {proposedBlocks.length} awaiting your call
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {proposedBlocks.length > 0
                ? "Nothing below touches macOS Calendar.app until you click Yes."
                : "No pending questions right now — whenever an email, Slack message, or duration is uncertain, I ask you here first."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={confirmationPolicy}
            onValueChange={(val) => {
              if (
                val === "ask-often" ||
                val === "always-ask" ||
                val === "auto-high-confidence"
              ) {
                onChangeConfirmationPolicy(val);
              }
            }}
          >
            <SelectTrigger size="sm" className="h-7 min-w-[165px] bg-background text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ask-often">
                Ask Often When Unsure (Default)
              </SelectItem>
              <SelectItem value="always-ask">
                Always Ask Every Single Item
              </SelectItem>
              <SelectItem value="auto-high-confidence">
                Ask Only Low-Confidence (&lt;72%)
              </SelectItem>
            </SelectContent>
          </Select>

          {proposedBlocks.length > 1 && (
            <Button
              size="xs"
              variant="outline"
              onClick={onApproveAll}
              className="gap-1"
            >
              <CheckCheck className="size-3" />
              Approve All ({proposedBlocks.length})
            </Button>
          )}
        </div>
      </div>

      {proposedBlocks.length > 0 && (
        <div className="mt-3.5 space-y-2.5">
          {proposedBlocks.map((blk) => {
            const endMin = blk.startMinutes + blk.durationMinutes;
            return (
              <div
                key={blk.id}
                className="rounded-xl border border-border/90 bg-background p-3 shadow-2xs"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">
                        {blk.uncertaintyReason || "Confirm before scheduling"}
                      </Badge>
                      <span className="text-[10.5px] text-muted-foreground">
                        Source: {blk.sourceLabel} • Confidence{" "}
                        {Math.round(blk.confidence * 100)}%
                      </span>
                    </div>
                    <p className="text-xs font-semibold leading-snug">
                      {blk.clarifyingQuestion ||
                        `Put "${blk.title}" (${formatDuration(
                          blk.durationMinutes
                        )}) on your calendar?`}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {blk.rationale}
                    </p>
                  </div>

                  <div className="rounded-lg border bg-muted/40 px-2.5 py-1.5 text-right text-xs">
                    <div className="font-medium">
                      {formatDateKeyLabel(blk.dateKey, todayKey)}
                    </div>
                    <div className="flex items-center justify-end gap-1 font-mono text-[11px] text-muted-foreground">
                      <Clock className="size-3" />
                      {formatMinutesToTime(blk.startMinutes)} –{" "}
                      {formatMinutesToTime(endMin)}
                    </div>
                  </div>
                </div>

                {/* Quick Duration & Slot Controls */}
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="mr-1 text-[10.5px] text-muted-foreground">
                      Duration:
                    </span>
                    {QUICK_DURATIONS.map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => onSetBlockExactDuration(blk.id, mins)}
                        className={`rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] transition-colors ${
                          blk.durationMinutes === mins
                            ? "border-foreground bg-foreground text-background"
                            : "bg-muted/30 text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {mins}m
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => onMoveBlockToNextSlot(blk.id)}
                      className="ml-1 inline-flex items-center gap-0.5 rounded-md border bg-muted/30 px-1.5 py-0.5 text-[10.5px] text-muted-foreground hover:bg-muted"
                      title="Move to next open gap today"
                    >
                      Later slot <ArrowRight className="size-2.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onPushBlockTomorrow(blk.id)}
                      className="inline-flex items-center gap-0.5 rounded-md border bg-muted/30 px-1.5 py-0.5 text-[10.5px] text-muted-foreground hover:bg-muted"
                      title="Move to tomorrow morning"
                    >
                      Tomorrow
                    </button>
                  </div>

                  {/* Yes / No / Remember Rule Buttons */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="xs"
                      onClick={() => onApproveBlock(blk.id, false)}
                      className="gap-1"
                    >
                      <CalendarCheck className="size-3" />
                      Yes, Put on Calendar
                    </Button>
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => onApproveBlock(blk.id, true)}
                      className="gap-1"
                      title="Add to Calendar AND remember to auto-schedule items like this"
                    >
                      <Sparkles className="size-3" />
                      Always Add Like This
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => onSkipBlock(blk.id, false)}
                      className="gap-1"
                    >
                      <X className="size-3" />
                      No, Skip
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => onSkipBlock(blk.id, true)}
                      className="text-[11px] text-muted-foreground"
                      title="Skip AND never suggest similar items again"
                    >
                      <Check className="mr-0.5 size-3 opacity-0" />
                      Never Like This
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
