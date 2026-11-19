"use client";

import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScreenshotCapture } from "@/lib/types";
import {
  ArrowUpRight,
  CalendarPlus,
  Camera,
  CheckCircle2,
  ImagePlus,
  Layers,
  Mail,
  MessageSquare,
  Sparkles,
} from "lucide-react";

interface CaptureStreamPanelProps {
  captures: ScreenshotCapture[];
  captureError: string | null;
  onDismissCaptureError: () => void;
  onUploadScreenshotFile: (file: File, noteHint?: string) => void;
  onQuickTextSimulate: (source: "mac-mail" | "mac-slack", text: string) => void;
  onSelectBlockId: (blockId: string) => void;
}

export function CaptureStreamPanel({
  captures,
  captureError,
  onDismissCaptureError,
  onUploadScreenshotFile,
  onQuickTextSimulate,
  onSelectBlockId,
}: CaptureStreamPanelProps) {
  const [selectedCapture, setSelectedCapture] =
    useState<ScreenshotCapture | null>(null);
  const [quickSnippet, setQuickSnippet] = useState("");
  const [quickSource, setQuickSource] = useState<"mac-mail" | "mac-slack">(
    "mac-mail"
  );
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
          onUploadScreenshotFile(file, quickSnippet.trim() || undefined);
          return;
        }
      }
    }
  };

  const handleQuickSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickSnippet.trim()) return;
    onQuickTextSimulate(quickSource, quickSnippet.trim());
    setQuickSnippet("");
  };

  return (
    <aside
      onPaste={handlePaste}
      className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-3.5 shadow-2xs"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">
            Mac Screen Captures
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Mail, Slack &amp; active windows → calendar blocks
          </p>
        </div>
        <Badge variant="secondary" className="font-mono text-[11px]">
          {macCaptures.length} shots
        </Badge>
      </div>

      {captureError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200">
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

      {/* Upload / Paste Real Screenshot OR Quick Email/Slack Capture Composer */}
      <form
        onSubmit={handleQuickSubmit}
        className="space-y-2 rounded-xl border border-dashed border-border bg-muted/30 p-2.5"
      >
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="xs"
              variant={quickSource === "mac-mail" ? "default" : "ghost"}
              onClick={() => setQuickSource("mac-mail")}
              className="gap-1"
            >
              <Mail className="size-3" />
              Mail
            </Button>
            <Button
              type="button"
              size="xs"
              variant={quickSource === "mac-slack" ? "default" : "ghost"}
              onClick={() => setQuickSource("mac-slack")}
              className="gap-1"
            >
              <MessageSquare className="size-3" />
              Slack
            </Button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                onUploadScreenshotFile(f, quickSnippet.trim() || undefined);
                e.target.value = "";
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => fileInputRef.current?.click()}
            className="gap-1"
          >
            <ImagePlus className="size-3" />
            Drop / Upload PNG
          </Button>
        </div>

        <Textarea
          value={quickSnippet}
          onChange={(e) => setQuickSnippet(e.target.value)}
          placeholder={
            quickSource === "mac-mail"
              ? 'Paste an email or meeting mention (e.g. "Let\'s sync on Zoom today at 3:45 PM" or paste screenshot ⌘V)...'
              : 'Paste a Slack request (e.g. "Can you draft the API migration spec today? ~60m")...'
          }
          className="min-h-16 resize-none bg-background text-xs"
        />

        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">
            Tip: Press <kbd className="rounded border px-1">⌘V</kbd> to paste any screenshot
          </span>
          <Button
            type="submit"
            size="xs"
            disabled={!quickSnippet.trim()}
            className="gap-1"
          >
            <Sparkles className="size-3" />
            Extract to Calendar
          </Button>
        </div>
      </form>

      {/* Capture Stream List */}
      <div className="flex max-h-[540px] flex-col gap-2.5 overflow-y-auto pr-0.5">
        {macCaptures.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-10 text-center">
            <Camera className="mb-2 size-6 text-muted-foreground" />
            <p className="text-xs font-medium">No screenshots captured yet</p>
            <p className="mt-0.5 max-w-[210px] text-[11px] text-muted-foreground">
              Start Live Mac Capture above or simulate an Apple Mail / Slack shot.
            </p>
          </div>
        ) : (
          macCaptures.map((cap) => {
            const isSolo = cap.extractedSignal?.isSoloInvite;
            return (
              <div
                key={cap.id}
                className="group rounded-xl border border-border/70 bg-background p-2.5 transition-colors hover:border-foreground/25"
              >
                <div className="mb-2 flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 truncate">
                    {cap.source === "mac-mail" ? (
                      <Mail className="size-3.5 shrink-0 text-blue-500" />
                    ) : cap.source === "mac-slack" ? (
                      <MessageSquare className="size-3.5 shrink-0 text-violet-500" />
                    ) : (
                      <Camera className="size-3.5 shrink-0 text-emerald-500" />
                    )}
                    <span className="truncate text-xs font-medium">
                      {cap.appName}
                    </span>
                  </div>

                  {cap.syncState === "scheduled" && (
                    <Badge
                      variant="secondary"
                      className="shrink-0 gap-1 text-[10px]"
                    >
                      <CheckCircle2 className="size-2.5 text-emerald-500" />
                      {isSolo ? "Solo Invite" : "Time-Blocked"}
                    </Badge>
                  )}
                  {cap.syncState === "deduplicated" && (
                    <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
                      <Layers className="size-2.5" />
                      Deduplicated
                    </Badge>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedCapture(cap)}
                  className="relative mb-2 block w-full overflow-hidden rounded-lg border bg-muted/40 text-left"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={cap.imageDataUrl}
                    alt={cap.windowTitle}
                    className="h-24 w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                  />
                </button>

                <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                  {cap.ocrPreview}
                </p>

                {cap.extractedSignal && cap.createdBlockId && (
                  <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
                    <span className="truncate text-[11px] font-medium text-foreground">
                      {cap.extractedSignal.title}
                    </span>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => onSelectBlockId(cap.createdBlockId!)}
                      className="shrink-0 gap-0.5 text-[11px]"
                    >
                      View slot
                      <ArrowUpRight className="size-3" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Full Screenshot Preview Modal */}
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
                <DialogTitle>{selectedCapture.windowTitle}</DialogTitle>
                <DialogDescription>
                  Captured from {selectedCapture.appName} • Processed locally on MacBook
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="overflow-hidden rounded-xl border bg-muted/30">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selectedCapture.imageDataUrl}
                    alt={selectedCapture.windowTitle}
                    className="max-h-80 w-full object-contain"
                  />
                </div>
                <div className="rounded-lg border bg-muted/40 p-3 text-xs">
                  <div className="mb-1 font-medium">Extracted Screen Text</div>
                  <p className="text-muted-foreground">
                    {selectedCapture.ocrPreview}
                  </p>
                </div>
                {selectedCapture.extractedSignal && (
                  <div className="flex items-center justify-between rounded-lg border p-3 text-xs">
                    <div>
                      <div className="font-medium">
                        {selectedCapture.extractedSignal.title}
                      </div>
                      <div className="text-muted-foreground">
                        {selectedCapture.extractedSignal.isSoloInvite
                          ? "Created Solo Calendar Hold (just for you)"
                          : `Estimated ${selectedCapture.extractedSignal.estimatedMinutes}m → placed in open calendar slot`}
                      </div>
                    </div>
                    {selectedCapture.createdBlockId && (
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
                        Inspect on Calendar
                      </Button>
                    )}
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
