"use client";

import React, { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScreenshotCapture } from "@/lib/types";
import {
  BatteryCharging,
  CalendarPlus,
  CheckCircle2,
  ImagePlus,
  Layers,
  Moon,
  Smartphone,
  Sparkles,
} from "lucide-react";

interface NightlyAndroidSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  androidCaptures: ScreenshotCapture[];
  nightlySyncHour: number;
  isRunningBatch: boolean;
  lastBatchSummary: string | null;
  onRunNightlyBatchNow: () => void;
  onUploadAndroidScreenshot: (file: File) => void;
}

export function NightlyAndroidSheet({
  open,
  onOpenChange,
  androidCaptures,
  nightlySyncHour,
  isRunningBatch,
  lastBatchSummary,
  onRunNightlyBatchNow,
  onUploadAndroidScreenshot,
}: NightlyAndroidSheetProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const queuedCount = androidCaptures.filter(
    (c) => c.syncState === "queued-for-tonight"
  ).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-lg"
      >
        <SheetHeader className="border-b pb-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <Smartphone className="size-3" />
              Companion Preview
            </Badge>
            <Badge variant="outline" className="gap-1 text-[10px]">
              <Moon className="size-3" />
              Scheduled {nightlySyncHour - 12}:00 PM Nightly
            </Badge>
          </div>
          <SheetTitle className="pt-1">
            Android Raw Capture → Nightly Mac Sync
          </SheetTitle>
          <SheetDescription>
            Your Android phone captures lightweight screenshots on the go with{" "}
            <span className="font-medium text-foreground">
              zero on-phone AI drain
            </span>
            . At night, your MacBook batch-processes them, deduplicates items already seen on your Mac, and organizes Tomorrow&apos;s calendar.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          {/* Architecture Summary Strip */}
          <div className="grid grid-cols-3 gap-2 rounded-xl border bg-muted/30 p-3 text-center text-[11px]">
            <div className="space-y-1">
              <BatteryCharging className="mx-auto size-4 text-emerald-500" />
              <div className="font-semibold">1. Android</div>
              <div className="text-[10px] text-muted-foreground">
                Raw screenshots only (0% AI battery)
              </div>
            </div>
            <div className="space-y-1">
              <Layers className="mx-auto size-4 text-sky-500" />
              <div className="font-semibold">2. Reconcile</div>
              <div className="text-[10px] text-muted-foreground">
                Matches &amp; skips Mac duplicates
              </div>
            </div>
            <div className="space-y-1">
              <CalendarPlus className="mx-auto size-4 text-violet-500" />
              <div className="font-semibold">3. Next Day</div>
              <div className="text-[10px] text-muted-foreground">
                Slots net-new blocks Tomorrow
              </div>
            </div>
          </div>

          {/* Primary Batch Action */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3">
            <div>
              <div className="text-xs font-semibold">
                {queuedCount > 0
                  ? `${queuedCount} raw phone screenshot${
                      queuedCount === 1 ? "" : "s"
                    } waiting for tonight`
                  : "All phone screenshots reconciled for Tomorrow"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Sync via Syncthing / FolderSync or drop screenshots manually
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    onUploadAndroidScreenshot(file);
                    e.target.value = "";
                  }
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                className="gap-1 text-xs"
              >
                <ImagePlus className="size-3.5" />
                Add Phone Shot
              </Button>
              <Button
                size="sm"
                disabled={queuedCount === 0 || isRunningBatch}
                onClick={onRunNightlyBatchNow}
                className="gap-1.5 text-xs"
              >
                <Sparkles className="size-3.5" />
                {isRunningBatch
                  ? "Processing on Mac..."
                  : "Run Nightly Sync Now"}
              </Button>
            </div>
          </div>

          {lastBatchSummary && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-900 dark:text-emerald-200">
              <div className="font-semibold">Nightly Sync Complete</div>
              <p className="mt-0.5 text-[11px]">{lastBatchSummary}</p>
            </div>
          )}

          {/* Android Queue Cards */}
          <div className="space-y-2.5">
            {androidCaptures.map((cap) => (
              <div
                key={cap.id}
                className="rounded-xl border bg-background p-3 text-xs"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-semibold">{cap.appName}</span>
                  {cap.syncState === "queued-for-tonight" && (
                    <Badge variant="outline" className="text-[10px]">
                      Queued for {nightlySyncHour - 12}:00 PM
                    </Badge>
                  )}
                  {cap.syncState === "scheduled" && (
                    <Badge
                      variant="secondary"
                      className="gap-1 text-[10px] text-emerald-700 dark:text-emerald-300"
                    >
                      <CheckCircle2 className="size-3" />
                      Added to Tomorrow
                    </Badge>
                  )}
                  {cap.syncState === "deduplicated" && (
                    <Badge variant="secondary" className="gap-1 text-[10px]">
                      <Layers className="size-3 text-sky-500" />
                      Matched Mac Shot (Skipped Duplicate)
                    </Badge>
                  )}
                </div>

                <div className="mb-2 overflow-hidden rounded-lg border bg-muted/20">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={cap.imageDataUrl}
                    alt={cap.windowTitle}
                    className="h-32 w-full object-cover"
                  />
                </div>

                <p className="text-[11px] text-muted-foreground">
                  {cap.ocrPreview}
                </p>

                {cap.syncState === "deduplicated" && (
                  <p className="mt-1.5 rounded bg-muted px-2 py-1 text-[10.5px] font-medium">
                    Reconciled with earlier MacBook Slack screenshot — kept existing calendar block without duplicating.
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
