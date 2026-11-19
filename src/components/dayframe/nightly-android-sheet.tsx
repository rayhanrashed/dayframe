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
  FolderSync,
  ImagePlus,
  Layers,
  Loader2,
  Moon,
  RefreshCw,
  Smartphone,
  Sparkles,
} from "lucide-react";

interface NightlyAndroidSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  androidCaptures: ScreenshotCapture[];
  androidFolderPath: string;
  macBridgePaired: boolean;
  nightlySyncHour: number;
  gemmaModel: string;
  isRunningBatch: boolean;
  lastBatchSummary: string | null;
  onRefreshMacAndroidFolder: () => void;
  onRunNightlyBatchNow: () => void;
  onUploadAndroidScreenshot: (file: File) => void;
}

export function NightlyAndroidSheet({
  open,
  onOpenChange,
  androidCaptures,
  androidFolderPath,
  macBridgePaired,
  nightlySyncHour,
  gemmaModel,
  isRunningBatch,
  lastBatchSummary,
  onRefreshMacAndroidFolder,
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
              Android Companion Sync
            </Badge>
            <Badge variant="outline" className="gap-1 text-[10px]">
              <Moon className="size-3" />
              {nightlySyncHour - 12}:00 PM Nightly Batch
            </Badge>
          </div>
          <SheetTitle className="pt-1">
            Phone Raw Screenshots → Nightly Mac Gemma 4 Sync
          </SheetTitle>
          <SheetDescription>
            Sync raw Android screenshots into{" "}
            <code className="rounded bg-muted px-1 text-[11px]">
              {androidFolderPath}
            </code>{" "}
            (via Syncthing or FolderSync) with zero on-phone AI processing. At night,{" "}
            <code className="rounded bg-muted px-1 text-[11px]">
              {gemmaModel}
            </code>{" "}
            processes them on your Mac, skips duplicates already seen on your MacBook, and schedules net-new blocks onto Tomorrow&apos;s calendar.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          <div className="grid grid-cols-3 gap-2 rounded-xl border bg-muted/30 p-3 text-center text-[11px]">
            <div className="space-y-1">
              <BatteryCharging className="mx-auto size-4 text-emerald-500" />
              <div className="font-semibold">1. Capture</div>
              <div className="text-[10px] text-muted-foreground">
                0% AI battery on Android
              </div>
            </div>
            <div className="space-y-1">
              <Layers className="mx-auto size-4 text-sky-500" />
              <div className="font-semibold">2. Reconcile</div>
              <div className="text-[10px] text-muted-foreground">
                Deduplicates vs Mac shots
              </div>
            </div>
            <div className="space-y-1">
              <CalendarPlus className="mx-auto size-4 text-violet-500" />
              <div className="font-semibold">3. Tomorrow</div>
              <div className="text-[10px] text-muted-foreground">
                Writes net-new blocks
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3">
            <div className="text-xs">
              <div className="font-semibold">
                {queuedCount > 0
                  ? `${queuedCount} phone screenshot${
                      queuedCount === 1 ? "" : "s"
                    } queued`
                  : "Queue empty"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {macBridgePaired
                  ? `Watching ${androidFolderPath}`
                  : "Pair Mac Bridge to auto-scan synced folder, or add shots manually"}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {macBridgePaired && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onRefreshMacAndroidFolder}
                  className="gap-1 text-xs"
                >
                  <RefreshCw className="size-3.5" />
                  Scan Folder
                </Button>
              )}

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    onUploadAndroidScreenshot(f);
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
                Add Shot
              </Button>

              <Button
                size="sm"
                disabled={queuedCount === 0 || isRunningBatch}
                onClick={onRunNightlyBatchNow}
                className="gap-1.5 text-xs"
              >
                {isRunningBatch ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                {isRunningBatch ? "Running Gemma 4..." : "Process Queue Now"}
              </Button>
            </div>
          </div>

          {lastBatchSummary && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-900 dark:text-emerald-200">
              {lastBatchSummary}
            </div>
          )}

          {androidCaptures.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center text-xs">
              <FolderSync className="mb-2 size-6 text-muted-foreground" />
              <div className="font-medium">No Android screenshots queued</div>
              <p className="mt-1 max-w-xs text-[11px] text-muted-foreground">
                Point Syncthing or FolderSync on Android to{" "}
                <code>~/Pictures/Dayframe-Android</code> on your Mac, or drop phone screenshots above.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {androidCaptures.map((cap) => (
                <div
                  key={cap.id}
                  className="rounded-xl border bg-background p-3 text-xs"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="truncate font-semibold">
                      {cap.windowTitle}
                    </span>
                    {cap.syncState === "queued-for-tonight" && (
                      <Badge variant="outline" className="text-[10px]">
                        Queued
                      </Badge>
                    )}
                    {cap.syncState === "scheduled" && (
                      <Badge variant="secondary" className="gap-1 text-[10px]">
                        <CheckCircle2 className="size-3 text-emerald-500" />
                        Scheduled Tomorrow
                      </Badge>
                    )}
                    {cap.syncState === "deduplicated" && (
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <Layers className="size-3" />
                        Matched Mac Capture
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
                    {cap.summaryText}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
