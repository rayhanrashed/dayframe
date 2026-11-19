"use client";

import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScreenshotCapture } from "@/lib/types";
import {
  AlertCircle,
  ArrowUpRight,
  CalendarPlus,
  Camera,
  CheckCircle2,
  Clock,
  HelpCircle,
  ImagePlus,
  Layers,
  Play,
} from "lucide-react";

interface CaptureStreamPanelProps {
  captures: ScreenshotCapture[];
  queuedBatchCount: number;
  isRunningBatch: boolean;
  onRunBatchNow: () => void;
  captureError: string | null;
  onDismissCaptureError: () => void;
  onUploadScreenshotFile: (file: File) => void;
  onSelectBlockId: (blockId: string) => void;
  gemmaModel: string;
}

export function CaptureStreamPanel({
  captures,
  queuedBatchCount,
  isRunningBatch,
  onRunBatchNow,
  captureError,
  onDismissCaptureError,
  onUploadScreenshotFile,
  onSelectBlockId,
  gemmaModel,
}: CaptureStreamPanelProps) {
  const [selectedCapture, setSelectedCapture] =
    useState<ScreenshotCapture | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const macCaptures = captures.filter((c) => c.device === "macbook");

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          onUploadScreenshotFile(file);
          return;
        }
      }
    }
  };

  return (
    <aside
      onPaste={handlePaste}
      className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-3.5 shadow-2xs"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">
            Captured Screen Queue
          </h2>
          <p className="text-[11px] text-muted-foreground">
            0 MB AI RAM while queued • Batch via{" "}
            <span className="font-mono">{gemmaModel}</span>
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                onUploadScreenshotFile(f);
                e.target.value = "";
              }
            }}
          />
          <Button
            variant="outline"
            size="xs"
            onClick={() => fileInputRef.current?.click()}
            className="gap-1"
            title="Drop or paste (⌘V) a screenshot into the offline queue"
          >
            <ImagePlus className="size-3" />
            Add Shot
          </Button>
        </div>
      </div>

      {queuedBatchCount > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-xs">
          <div>
            <div className="font-medium">
              {queuedBatchCount} shot{queuedBatchCount === 1 ? "" : "s"} queued
            </div>
            <div className="text-[10.5px] text-muted-foreground">
              Models stay stopped until batch sweep
            </div>
          </div>
          <Button
            size="xs"
            onClick={onRunBatchNow}
            disabled={isRunningBatch}
            className="gap-1"
          >
            <Play className="size-3" />
            {isRunningBatch ? "Sweeping..." : "Sweep Now"}
          </Button>
        </div>
      )}

      {captureError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-200">
          <p>{captureError}</p>
          <Button
            variant="ghost"
            size="xs"
            onClick={onDismissCaptureError}
            className="mt-1.5 h-6 px-2 text-[11px]"
          >
            Dismiss
          </Button>
        </div>
      )}

      <div className="flex max-h-[610px] flex-col gap-2.5 overflow-y-auto pr-0.5">
        {macCaptures.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-4 py-12 text-center">
            <Camera className="mb-2.5 size-6 text-muted-foreground" />
            <p className="text-xs font-medium">No screenshots queued yet</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Click{" "}
              <span className="font-medium text-foreground">
                Start Silent Queue
              </span>{" "}
              in the top bar (or paste a screenshot with{" "}
              <kbd className="rounded border px-1">⌘V</kbd>). Frames queue using{" "}
              <span className="font-medium text-foreground">0 MB AI RAM</span>{" "}
              until a batch sweep runs.
            </p>
          </div>
        ) : (
          macCaptures.map((cap) => (
            <div
              key={cap.id}
              className="group rounded-xl border border-border/70 bg-background p-2.5 transition-colors hover:border-foreground/25"
            >
              <div className="mb-2 flex items-center justify-between gap-1.5">
                <span className="truncate text-xs font-medium">
                  {cap.appName}
                </span>

                {cap.syncState === "queued-for-batch" && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <Clock className="size-2.5" />
                    Queued (0 MB RAM)
                  </Badge>
                )}
                {cap.syncState === "awaiting-confirmation" && (
                  <Badge
                    variant="outline"
                    className="gap-1 border-amber-500/50 bg-amber-500/10 text-[10px] text-amber-800 dark:text-amber-200"
                  >
                    <HelpCircle className="size-2.5" />
                    Asking You
                  </Badge>
                )}
                {cap.syncState === "scheduled" && (
                  <Badge variant="secondary" className="gap-1 text-[10px]">
                    <CheckCircle2 className="size-2.5 text-emerald-500" />
                    {cap.extractedSignal?.isSoloInvite
                      ? "Solo Hold"
                      : "Scheduled"}
                  </Badge>
                )}
                {cap.syncState === "deduplicated" && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <Layers className="size-2.5" />
                    Duplicate Skipped
                  </Badge>
                )}
                {cap.syncState === "no-action" && (
                  <Badge variant="outline" className="text-[10px]">
                    No New Task
                  </Badge>
                )}
                {cap.syncState === "filtered-by-valen" && (
                  <Badge variant="outline" className="text-[10px]">
                    Skipped by Valen (p=
                    {(cap.valenGate?.signalProbability ?? 0).toFixed(2)})
                  </Badge>
                )}
                {cap.syncState === "needs-gemma" && (
                  <Badge
                    variant="outline"
                    className="gap-1 border-amber-500/40 text-[10px] text-amber-700 dark:text-amber-300"
                  >
                    <AlertCircle className="size-2.5" />
                    Waiting for Batch
                  </Badge>
                )}
              </div>

              {cap.imageDataUrl && (
                <button
                  type="button"
                  onClick={() => setSelectedCapture(cap)}
                  className="mb-2 block w-full overflow-hidden rounded-lg border bg-muted/40"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={cap.imageDataUrl}
                    alt={cap.windowTitle}
                    className="h-24 w-full object-cover"
                  />
                </button>
              )}

              <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                {cap.summaryText}
              </p>

              {cap.valenGate && cap.syncState !== "filtered-by-valen" && (
                <div className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                  Valen p={cap.valenGate.signalProbability.toFixed(2)} •{" "}
                  {cap.valenGate.intentChoice}
                  {cap.valenGate.bboxCropped ? " • bbox cropped" : ""}
                </div>
              )}

              {cap.createdBlockId && cap.extractedSignal && (
                <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
                  <span className="truncate text-[11px] font-medium">
                    {cap.extractedSignal.title}
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => onSelectBlockId(cap.createdBlockId!)}
                    className="shrink-0 gap-0.5 text-[11px]"
                  >
                    Inspect
                    <ArrowUpRight className="size-3" />
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <Dialog
        open={Boolean(selectedCapture)}
        onOpenChange={(open) => {
          if (!open) setSelectedCapture(null);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          {selectedCapture && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {selectedCapture.appName} — {selectedCapture.windowTitle}
                </DialogTitle>
                <DialogDescription>
                  Model: {selectedCapture.modelUsed}
                  {selectedCapture.inferenceMs
                    ? ` • ${selectedCapture.inferenceMs}ms`
                    : ""}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-xs">
                {selectedCapture.imageDataUrl && (
                  <div className="overflow-hidden rounded-xl border bg-muted/30">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={selectedCapture.imageDataUrl}
                      alt={selectedCapture.windowTitle}
                      className="max-h-80 w-full object-contain"
                    />
                  </div>
                )}
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="font-medium">Local Assessment</div>
                  <p className="mt-1 text-muted-foreground">
                    {selectedCapture.summaryText}
                  </p>
                </div>
                {selectedCapture.createdBlockId && (
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => {
                        const id = selectedCapture.createdBlockId!;
                        setSelectedCapture(null);
                        onSelectBlockId(id);
                      }}
                      className="gap-1.5"
                    >
                      <CalendarPlus className="size-3.5" />
                      Show on Calendar
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </aside>
  );
}
