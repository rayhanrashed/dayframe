"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
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
  testGemma4Ping,
} from "@/lib/gemma-client";
import {
  VALEN_MODEL_CATALOG,
  ValenRuntimeStatus,
} from "@/lib/valen-decision";
import {
  MacBridgeConnectionState,
  openMacCalendarPrivacySettings,
  openMacScreenPrivacySettings,
  sleepAllModelsViaMacDaemon,
  wakeOllamaViaMacDaemon,
} from "@/lib/calendar-connectors";
import { downloadMacBridgeDocumentsInstaller } from "@/lib/mac-bridge-installer";
import {
  CalendarBlock,
  ConfirmationPolicy,
  MacCalendarDescriptor,
  OrganizerSettings,
  ScannedEmailItem,
  StandingRule,
} from "@/lib/types";
import {
  BATCH_SCHEDULE_PRESETS,
  formatDateKeyLabel,
  formatDuration,
  formatMinutesToTime,
} from "@/lib/scheduler";
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  Cpu,
  Download,
  Filter,
  HelpCircle,
  Laptop,
  Loader2,
  Mail,
  Minus,
  Moon,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  WifiOff,
} from "lucide-react";

interface KickstartWizardProps {
  todayKey: string;
  settings: OrganizerSettings;
  onUpdateSettings: (patch: Partial<OrganizerSettings>) => void;
  rules: StandingRule[];
  onUpdateRecurringPrepRule: (prepMinutes: number, leadHours: number) => void;
  onAddPlainEnglishRule: (text: string) => void;
  gemmaStatus: LocalGemmaStatus;
  onRecheckGemma: () => Promise<void>;
  valenStatus: ValenRuntimeStatus;
  onRecheckValen: () => Promise<ValenRuntimeStatus>;
  macBridgeState: MacBridgeConnectionState;
  macPairingToken: string;
  onChangeMacPairingToken: (token: string) => void;
  onVerifyMacBridge: () => Promise<void>;
  macCalendars: MacCalendarDescriptor[];
  onRunOneOffInitialScan: () => Promise<{
    ok: boolean;
    existingCount: number;
    eligibleMeetingCount: number;
    skippedChoreCount: number;
    windowsCapturedNames: string[];
    screenPermissionNeeded?: boolean;
    emailCount: number;
    proposedCount: number;
    gemmaRan: boolean;
    gemmaNote?: string;
    error?: string;
  }>;
  scannedBlocks: CalendarBlock[];
  scannedEmails: ScannedEmailItem[];
  onAdjustScannedBlockDuration: (id: string, deltaMinutes: number) => void;
  onRemoveScannedBlock: (id: string) => void;
  onFinalizeKickstart: (writeApprovedToCalendar: boolean) => Promise<void>;
}

export function KickstartWizard({
  todayKey,
  settings,
  onUpdateSettings,
  rules,
  onUpdateRecurringPrepRule,
  onAddPlainEnglishRule,
  gemmaStatus,
  onRecheckGemma,
  valenStatus,
  onRecheckValen,
  macBridgeState,
  macPairingToken,
  onChangeMacPairingToken,
  onVerifyMacBridge,
  macCalendars,
  onRunOneOffInitialScan,
  scannedBlocks,
  scannedEmails,
  onAdjustScannedBlockDuration,
  onRemoveScannedBlock,
  onFinalizeKickstart,
}: KickstartWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [testingGemma, setTestingGemma] = useState(false);
  const [testingValen, setTestingValen] = useState(false);
  const [gemmaPingResult, setGemmaPingResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [valenPingMsg, setValenPingMsg] = useState<string | null>(null);
  const [customRuleNote, setCustomRuleNote] = useState("");
  const [runningScan, setRunningScan] = useState(false);
  const [scanCompletedOnce, setScanCompletedOnce] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanStats, setScanStats] = useState<{
    existingCount: number;
    eligibleMeetingCount: number;
    skippedChoreCount: number;
    windowsCapturedNames: string[];
    screenPermissionNeeded?: boolean;
    emailCount: number;
    proposedCount: number;
    gemmaRan: boolean;
    gemmaNote?: string;
  } | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  const recurringRule = rules.find(
    (r) => r.category === "prep-time" && r.appliesToRecurring
  );
  const prepDuration = recurringRule?.prepDurationMinutes ?? 60;
  const leadHours = (recurringRule?.minLeadMinutesBeforeMeeting ?? 120) / 60;

  const selectedValenSpec =
    VALEN_MODEL_CATALOG.find((v) => v.id === settings.valenModelId) ??
    VALEN_MODEL_CATALOG[0];

  const activePreset =
    BATCH_SCHEDULE_PRESETS.find(
      (p) =>
        JSON.stringify(p.windows) ===
        JSON.stringify(settings.batchWindowMinutes)
    )?.id ?? "3x";

  const proposedBlocks = scannedBlocks.filter((b) => b.status !== "confirmed");
  const existingBlocks = scannedBlocks.filter((b) => b.status === "confirmed");

  const handleWakeAndTestGemma = async () => {
    setTestingGemma(true);
    setGemmaPingResult(null);
    if (macBridgeState.paired && macPairingToken) {
      await wakeOllamaViaMacDaemon(macPairingToken);
    }
    const res = await testGemma4Ping({
      model: settings.gemmaModel,
      unloadImmediately: true,
    });
    if (macBridgeState.paired && macPairingToken) {
      await sleepAllModelsViaMacDaemon({
        pairingToken: macPairingToken,
        gemmaModel: settings.gemmaModel,
      });
    }
    await onRecheckGemma();
    setGemmaPingResult({
      ok: res.ok,
      message: res.ok
        ? `${res.resolvedModel} (${res.latencyMs}ms): "${res.message}"`
        : res.message,
    });
    setTestingGemma(false);
  };

  const handlePingValen = async () => {
    setTestingValen(true);
    setValenPingMsg(null);
    const stat = await onRecheckValen();
    setValenPingMsg(
      stat.reachable
        ? `Valen Gatekeeper active on port ${stat.port} (${stat.pingMs ?? 0}ms).`
        : "Valen is sleeping at 0 MB RAM (if ~/.dayframe/models has Valen GGUF weights, Dayframe wakes it only during batch sweeps and stops it right after)."
    );
    setTestingValen(false);
  };

  const handleExecuteScan = async () => {
    setRunningScan(true);
    setScanError(null);
    const res = await onRunOneOffInitialScan();
    setRunningScan(false);
    if (!res.ok) {
      setScanError(
        res.error || "Could not scan calendar yet. Pair the Mac Daemon in Step 1."
      );
      return;
    }
    setScanCompletedOnce(true);
    setScanStats({
      existingCount: res.existingCount,
      eligibleMeetingCount: res.eligibleMeetingCount,
      skippedChoreCount: res.skippedChoreCount,
      windowsCapturedNames: res.windowsCapturedNames,
      screenPermissionNeeded: res.screenPermissionNeeded,
      emailCount: res.emailCount,
      proposedCount: res.proposedCount,
      gemmaRan: res.gemmaRan,
      gemmaNote: res.gemmaNote,
    });
  };

  return (
    <div className="min-h-screen bg-muted/20 px-4 py-8 lg:py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Top Architecture Header */}
        <div className="rounded-2xl border bg-card p-6 shadow-2xs">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="default" className="gap-1 text-[11px]">
                  <WifiOff className="size-3" />
                  100% Offline Workflow
                </Badge>
                <Badge variant="outline" className="gap-1 font-mono text-[11px]">
                  <Moon className="size-3" />
                  0 MB Idle AI RAM
                </Badge>
                <Badge variant="outline" className="gap-1 text-[11px]">
                  <HelpCircle className="size-3" />
                  Asks When Unsure
                </Badge>
              </div>
              <h1 className="text-xl font-semibold tracking-tight">
                Dayframe — All-In-One Offline MacBook Calendar Organizer
              </h1>
              <p className="max-w-3xl text-sm text-muted-foreground">
                One launcher (<code className="rounded bg-muted px-1">./dayframe</code> or{" "}
                <code className="rounded bg-muted px-1">Dayframe.command</code>) runs everything locally with{" "}
                <span className="font-medium text-foreground">zero internet calls</span>. Screenshots queue silently all day using{" "}
                <span className="font-medium text-foreground">0 MB of AI memory</span>;{" "}
                <span className="font-medium text-foreground">Valen-Decision-1.5</span> and{" "}
                <span className="font-medium text-foreground">Gemma 4</span> wake only a few times a day, stop immediately after, and{" "}
                <span className="font-medium text-foreground">ask you before adding uncertain items to Calendar.app</span>.
              </p>
            </div>
          </div>

          {/* 4-Stage Offline Lifecycle Diagram */}
          <div className="mt-5 grid grid-cols-1 gap-2.5 rounded-xl border bg-muted/30 p-3.5 text-xs sm:grid-cols-4">
            <div className="space-y-0.5">
              <div className="font-semibold text-foreground">
                1. Silent Queue (0 MB RAM)
              </div>
              <div className="text-[11px] text-muted-foreground">
                Queues compressed frames every {settings.intervalMinutes}m with both AI models completely stopped
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="font-semibold text-foreground">
                2. Scheduled Batch Wake
              </div>
              <div className="text-[11px] text-muted-foreground">
                Wakes Valen 3x/day to drop ~85% noise &amp; crop <code>bbox</code>, then stops Valen immediately
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="font-semibold text-foreground">
                3. Gemma 4 &rarr; Unload (0 MB)
              </div>
              <div className="text-[11px] text-muted-foreground">
                Extracts surviving tasks &amp; immediately unloads weights (<code>keep_alive: 0</code>)
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="font-semibold text-foreground">
                4. Ask First, Then Calendar
              </div>
              <div className="text-[11px] text-muted-foreground">
                Asks Yes/No whenever uncertain before writing to macOS Calendar.app
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4">
            {[
              { n: 1 as const, label: "1. Packed Mac Launcher & Models" },
              { n: 2 as const, label: "2. Batch Schedule & Ask-Often Rules" },
              { n: 3 as const, label: "3. One-Off Calendar & Mail Scan" },
            ].map((s) => (
              <button
                key={s.n}
                type="button"
                onClick={() => setStep(s.n)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  step === s.n
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* STEP 1: Packed Launcher + On-Demand Models */}
        {step === 1 && (
          <div className="space-y-5">
            {/* All-in-One Launcher Card */}
            <div className="rounded-2xl border bg-card p-5 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3.5">
                <div className="flex items-center gap-2">
                  <Laptop className="size-4 text-primary" />
                  <div>
                    <h2 className="text-sm font-semibold">
                      One-Command Offline MacBook Startup
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Starts the UI, Calendar.app/Mail.app EventKit bridge, silent screenshot queue, and on-demand model wake/sleep manager together.
                    </p>
                  </div>
                </div>
                <Badge
                  variant={macBridgeState.paired ? "default" : "outline"}
                  className="text-[11px]"
                >
                  {macBridgeState.paired
                    ? "Paired with Mac Daemon (127.0.0.1)"
                    : "Waiting for ./dayframe"}
                </Badge>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 text-xs md:grid-cols-2">
                <div className="space-y-2.5 rounded-xl border bg-muted/40 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">
                      Double-click <code>Dayframe.command</code> or run:
                    </div>
                    {!macBridgeState.reachable && (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={downloadMacBridgeDocumentsInstaller}
                        className="gap-1.5"
                      >
                        <Download className="size-3" />
                        Standalone Bridge (.sh)
                      </Button>
                    )}
                  </div>
                  <pre className="overflow-x-auto rounded-lg bg-background p-2.5 font-mono text-[11px] leading-relaxed">
{`cd ~/Documents/dayframe
./dayframe`}
                  </pre>
                  <p className="text-[11px] text-muted-foreground">
                    Automatically verifies dependencies &amp; local <code>gemma4:e4b</code> weights on first run, keeps AI models stopped at 0 MB RAM, and opens Dayframe auto-paired.
                  </p>
                </div>

                <div className="space-y-2.5">
                  <label className="font-medium">
                    Mac Daemon Pairing Token (auto-filled by <code>./dayframe</code>)
                  </label>
                  <div className="flex gap-1.5">
                    <Input
                      value={macPairingToken}
                      onChange={(e) => onChangeMacPairingToken(e.target.value)}
                      placeholder="Auto-filled when launched via ./dayframe..."
                      className="font-mono text-xs"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void onVerifyMacBridge()}
                    >
                      Pair
                    </Button>
                  </div>
                  {macBridgeState.paired && macCalendars.length > 0 && (
                    <div className="space-y-2.5">
                      <Select
                        value={settings.writableCalendarId || undefined}
                        onValueChange={(val) => {
                          if (!val) return;
                          const found = macCalendars.find((c) => c.id === val);
                          const nextReads = settings.readCalendarIds.includes(val)
                            ? settings.readCalendarIds
                            : [val, ...settings.readCalendarIds];
                          onUpdateSettings({
                            writableCalendarId: val,
                            writableCalendarTitle: found?.title || "Calendar",
                            writableCalendarSource: found?.sourceTitle || "",
                            pinnedWriteCalendar: true,
                            readCalendarIds: nextReads,
                            readCalendarScopeInitialized: true,
                          });
                        }}
                      >
                        <SelectTrigger className="w-full text-xs">
                          <SelectValue placeholder="Choose personal UMich calendar to write to" />
                        </SelectTrigger>
                        <SelectContent>
                          {macCalendars
                            .filter((c) => c.allowsModify)
                            .map((cal) => (
                              <SelectItem key={cal.id} value={cal.id}>
                                Write ONLY to: {cal.title} ({cal.sourceTitle})
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>

                      <div className="space-y-1.5 rounded-xl border bg-muted/20 p-2.5">
                        <div className="text-[11px] font-medium">
                          Calendars to Read / Take Meetings From (unchecked are ignored):
                        </div>
                        <div className="max-h-36 space-y-1 overflow-y-auto">
                          {macCalendars.map((cal) => {
                            const isWrite = cal.id === settings.writableCalendarId;
                            const checked =
                              isWrite || settings.readCalendarIds.includes(cal.id);
                            return (
                              <label
                                key={cal.id}
                                className="flex cursor-pointer items-center justify-between gap-2 rounded-md border bg-background px-2 py-1 text-[11px]"
                              >
                                <span className="truncate">
                                  {cal.title} ({cal.sourceTitle})
                                  {isWrite ? " — Write Target" : ""}
                                </span>
                                <Switch
                                  checked={checked}
                                  disabled={isWrite}
                                  onCheckedChange={(on) => {
                                    const current = new Set(settings.readCalendarIds);
                                    if (on) current.add(cal.id);
                                    else current.delete(cal.id);
                                    if (settings.writableCalendarId) {
                                      current.add(settings.writableCalendarId);
                                    }
                                    onUpdateSettings({
                                      readCalendarIds: Array.from(current),
                                      readCalendarScopeInitialized: true,
                                    });
                                  }}
                                />
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    Reads and writes directly via local macOS EventKit — covers iCloud, Google, and Exchange calendars already in Calendar.app with zero internet traffic from Dayframe.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {/* Stage 1 Card: Valen-Decision-1.5 Gatekeeper */}
              <div className="flex flex-col justify-between gap-4 rounded-2xl border bg-card p-5 shadow-2xs">
                <div className="space-y-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Filter className="size-4 text-primary" />
                      <div>
                        <h2 className="text-sm font-semibold">
                          Stage 1: Valen-Decision-1.5 (On-Demand)
                        </h2>
                        <p className="text-[11px] text-muted-foreground">
                          Wakes at batch time, screens queue in 1 pass, then stops (0 MB RAM)
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={settings.valenEnabled}
                      onCheckedChange={(checked) =>
                        onUpdateSettings({ valenEnabled: checked })
                      }
                    />
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <label className="font-medium">
                      Valen-Decision-1.5 GGUF Size
                    </label>
                    <Select
                      value={settings.valenModelId}
                      onValueChange={(val) => {
                        if (val) onUpdateSettings({ valenModelId: val });
                      }}
                    >
                      <SelectTrigger className="w-full text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VALEN_MODEL_CATALOG.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5 rounded-xl border bg-muted/40 p-3 text-xs">
                    <div className="font-medium">
                      Optional One-Time Weight Cache (<code>~/.dayframe/models</code>)
                    </div>
                    <p className="text-[10.5px] text-muted-foreground">
                      Drop <code>{selectedValenSpec.ggufFile}</code> + <code>vision-native-limits-F32.gguf</code> + <code>serve</code> into <code>~/.dayframe/models/</code> and Dayframe will automatically spawn and stop Valen around each batch. If omitted, Gemma 4 handles batches directly.
                    </p>
                  </div>

                  {valenPingMsg && (
                    <div className="rounded-xl border bg-muted/40 p-2.5 text-xs">
                      {valenPingMsg}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between border-t pt-3">
                  <Badge variant="outline" className="text-[10px]">
                    {valenStatus.reachable
                      ? `Online (${valenStatus.pingMs ?? 0}ms)`
                      : "Sleeping • 0 MB RAM"}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handlePingValen()}
                    disabled={testingValen}
                    className="gap-1.5"
                  >
                    {testingValen ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    Check Status
                  </Button>
                </div>
              </div>

              {/* Stage 2 Card: Gemma 4 via Local Ollama */}
              <div className="flex flex-col justify-between gap-4 rounded-2xl border bg-card p-5 shadow-2xs">
                <div className="space-y-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Cpu className="size-4 text-primary" />
                      <div>
                        <h2 className="text-sm font-semibold">
                          Stage 2: Gemma 4 (Unloaded Between Batches)
                        </h2>
                        <p className="text-[11px] text-muted-foreground">
                          Wakes only for actionable items, then unloads via <code>keep_alive: 0</code>
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {gemmaStatus.reachable ? "Daemon Ready" : "Sleeping • 0 MB"}
                    </Badge>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <label className="font-medium">Local Gemma 4 Variant</label>
                    <Select
                      value={settings.gemmaModel}
                      onValueChange={(val) => {
                        if (val) onUpdateSettings({ gemmaModel: val });
                      }}
                    >
                      <SelectTrigger className="w-full text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GEMMA4_MODEL_CATALOG.map((m) => (
                          <SelectItem key={m.tag} value={m.tag}>
                            {m.label} ({m.sizeNote})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {gemmaPingResult && (
                    <div
                      className={`rounded-xl border p-2.5 text-xs ${
                        gemmaPingResult.ok
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                          : "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
                      }`}
                    >
                      {gemmaPingResult.message}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between border-t pt-3">
                  <span className="text-[11px] text-muted-foreground">
                    Auto-unloads immediately after test
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleWakeAndTestGemma()}
                    disabled={testingGemma}
                    className="gap-1.5"
                  >
                    {testingGemma ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    Wake, Test &amp; Sleep
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button size="sm" onClick={() => setStep(2)} className="gap-1.5">
                Next: Batch Schedule &amp; Ask-Often Rules
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: Scheduled Batch Windows, Ask-Often Policy & Prep Rules */}
        {step === 2 && (
          <div className="space-y-5 rounded-2xl border bg-card p-6 shadow-2xs">
            <div>
              <h2 className="text-base font-semibold">
                Batch Schedule, Ask-Often Policy &amp; Prep Rules
              </h2>
              <p className="text-xs text-muted-foreground">
                Keep AI models completely stopped between scheduled sweeps, and tell Dayframe how often to ask before putting items on your calendar.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-3 rounded-xl border p-4 text-xs">
                <div className="flex items-center gap-2 font-semibold">
                  <Moon className="size-4 text-primary" />
                  Run Models Only a Few Times a Day (0 MB Rest of Day)
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[11px] text-muted-foreground">
                    Daily Batch Sweep Schedule
                  </label>
                  <Select
                    value={
                      settings.batchExecutionMode === "instant-per-capture"
                        ? "instant"
                        : activePreset
                    }
                    onValueChange={(v) => {
                      if (!v) return;
                      if (v === "instant") {
                        onUpdateSettings({
                          batchExecutionMode: "instant-per-capture",
                        });
                        return;
                      }
                      const found = BATCH_SCHEDULE_PRESETS.find(
                        (p) => p.id === v
                      );
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
                      {BATCH_SCHEDULE_PRESETS.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="instant">
                        Instant on every screenshot
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5 border-t pt-2.5">
                  <label className="block text-[11px] text-muted-foreground">
                    When Unsure Whether to Put on Calendar
                  </label>
                  <Select
                    value={settings.confirmationPolicy}
                    onValueChange={(v) => {
                      if (
                        v === "ask-often" ||
                        v === "always-ask" ||
                        v === "auto-high-confidence"
                      ) {
                        onUpdateSettings({
                          confirmationPolicy: v as ConfirmationPolicy,
                        });
                      }
                    }}
                  >
                    <SelectTrigger className="w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ask-often">
                        Ask Me Often Whenever Unsure (Recommended)
                      </SelectItem>
                      <SelectItem value="always-ask">
                        Always Ask Before Every Calendar Addition
                      </SelectItem>
                      <SelectItem value="auto-high-confidence">
                        Ask Only on Low Confidence (&lt;72%)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border p-4 text-xs">
                <div className="flex items-center gap-2 font-semibold">
                  <ShieldCheck className="size-4 text-amber-500" />
                  Recurring Meeting Prep &amp; Silent Queue Cadence
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[11px] text-muted-foreground">
                      Prep Duration
                    </label>
                    <Select
                      value={String(prepDuration)}
                      onValueChange={(v) => {
                        if (v) onUpdateRecurringPrepRule(Number(v), leadHours);
                      }}
                    >
                      <SelectTrigger className="w-full text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="30">30 minutes</SelectItem>
                        <SelectItem value="45">45 minutes</SelectItem>
                        <SelectItem value="60">60 minutes</SelectItem>
                        <SelectItem value="90">90 minutes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] text-muted-foreground">
                      Finish Prep Ahead By
                    </label>
                    <Select
                      value={String(leadHours)}
                      onValueChange={(v) => {
                        if (v)
                          onUpdateRecurringPrepRule(prepDuration, Number(v));
                      }}
                    >
                      <SelectTrigger className="w-full text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">At least 1 hour before</SelectItem>
                        <SelectItem value="2">At least 2 hours before</SelectItem>
                        <SelectItem value="3">At least 3 hours before</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5 border-t pt-2.5">
                  <div className="flex items-center justify-between font-medium">
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
              </div>
            </div>

            <div className="space-y-2 rounded-xl border bg-muted/25 p-4 text-xs">
              <label className="font-semibold">
                Add Plain-English Duration or Scheduling Habit (Optional)
              </label>
              <div className="flex gap-2">
                <Textarea
                  value={customRuleNote}
                  onChange={(e) => setCustomRuleNote(e.target.value)}
                  placeholder='e.g. "PR reviews usually take me 45 minutes" or "Protect mornings before 11 AM for deep work"'
                  className="min-h-14 bg-background text-xs"
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!customRuleNote.trim()}
                  onClick={() => {
                    onAddPlainEnglishRule(customRuleNote.trim());
                    setCustomRuleNote("");
                  }}
                >
                  Add Rule
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between border-t pt-4">
              <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button size="sm" onClick={() => setStep(3)} className="gap-1.5">
                Next: One-Off Calendar &amp; Mail Scan
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: One-Off Baseline Scan */}
        {step === 3 && (
          <div className="space-y-5 rounded-2xl border bg-card p-6 shadow-2xs">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-base font-semibold">
                  Contextual Scan: Calendar + Open Slack/Mail Windows + Gemma 4
                </h2>
                <p className="max-w-xl text-xs text-muted-foreground">
                  Reads your 7-day Calendar (attendees, video links, agendas — skipping personal chores &amp; solo routines), captures open Slack &amp; Mail/Gmail windows on your Mac, wakes Gemma 4 to reason across all of them together, then unloads back to 0 MB RAM.
                </p>
              </div>

              <Button
                onClick={() => void handleExecuteScan()}
                disabled={runningScan}
                className="gap-1.5"
              >
                {runningScan ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {runningScan
                  ? "Reading Calendar, Slack & Gemma 4..."
                  : scanCompletedOnce
                    ? "Re-Run Contextual Scan"
                    : "Run Contextual Scan (Calendar + Slack + Mail)"}
              </Button>
            </div>

            {scanError && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200">
                <div className="font-semibold">
                  {macBridgeState.paired
                    ? "macOS Calendar Access Check"
                    : "Mac Daemon Not Paired Yet"}
                </div>
                <p className="mt-1">{scanError}</p>
                {macBridgeState.paired ? (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        void openMacCalendarPrivacySettings(macPairingToken)
                      }
                    >
                      Open macOS Calendar Privacy Settings
                    </Button>
                    <span className="text-[11px] opacity-90">
                      Tip: If you ran <code>./dayframe</code> inside Cursor&apos;s terminal, macOS checks permission for <strong>Cursor</strong> (not Terminal.app).
                    </span>
                  </div>
                ) : (
                  <p className="mt-1.5 text-[11px] opacity-90">
                    Run <code className="rounded bg-background/60 px-1">./dayframe</code> (or double-click <code className="rounded bg-background/60 px-1">Dayframe.command</code>) on your MacBook.
                  </p>
                )}
              </div>
            )}

            {scanStats && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border bg-muted/30 p-3 text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Calendar className="size-3.5" />
                      Real Meetings vs Chores
                    </div>
                    <div className="mt-1 text-lg font-semibold">
                      {scanStats.eligibleMeetingCount}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        of {scanStats.existingCount} ({scanStats.skippedChoreCount} chores/solo skipped)
                      </span>
                    </div>
                  </div>

                  <div className="rounded-xl border bg-muted/30 p-3 text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Laptop className="size-3.5" />
                      Slack &amp; Mail Windows Read
                    </div>
                    <div className="mt-1 text-lg font-semibold">
                      {scanStats.windowsCapturedNames.length}
                    </div>
                    {scanStats.windowsCapturedNames.length > 0 && (
                      <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
                        {scanStats.windowsCapturedNames.join(", ")}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border bg-muted/30 p-3 text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Mail className="size-3.5" />
                      Apple Mail Screened
                    </div>
                    <div className="mt-1 text-lg font-semibold">
                      {scanStats.emailCount}
                    </div>
                  </div>

                  <div className="rounded-xl border bg-muted/30 p-3 text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <CheckCircle2 className="size-3.5 text-emerald-500" />
                      Gemma 4 Contextual Proposals
                    </div>
                    <div className="mt-1 text-lg font-semibold">
                      {proposedBlocks.length}
                    </div>
                  </div>
                </div>

                {scanStats.screenPermissionNeeded && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                    <span>
                      Want Dayframe to read your open <strong>Slack</strong> and <strong>Gmail/Browser</strong> windows automatically? Allow <strong>Screen Recording</strong> for your terminal app, then click Re-Run Contextual Scan.
                    </span>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        void openMacScreenPrivacySettings(macPairingToken)
                      }
                    >
                      Open Screen Recording Settings
                    </Button>
                  </div>
                )}

                {scanStats.gemmaNote && !scanStats.gemmaRan && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                    {scanStats.gemmaNote}
                  </div>
                )}
              </div>
            )}

            {proposedBlocks.length > 0 && (
              <div className="space-y-2.5">
                <div className="text-xs font-semibold">
                  Gemma 4 Contextual Proposals ({proposedBlocks.length})
                </div>
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {proposedBlocks.map((blk) => (
                    <div
                      key={blk.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background p-3 text-xs"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5 font-semibold">
                          <span>{blk.title}</span>
                          <Badge variant="secondary" className="text-[10px]">
                            {blk.sourceLabel}
                          </Badge>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {formatDateKeyLabel(blk.dateKey, todayKey)} •{" "}
                            {formatMinutesToTime(blk.startMinutes)} (
                            {formatDuration(blk.durationMinutes)})
                          </span>{" "}
                          — {blk.rationale}
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          size="icon-xs"
                          variant="outline"
                          disabled={blk.durationMinutes <= 15}
                          onClick={() =>
                            onAdjustScannedBlockDuration(blk.id, -15)
                          }
                        >
                          <Minus className="size-3" />
                        </Button>
                        <span className="w-11 text-center font-mono text-[11px]">
                          {formatDuration(blk.durationMinutes)}
                        </span>
                        <Button
                          size="icon-xs"
                          variant="outline"
                          onClick={() =>
                            onAdjustScannedBlockDuration(blk.id, 15)
                          }
                        >
                          <Plus className="size-3" />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => onRemoveScannedBlock(blk.id)}
                        >
                          <Trash2 className="size-3 text-muted-foreground" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {existingBlocks.length > 0 && proposedBlocks.length === 0 && (
              <p className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
                Loaded {existingBlocks.length} calendar events ({scanStats?.skippedChoreCount ?? 0} personal chores/solo routines ignored). Gemma 4 found no extra prep or Slack/Mail tasks needed right now — models unloaded back to 0 MB RAM.
              </p>
            )}

            {scannedEmails.length > 0 && proposedBlocks.length === 0 && (
              <p className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
                Screened {scannedEmails.length} recent Mail messages offline.
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <Button variant="ghost" size="sm" onClick={() => setStep(2)}>
                Back
              </Button>

              <div className="flex flex-wrap items-center gap-2">
                {!scanCompletedOnce && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={finalizing}
                    onClick={async () => {
                      setFinalizing(true);
                      await onFinalizeKickstart(false);
                      setFinalizing(false);
                    }}
                  >
                    Open Clean Workspace
                  </Button>
                )}

                {scanCompletedOnce && proposedBlocks.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={finalizing}
                    onClick={async () => {
                      setFinalizing(true);
                      await onFinalizeKickstart(false);
                      setFinalizing(false);
                    }}
                  >
                    Review One-by-One in Confirmation Queue
                  </Button>
                )}

                {scanCompletedOnce && (
                  <Button
                    size="sm"
                    disabled={finalizing}
                    onClick={async () => {
                      setFinalizing(true);
                      await onFinalizeKickstart(proposedBlocks.length > 0);
                      setFinalizing(false);
                    }}
                    className="gap-1.5"
                  >
                    {finalizing && (
                      <Loader2 className="size-3.5 animate-spin" />
                    )}
                    {proposedBlocks.length > 0
                      ? `Write All ${proposedBlocks.length} to Calendar & Launch`
                      : "Launch Workspace"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
