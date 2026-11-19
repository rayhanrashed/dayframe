"use client";

import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
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
import { CaptureSettings } from "@/lib/types";
import { LocalOllamaStatus } from "@/lib/ollama-vlm";
import {
  Camera,
  CheckCircle2,
  Cpu,
  Download,
  Moon,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Square,
  Upload,
} from "lucide-react";

interface TopMenubarProps {
  settings: CaptureSettings;
  onUpdateSettings: (patch: Partial<CaptureSettings>) => void;
  isCapturing: boolean;
  isCapturePaused: boolean;
  onTogglePauseCapture: () => void;
  secondsUntilNext: number;
  skippedStaticCount: number;
  onStartLiveCapture: () => void;
  onStopLiveCapture: () => void;
  onSnapNow: () => void;
  onSimulateNextMacCapture: () => void;
  isProcessingCapture: boolean;
  ollamaStatus: LocalOllamaStatus;
  onRecheckOllama: () => void;
  queuedAndroidCount: number;
  onOpenAndroidSync: () => void;
  onExportIcs: () => void;
  onImportIcsFile: (file: File) => void;
  hasSampleData: boolean;
  onResetSampleWorkspace: () => void;
}

function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function TopMenubar({
  settings,
  onUpdateSettings,
  isCapturing,
  isCapturePaused,
  onTogglePauseCapture,
  secondsUntilNext,
  skippedStaticCount,
  onStartLiveCapture,
  onStopLiveCapture,
  onSnapNow,
  onSimulateNextMacCapture,
  isProcessingCapture,
  ollamaStatus,
  onRecheckOllama,
  queuedAndroidCount,
  onOpenAndroidSync,
  onExportIcs,
  onImportIcsFile,
  hasSampleData,
  onResetSampleWorkspace,
}: TopMenubarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ollamaDialogOpen, setOllamaDialogOpen] = useState(false);
  const icsInputRef = useRef<HTMLInputElement | null>(null);

  const presetIntervals = [
    { value: "1", label: "Every 1 min" },
    { value: "3", label: "Every 3 min" },
    { value: "5", label: "Every 5 min" },
    { value: "10", label: "Every 10 min" },
    { value: "15", label: "Every 15 min" },
  ];

  const currentSelectValue = presetIntervals.some(
    (p) => Number(p.value) === settings.intervalMinutes
  )
    ? String(settings.intervalMinutes)
    : "custom";

  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 lg:px-6">
        {/* Left: MacBook App Identity & Sample Data Status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-xl bg-foreground text-background shadow-xs">
              <Camera className="size-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-tight">
                  Dayframe
                </span>
                <Badge
                  variant="secondary"
                  className="hidden text-[10px] font-medium sm:inline-flex"
                >
                  macOS Local-AI Organizer
                </Badge>
                {hasSampleData && (
                  <Badge
                    variant="outline"
                    className="border-amber-500/40 bg-amber-500/10 text-[10px] font-medium text-amber-700 dark:text-amber-300"
                  >
                    Sample Day Loaded
                  </Badge>
                )}
              </div>
              <p className="hidden text-[11px] text-muted-foreground xl:block">
                Screenshots Mail &amp; Slack → time-blocks your calendar by availability &amp; prep rules
              </p>
            </div>
          </div>
        </div>

        {/* Center: Screenshot Cadence & Live Capture Controls */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/80 bg-muted/40 p-1.5">
          {isCapturing ? (
            <div className="flex items-center gap-2 px-2">
              <span
                className={`size-2 rounded-full ${
                  isCapturePaused
                    ? "bg-amber-500"
                    : "animate-pulse bg-emerald-500"
                }`}
              />
              <span className="font-mono text-xs font-medium">
                {isCapturePaused
                  ? "Paused"
                  : `Next shot ${formatCountdown(secondsUntilNext)}`}
              </span>
              {skippedStaticCount > 0 && (
                <span className="hidden text-[11px] text-muted-foreground md:inline">
                  ({skippedStaticCount} static skipped)
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 pl-1.5">
              <span className="size-2 rounded-full bg-muted-foreground/40" />
              <span className="text-xs text-muted-foreground">Cadence:</span>
            </div>
          )}

          <Select
            value={currentSelectValue}
            onValueChange={(val) => {
              if (!val) return;
              if (val === "custom") {
                setSettingsOpen(true);
              } else {
                onUpdateSettings({ intervalMinutes: Number(val) });
              }
            }}
          >
            <SelectTrigger size="sm" className="h-7 min-w-[118px] bg-background text-xs">
              <SelectValue>
                {currentSelectValue === "custom"
                  ? `Every ${settings.intervalMinutes}m`
                  : `Every ${settings.intervalMinutes} min`}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {presetIntervals.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom interval...</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSettingsOpen(true)}
            title="Customize screenshot cadence & workday hours"
          >
            <SlidersHorizontal className="size-3.5" />
          </Button>

          {!isCapturing ? (
            <Button size="sm" onClick={onStartLiveCapture} className="gap-1.5">
              <Play className="size-3.5" />
              Start Live Mac Capture
            </Button>
          ) : (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={onSnapNow}
                disabled={isProcessingCapture}
              >
                Snap Now
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onTogglePauseCapture}
                title={isCapturePaused ? "Resume timer" : "Pause timer"}
              >
                {isCapturePaused ? (
                  <Play className="size-3.5" />
                ) : (
                  <Pause className="size-3.5" />
                )}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={onStopLiveCapture}
                className="gap-1"
              >
                <Square className="size-3" />
                Stop
              </Button>
            </div>
          )}

          <Button
            variant="secondary"
            size="sm"
            onClick={onSimulateNextMacCapture}
            disabled={isProcessingCapture}
            className="gap-1.5"
          >
            <Sparkles className="size-3.5" />
            {isProcessingCapture ? "Analyzing..." : "Simulate Mail/Slack Shot"}
          </Button>
        </div>

        {/* Right: Local AI Status, Android Nightly Sync & Apple Calendar .ics */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOllamaDialogOpen(true)}
            className="gap-1.5 text-xs"
          >
            <Cpu className="size-3.5" />
            <span className="hidden sm:inline">
              {ollamaStatus.connected
                ? `Ollama: ${settings.ollamaModel}`
                : "Local AI: On-Device"}
            </span>
            <span
              className={`size-2 rounded-full ${
                ollamaStatus.connected ? "bg-emerald-500" : "bg-sky-500"
              }`}
            />
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onOpenAndroidSync}
            className="gap-1.5 text-xs"
          >
            <Smartphone className="size-3.5" />
            <span className="hidden md:inline">Nightly Android Sync</span>
            {queuedAndroidCount > 0 && (
              <Badge variant="default" className="h-4 px-1.5 text-[10px]">
                {queuedAndroidCount}
              </Badge>
            )}
          </Button>

          <input
            ref={icsInputRef}
            type="file"
            accept=".ics,text/calendar"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                onImportIcsFile(file);
                e.target.value = "";
              }
            }}
          />

          <Button
            variant="outline"
            size="sm"
            onClick={() => icsInputRef.current?.click()}
            className="gap-1.5 text-xs"
            title="Import busy events from Apple Calendar or Google Calendar (.ics)"
          >
            <Upload className="size-3.5" />
            <span className="hidden lg:inline">Import .ics</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onExportIcs}
            className="gap-1.5 text-xs"
            title="Export time-blocked schedule & solo holds to Apple Calendar (.ics)"
          >
            <Download className="size-3.5" />
            <span className="hidden lg:inline">Export to Calendar</span>
          </Button>
        </div>
      </div>

      {/* Capture Cadence & Workday Preferences Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Screenshot Cadence &amp; Workday Bounds</DialogTitle>
            <DialogDescription>
              Customize how often Dayframe captures your MacBook screen and how tightly it packs your calendar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs font-medium">
                <span>Screenshot Interval</span>
                <span className="font-mono text-foreground">
                  Every {settings.intervalMinutes} min
                </span>
              </div>
              <Slider
                min={1}
                max={30}
                value={[settings.intervalMinutes]}
                onValueChange={(val) => {
                  const next = Array.isArray(val) ? val[0] : val;
                  if (typeof next === "number") {
                    onUpdateSettings({ intervalMinutes: next });
                  }
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                1 min catches fleeting Slack messages; 5 min balances low battery impact on MacBook Air/Pro.
              </p>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs font-medium">
                <span>Minimum Buffer Between Calendar Blocks</span>
                <span className="font-mono">
                  {settings.minGapBetweenBlocksMinutes} min
                </span>
              </div>
              <Slider
                min={0}
                max={30}
                value={[settings.minGapBetweenBlocksMinutes]}
                onValueChange={(val) => {
                  const next = Array.isArray(val) ? val[0] : val;
                  if (typeof next === "number") {
                    onUpdateSettings({
                      minGapBetweenBlocksMinutes: Math.round(next / 5) * 5,
                    });
                  }
                }}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5 pr-3">
                <div className="text-xs font-medium">
                  Skip unchanged static screens
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Uses an 8×8 perceptual luminance check so idle screens skip VLM inference.
                </div>
              </div>
              <Switch
                checked={settings.skipDuplicateFrames}
                onCheckedChange={(checked) =>
                  onUpdateSettings({ skipDuplicateFrames: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5 pr-3">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Moon className="size-3.5" />
                  Nightly Android Sync Window
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Batch-process raw phone screenshots at {settings.nightlyAndroidSyncHour - 12}:00 PM on Mac.
                </div>
              </div>
              <Select
                value={String(settings.nightlyAndroidSyncHour)}
                onValueChange={(v) => {
                  if (v) onUpdateSettings({ nightlyAndroidSyncHour: Number(v) });
                }}
              >
                <SelectTrigger size="sm" className="w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="21">9:00 PM</SelectItem>
                  <SelectItem value="22">10:00 PM</SelectItem>
                  <SelectItem value="23">11:00 PM</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between border-t pt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onResetSampleWorkspace();
                  setSettingsOpen(false);
                }}
                className="gap-1.5 text-xs text-muted-foreground"
              >
                <RotateCcw className="size-3.5" />
                Reset to Default Sample Day
              </Button>
              <Button size="sm" onClick={() => setSettingsOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Local MacBook AI Model Dialog */}
      <Dialog open={ollamaDialogOpen} onOpenChange={setOllamaDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Cpu className="size-4" />
              Local MacBook Vision Model (Ollama)
            </DialogTitle>
            <DialogDescription>
              Dayframe connects directly from your MacBook to{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                http://127.0.0.1:11434
              </code>{" "}
              so screenshots of Mail and Slack never leave your machine.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1 text-xs">
            <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3">
              <div className="flex items-center gap-2">
                {ollamaStatus.connected ? (
                  <CheckCircle2 className="size-4 text-emerald-500" />
                ) : (
                  <Cpu className="size-4 text-sky-500" />
                )}
                <div>
                  <div className="font-medium">
                    {ollamaStatus.connected
                      ? `Connected to Local Ollama (${ollamaStatus.models.length} models)`
                      : "Local Ollama not detected — On-Device Heuristic Active"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {ollamaStatus.connected
                      ? "Live screenshots are sent to your Apple Silicon vision model."
                      : "Everything still works right now using Dayframe's built-in extractor."}
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onRecheckOllama}
                className="gap-1"
              >
                <RefreshCw className="size-3" />
                Re-check
              </Button>
            </div>

            <div className="space-y-1.5">
              <label className="font-medium">Preferred Vision Model</label>
              <Select
                value={settings.ollamaModel}
                onValueChange={(val) => {
                  if (val) onUpdateSettings({ ollamaModel: val });
                }}
              >
                <SelectTrigger className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(ollamaStatus.models.length > 0
                    ? ollamaStatus.models
                    : [
                        "llama3.2-vision",
                        "qwen2.5-vl:7b",
                        "gemma3:12b",
                        "minicpm-v",
                      ]
                  ).map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 rounded-lg border bg-card p-3">
              <div className="font-medium">
                1-Minute MacBook Setup (Apple Silicon)
              </div>
              <pre className="overflow-x-auto rounded-md bg-muted p-2.5 font-mono text-[11px] leading-relaxed">
{`# 1. Pull a fast local vision model
ollama pull llama3.2-vision

# 2. Start Ollama allowing browser loopback access
OLLAMA_ORIGINS="*" ollama serve`}
              </pre>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
