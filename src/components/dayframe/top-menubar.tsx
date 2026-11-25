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
import {
  VALEN_MODEL_CATALOG,
  ValenRuntimeStatus,
} from "@/lib/valen-decision";
import { MacBridgeConnectionState } from "@/lib/calendar-connectors";
import {
  BATCH_SCHEDULE_PRESETS,
  getNextScheduledBatchLabel,
} from "@/lib/scheduler";
import {
  ConfirmationPolicy,
  GatekeeperStats,
  ModelLifecycleState,
  OrganizerSettings,
  PipelineLogEntry,
} from "@/lib/types";
import {
  Activity,
  Camera,
  Cpu,
  Filter,
  Laptop,
  Loader2,
  Moon,
  Pause,
  Play,
  PowerOff,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Square,
  WifiOff,
} from "lucide-react";

interface TopMenubarProps {
  settings: OrganizerSettings;
  onUpdateSettings: (patch: Partial<OrganizerSettings>) => void;
  gemmaStatus: LocalGemmaStatus;
  onRecheckGemma: () => Promise<void>;
  valenStatus: ValenRuntimeStatus;
  onRecheckValen: () => Promise<ValenRuntimeStatus>;
  modelLifecycle: ModelLifecycleState;
  onForceSleepModels: () => Promise<void>;
  gateStats: GatekeeperStats;
  macBridgeState: MacBridgeConnectionState;
  isCapturing: boolean;
  isCapturePaused: boolean;
  onTogglePauseCapture: () => void;
  secondsUntilNext: number;
  skippedStaticCount: number;
  onStartCapture: () => void;
  onStopCapture: () => void;
  onSnapNow: () => void;
  queuedBatchCount: number;
  isRunningBatchSweep: boolean;
  onRunBatchSweepNow: () => void;
  isSyncingCalendar: boolean;
  onRescanCalendarAndMail: () => void;
  queuedAndroidCount: number;
  onOpenAndroidSync: () => void;
  onReopenSetupWizard: () => void;
  onOpenCalendarScope?: () => void;
  pipelineLogs: PipelineLogEntry[];
}

function formatCountdown(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatLifecycleBadge(lifecycle: ModelLifecycleState): string {
  switch (lifecycle.activePhase) {
    case "waking-valen":
      return "Waking Valen...";
    case "screening-valen":
      return "Stage 1: Valen Screening";
    case "waking-gemma":
      return "Waking Gemma 4...";
    case "reasoning-gemma":
      return "Stage 2: Gemma 4 Extracting";
    case "unloading":
      return "Unloading to 0 MB...";
    default:
      return lifecycle.allModelsSleeping
        ? "Models Sleeping • 0 MB RAM"
        : `Active (${lifecycle.residentAiRamMb} MB RAM)`;
  }
}

export function TopMenubar({
  settings,
  onUpdateSettings,
  gemmaStatus,
  onRecheckGemma,
  valenStatus,
  onRecheckValen,
  modelLifecycle,
  onForceSleepModels,
  gateStats,
  macBridgeState,
  isCapturing,
  isCapturePaused,
  onTogglePauseCapture,
  secondsUntilNext,
  skippedStaticCount,
  onStartCapture,
  onStopCapture,
  onSnapNow,
  queuedBatchCount,
  isRunningBatchSweep,
  onRunBatchSweepNow,
  isSyncingCalendar,
  onRescanCalendarAndMail,
  queuedAndroidCount,
  onOpenAndroidSync,
  onReopenSetupWizard,
  onOpenCalendarScope,
  pipelineLogs,
}: TopMenubarProps) {
  const [cadenceDialogOpen, setCadenceDialogOpen] = useState(false);
  const [telemetryOpen, setTelemetryOpen] = useState(false);

  const presets = ["1", "3", "5", "10", "15"];
  const selectVal = presets.includes(String(settings.intervalMinutes))
    ? String(settings.intervalMinutes)
    : "custom";

  const activePreset =
    BATCH_SCHEDULE_PRESETS.find(
      (p) =>
        JSON.stringify(p.windows) ===
        JSON.stringify(settings.batchWindowMinutes)
    )?.id ?? "3x";

  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 lg:px-6">
        {/* Left: App Identity, Offline Guarantee & Calendar Status */}
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-xl bg-foreground text-background">
            <Camera className="size-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold tracking-tight">
                Dayframe
              </span>
              <Badge variant="outline" className="gap-1 text-[10px]">
                <WifiOff className="size-2.5 text-emerald-600" />
                Offline
              </Badge>
              <button
                type="button"
                onClick={onOpenCalendarScope}
                className="inline-flex"
                title="Choose which calendars to read from and which UMich calendar to write to"
              >
                <Badge
                  variant={macBridgeState.paired ? "secondary" : "outline"}
                  className="cursor-pointer gap-1 text-[10px] hover:opacity-85"
                >
                  <Laptop className="size-3" />
                  {macBridgeState.paired
                    ? settings.writableCalendarId
                      ? `Write: ${settings.writableCalendarTitle} · Read: ${
                          settings.readCalendarIds.length || 1
                        }`
                      : "Choose UMich calendar"
                    : "Mac Daemon Not Paired"}
                </Badge>
              </button>
            </div>
            <p className="hidden text-[11px] text-muted-foreground xl:block">
              Auto-sweep:{" "}
              {settings.batchExecutionMode === "when-device-idle"
                ? `When Mac idle ≥${settings.idleMinutesBeforeBatch || 5}m`
                : settings.batchExecutionMode === "scheduled-batches"
                  ? getNextScheduledBatchLabel(settings.batchWindowMinutes)
                  : "Instant per shot"}{" "}
              • Policy:{" "}
              {settings.confirmationPolicy === "always-ask"
                ? "Always Ask"
                : settings.confirmationPolicy === "ask-often"
                  ? "Ask Often"
                  : "Auto High-Conf"}
            </p>
          </div>
        </div>

        {/* Center: Zero-AI-RAM Capture Queue Loop */}
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
                  ? "Queue Paused"
                  : `Next shot ${formatCountdown(secondsUntilNext)}`}
              </span>
              {skippedStaticCount > 0 && (
                <span className="hidden text-[11px] text-muted-foreground md:inline">
                  ({skippedStaticCount} static skipped)
                </span>
              )}
            </div>
          ) : (
            <span className="pl-2 text-xs text-muted-foreground">
              Queue (0 MB AI):
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
            title="Batch schedule, capture cadence & confirmation preferences"
          >
            <SlidersHorizontal className="size-3.5" />
          </Button>

          {!isCapturing ? (
            <Button size="sm" onClick={onStartCapture} className="gap-1.5">
              <Play className="size-3.5" />
              Start Silent Queue
            </Button>
          ) : (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={onSnapNow}>
                Queue Shot
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

        {/* Right: On-Demand Batch Sweep, Model Sleep Status, Android & Setup */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={onRunBatchSweepNow}
            disabled={isRunningBatchSweep || isSyncingCalendar}
            className="gap-1.5 text-xs"
            title="Wake Valen -> screen queue -> stop Valen -> wake Gemma 4 -> extract -> unload back to 0 MB RAM"
          >
            {isRunningBatchSweep ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            {isRunningBatchSweep
              ? "Running Batch..."
              : queuedBatchCount > 0
                ? `Run Batch Sweep (${queuedBatchCount})`
                : "Run Batch Sweep"}
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={onRescanCalendarAndMail}
            disabled={isSyncingCalendar || isRunningBatchSweep}
            className="gap-1.5 text-xs"
          >
            {isSyncingCalendar ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Sync Calendar
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setTelemetryOpen(true)}
            className="gap-1.5 text-xs"
            title="Inspect AI Sleep/Wake Memory & Valen/Gemma Telemetry"
          >
            <Moon className="size-3.5" />
            <span className="hidden font-mono sm:inline">
              {formatLifecycleBadge(modelLifecycle)}
            </span>
            <span
              className={`size-2 rounded-full ${
                modelLifecycle.activePhase !== "sleeping"
                  ? "animate-pulse bg-amber-500"
                  : modelLifecycle.allModelsSleeping
                    ? "bg-emerald-500"
                    : "bg-sky-500"
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
            <span className="hidden md:inline">Android</span>
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

      {/* Batch Schedule, Cadence & Confirmation Policy Dialog */}
      <Dialog open={cadenceDialogOpen} onOpenChange={setCadenceDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Offline Batch &amp; Confirmation Settings</DialogTitle>
            <DialogDescription>
              Keep AI models stopped (0 MB RAM) between scheduled daily sweeps, and ask whenever items are uncertain.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div className="space-y-1.5">
              <label className="font-medium">
                When Should AI Models Wake Up?
              </label>
              <Select
                value={
                  settings.batchExecutionMode === "when-device-idle"
                    ? "when-device-idle"
                    : settings.batchExecutionMode === "instant-per-capture"
                      ? "instant"
                      : activePreset
                }
                onValueChange={(v) => {
                  if (!v) return;
                  if (v === "when-device-idle") {
                    onUpdateSettings({
                      batchExecutionMode: "when-device-idle",
                    });
                    return;
                  }
                  if (v === "instant") {
                    onUpdateSettings({
                      batchExecutionMode: "instant-per-capture",
                    });
                    return;
                  }
                  const found = BATCH_SCHEDULE_PRESETS.find((p) => p.id === v);
                  if (found) {
                    onUpdateSettings({
                      batchExecutionMode: "scheduled-batches",
                      batchWindowMinutes: found.windows,
                    });
                  }
                }}
              >
                <SelectTrigger className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="when-device-idle">
                    Only when Mac is idle ≥{settings.idleMinutesBeforeBatch || 5} min (Recommended)
                  </SelectItem>
                  {BATCH_SCHEDULE_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                  <SelectItem value="instant">
                    Instant on every screenshot (uses RAM more often)
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10.5px] text-muted-foreground">
                Between batch runs, both Valen and Gemma 4 are unloaded and stopped so Dayframe uses 0 MB of GPU/AI memory.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="font-medium">
                Ask User Before Putting on Calendar
              </label>
              <Select
                value={settings.confirmationPolicy}
                onValueChange={(v) => {
                  if (
                    v === "ask-often" ||
                    v === "always-ask" ||
                    v === "auto-high-confidence"
                  ) {
                    onUpdateSettings({ confirmationPolicy: v as ConfirmationPolicy });
                  }
                }}
              >
                <SelectTrigger className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ask-often">
                    Ask Often When Unsure (Recommended)
                  </SelectItem>
                  <SelectItem value="always-ask">
                    Always Ask Every Single Item
                  </SelectItem>
                  <SelectItem value="auto-high-confidence">
                    Auto-Schedule High Confidence (&ge;72%)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between font-medium">
                <span>Silent Screenshot Queue Interval</span>
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

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="pr-3">
                <div className="font-medium">
                  Unload &amp; Stop Models Immediately After Batch
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Sends <code>keep_alive: 0</code> to Ollama and terminates Valen right after each sweep.
                </div>
              </div>
              <Switch
                checked={settings.unloadModelsAfterBatch}
                onCheckedChange={(checked) =>
                  onUpdateSettings({ unloadModelsAfterBatch: checked })
                }
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI Memory Lifecycle & Gatekeeper Savings Dialog */}
      <Dialog open={telemetryOpen} onOpenChange={setTelemetryOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="size-4" />
              Zero-Idle-Resource Offline Pipeline
            </DialogTitle>
            <DialogDescription>
              Sequential memory handoff: Wake Valen &rarr; Stop Valen (0 MB) &rarr; Wake Gemma 4 &rarr; Unload (0 MB).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/35 p-3">
              <div>
                <div className="font-semibold">
                  Current AI Memory:{" "}
                  <span className="font-mono">
                    {modelLifecycle.allModelsSleeping
                      ? "0 MB (All Models Stopped)"
                      : `${modelLifecycle.residentAiRamMb} MB Resident`}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Phase: {formatLifecycleBadge(modelLifecycle)}
                </div>
              </div>
              <Button
                size="xs"
                variant="outline"
                onClick={() => void onForceSleepModels()}
                className="gap-1"
              >
                <PowerOff className="size-3" />
                Unload &amp; Stop Models Now
              </Button>
            </div>

            <div className="grid grid-cols-4 gap-2 rounded-xl border bg-muted/30 p-3 text-center">
              <div>
                <div className="font-mono text-base font-semibold">
                  {gateStats.totalScreened}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Valen Screened
                </div>
              </div>
              <div>
                <div className="font-mono text-base font-semibold text-emerald-600 dark:text-emerald-400">
                  {gateStats.filteredNoiseCount}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Noise Skipped
                </div>
              </div>
              <div>
                <div className="font-mono text-base font-semibold text-amber-600 dark:text-amber-400">
                  {gateStats.privacyDroppedCount}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Privacy Dropped
                </div>
              </div>
              <div>
                <div className="font-mono text-base font-semibold">
                  {gateStats.routedToGemmaCount}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Sent to Gemma 4
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2 rounded-xl border p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <Filter className="size-3.5" />
                    Stage 1: Valen Gate
                  </span>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => void onRecheckValen()}
                  >
                    Check
                  </Button>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {valenStatus.reachable
                    ? `Active on 127.0.0.1:${valenStatus.port}`
                    : "Sleeping (0 MB RAM)"}
                </div>
                <Select
                  value={settings.valenModelId}
                  onValueChange={(v) => {
                    if (v) onUpdateSettings({ valenModelId: v });
                  }}
                >
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VALEN_MODEL_CATALOG.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.id} ({m.ggufFile})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 rounded-xl border p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <Cpu className="size-3.5" />
                    Stage 2: Gemma 4
                  </span>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => void onRecheckGemma()}
                  >
                    Check
                  </Button>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {gemmaStatus.reachable
                    ? modelLifecycle.loadedOllamaModels.length > 0
                      ? `Loaded (${modelLifecycle.residentAiRamMb} MB)`
                      : "Daemon idle • Weights unloaded (0 MB)"
                    : "Stopped (0 MB RAM)"}
                </div>
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
                        {m.tag}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="font-medium">Offline Batch &amp; Lifecycle Log</div>
              <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-xl border bg-background p-2.5">
                {pipelineLogs.length === 0 ? (
                  <p className="py-5 text-center text-[11px] text-muted-foreground">
                    Models are sleeping at 0 MB RAM. Run a batch sweep to view lifecycle telemetry.
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
