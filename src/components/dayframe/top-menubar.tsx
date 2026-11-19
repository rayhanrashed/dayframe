"use client";

import React, { useState } from "react";
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
import {
  GEMMA4_MODEL_CATALOG,
  LocalGemmaStatus,
} from "@/lib/gemma-client";
import { MacBridgeConnectionState } from "@/lib/calendar-connectors";
import { OrganizerSettings, PipelineLogEntry } from "@/lib/types";
import {
  Activity,
  Camera,
  Cpu,
  Laptop,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Smartphone,
  Square,
} from "lucide-react";

interface TopMenubarProps {
  settings: OrganizerSettings;
  onUpdateSettings: (patch: Partial<OrganizerSettings>) => void;
  gemmaStatus: LocalGemmaStatus;
  onRecheckGemma: () => Promise<void>;
  macBridgeState: MacBridgeConnectionState;
  isCapturing: boolean;
  isCapturePaused: boolean;
  onTogglePauseCapture: () => void;
  secondsUntilNext: number;
  skippedStaticCount: number;
  onStartCapture: () => void;
  onStopCapture: () => void;
  onSnapNow: () => void;
  isSyncingCalendar: boolean;
  onRescanCalendarAndMail: () => void;
  queuedAndroidCount: number;
  onOpenAndroidSync: () => void;
  onReopenSetupWizard: () => void;
  pipelineLogs: PipelineLogEntry[];
}

function formatCountdown(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function TopMenubar({
  settings,
  onUpdateSettings,
  gemmaStatus,
  onRecheckGemma,
  macBridgeState,
  isCapturing,
  isCapturePaused,
  onTogglePauseCapture,
  secondsUntilNext,
  skippedStaticCount,
  onStartCapture,
  onStopCapture,
  onSnapNow,
  isSyncingCalendar,
  onRescanCalendarAndMail,
  queuedAndroidCount,
  onOpenAndroidSync,
  onReopenSetupWizard,
  pipelineLogs,
}: TopMenubarProps) {
  const [cadenceDialogOpen, setCadenceDialogOpen] = useState(false);
  const [telemetryOpen, setTelemetryOpen] = useState(false);

  const presets = ["1", "3", "5", "10", "15"];
  const selectVal = presets.includes(String(settings.intervalMinutes))
    ? String(settings.intervalMinutes)
    : "custom";

  const calendarConnected =
    macBridgeState.paired || settings.calendarSource === "google-api";

  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 lg:px-6">
        {/* Left: App Title & Connection Truth */}
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-xl bg-foreground text-background">
            <Camera className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-tight">
                Dayframe
              </span>
              <Badge
                variant={calendarConnected ? "secondary" : "outline"}
                className="gap-1 text-[10px]"
              >
                <Laptop className="size-3" />
                {macBridgeState.paired
                  ? `macOS Calendar (${settings.writableCalendarTitle})`
                  : settings.calendarSource === "google-api"
                    ? "Google Calendar API"
                    : "Calendar Not Connected"}
              </Badge>
            </div>
            <p className="hidden text-[11px] text-muted-foreground xl:block">
              Local {settings.gemmaModel} organizer • Seamless Calendar, Mail &amp; periodic screenshots
            </p>
          </div>
        </div>

        {/* Center: Capture Loop Controls */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 p-1.5">
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
                  ({skippedStaticCount} unchanged skipped)
                </span>
              )}
            </div>
          ) : (
            <span className="pl-2 text-xs text-muted-foreground">
              Capture:
            </span>
          )}

          <Select
            value={selectVal}
            onValueChange={(val) => {
              if (!val) return;
              if (val === "custom") setCadenceDialogOpen(true);
              else onUpdateSettings({ intervalMinutes: Number(val) });
            }}
          >
            <SelectTrigger
              size="sm"
              className="h-7 min-w-[116px] bg-background text-xs"
            >
              <SelectValue>Every {settings.intervalMinutes} min</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {presets.map((p) => (
                <SelectItem key={p} value={p}>
                  Every {p} min
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom interval...</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setCadenceDialogOpen(true)}
            title="Capture & workday preferences"
          >
            <SlidersHorizontal className="size-3.5" />
          </Button>

          {!isCapturing ? (
            <Button size="sm" onClick={onStartCapture} className="gap-1.5">
              <Play className="size-3.5" />
              {settings.captureEngine === "macos-native" &&
              macBridgeState.paired
                ? "Start Silent Mac Capture"
                : "Start Screen Capture"}
            </Button>
          ) : (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={onSnapNow}>
                Snap Now
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onTogglePauseCapture}
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
                onClick={onStopCapture}
                className="gap-1"
              >
                <Square className="size-3" />
                Stop
              </Button>
            </div>
          )}
        </div>

        {/* Right: Sync Calendar & Mail, Gemma 4 Status, Android Sync & Setup */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onRescanCalendarAndMail}
            disabled={isSyncingCalendar}
            className="gap-1.5 text-xs"
          >
            {isSyncingCalendar ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Sync Calendar &amp; Mail
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setTelemetryOpen(true)}
            className="gap-1.5 text-xs"
          >
            <Cpu className="size-3.5" />
            <span className="font-mono">{settings.gemmaModel}</span>
            <span
              className={`size-2 rounded-full ${
                gemmaStatus.reachable ? "bg-emerald-500" : "bg-amber-500"
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
            <span className="hidden md:inline">Android Nightly</span>
            {queuedAndroidCount > 0 && (
              <Badge variant="default" className="h-4 px-1.5 text-[10px]">
                {queuedAndroidCount}
              </Badge>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onReopenSetupWizard}
            className="gap-1.5 text-xs"
          >
            <Settings2 className="size-3.5" />
            Setup
          </Button>
        </div>
      </div>

      {/* Cadence & Capture Engine Preferences Dialog */}
      <Dialog open={cadenceDialogOpen} onOpenChange={setCadenceDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Capture Cadence &amp; Workday Settings</DialogTitle>
            <DialogDescription>
              Configure screenshot frequency, capture engine, and calendar auto-write.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div className="space-y-2">
              <div className="flex justify-between font-medium">
                <span>Screenshot Interval</span>
                <span className="font-mono">
                  Every {settings.intervalMinutes} min
                </span>
              </div>
              <Slider
                min={1}
                max={30}
                value={[settings.intervalMinutes]}
                onValueChange={(v) => {
                  const next = Array.isArray(v) ? v[0] : v;
                  if (typeof next === "number") {
                    onUpdateSettings({ intervalMinutes: next });
                  }
                }}
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-medium">Screenshot Source</label>
              <Select
                value={settings.captureEngine}
                onValueChange={(v) => {
                  if (v === "macos-native" || v === "browser-screen") {
                    onUpdateSettings({ captureEngine: v });
                  }
                }}
              >
                <SelectTrigger className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="macos-native">
                    macOS Silent screencapture (via npm run mac)
                  </SelectItem>
                  <SelectItem value="browser-screen">
                    Browser Window / Screen Share
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="pr-3">
                <div className="font-medium">Auto-write new blocks to Calendar</div>
                <div className="text-[11px] text-muted-foreground">
                  Writes Gemma 4 scheduled blocks straight into your connected Calendar.
                </div>
              </div>
              <Switch
                checked={settings.autoWriteToCalendar}
                onCheckedChange={(checked) =>
                  onUpdateSettings({ autoWriteToCalendar: checked })
                }
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Gemma 4 Model & Live Pipeline Telemetry Dialog */}
      <Dialog open={telemetryOpen} onOpenChange={setTelemetryOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="size-4" />
              Gemma 4 Engine &amp; Live Activity Pipeline
            </DialogTitle>
            <DialogDescription>
              Exact local model status on <code>127.0.0.1:11434</code> and step-by-step activity log.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/40 p-3">
              <div>
                <div className="font-semibold">
                  {gemmaStatus.reachable
                    ? `Ollama Connected (${gemmaStatus.pingMs ?? 0}ms)`
                    : "Ollama Offline on 127.0.0.1:11434"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {gemmaStatus.reachable
                    ? `Installed models: ${
                        gemmaStatus.installedModels.join(", ") || "none yet"
                      }`
                    : `Start local Gemma 4: ollama pull ${settings.gemmaModel} && OLLAMA_ORIGINS="*" ollama serve`}
                </div>
              </div>

              <Button
                size="xs"
                variant="outline"
                onClick={() => void onRecheckGemma()}
              >
                Re-check
              </Button>
            </div>

            <div className="space-y-1.5">
              <label className="font-medium">Active Gemma 4 Model</label>
              <Select
                value={settings.gemmaModel}
                onValueChange={(v) => {
                  if (v) onUpdateSettings({ gemmaModel: v });
                }}
              >
                <SelectTrigger className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GEMMA4_MODEL_CATALOG.map((m) => (
                    <SelectItem key={m.tag} value={m.tag}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <div className="font-medium">Recent Pipeline Execution Log</div>
              <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border bg-background p-2.5">
                {pipelineLogs.length === 0 ? (
                  <p className="py-6 text-center text-[11px] text-muted-foreground">
                    No captures or scans processed yet in this session.
                  </p>
                ) : (
                  pipelineLogs.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-lg border bg-muted/25 p-2 text-[11px]"
                    >
                      <div className="flex items-center justify-between font-medium">
                        <span>
                          [{entry.stage}] {entry.title}
                        </span>
                        {entry.latencyMs !== undefined && (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {entry.latencyMs}ms
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-muted-foreground">
                        {entry.detail}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
