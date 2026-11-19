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
import { MacBridgeConnectionState } from "@/lib/calendar-connectors";
import {
  CalendarBlock,
  MacCalendarDescriptor,
  OrganizerSettings,
  ScannedEmailItem,
  StandingRule,
} from "@/lib/types";
import {
  formatDateKeyLabel,
  formatDuration,
  formatMinutesToTime,
} from "@/lib/scheduler";
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  Cpu,
  Filter,
  Laptop,
  Loader2,
  Mail,
  Minus,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
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
  googleAccessToken: string;
  onChangeGoogleAccessToken: (token: string) => void;
  onRunOneOffInitialScan: () => Promise<{
    ok: boolean;
    existingCount: number;
    emailCount: number;
    proposedCount: number;
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
  googleAccessToken,
  onChangeGoogleAccessToken,
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
    emailCount: number;
    proposedCount: number;
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

  const proposedBlocks = scannedBlocks.filter((b) => b.status !== "confirmed");
  const existingBlocks = scannedBlocks.filter((b) => b.status === "confirmed");

  const handlePingGemma = async () => {
    setTestingGemma(true);
    setGemmaPingResult(null);
    const res = await testGemma4Ping(settings.gemmaModel);
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
        ? `Valen Gatekeeper active on port ${stat.port} (${stat.pingMs ?? 0}ms, 0 output tokens).`
        : stat.errorDetail ||
            `Valen GGUF server not running yet on port ${stat.port} — Dayframe will route directly to Gemma 4 until started.`
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
        res.error ||
          "Could not scan calendar yet. Check your connection in Step 1."
      );
      return;
    }
    setScanCompletedOnce(true);
    setScanStats({
      existingCount: res.existingCount,
      emailCount: res.emailCount,
      proposedCount: res.proposedCount,
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
                <Badge variant="default" className="text-[11px]">
                  Kickstart Setup
                </Badge>
                <Badge variant="outline" className="font-mono text-[11px]">
                  Stage 1 Gate: {selectedValenSpec.id} (GGUF)
                </Badge>
                <Badge variant="outline" className="font-mono text-[11px]">
                  Stage 2 Planner: {settings.gemmaModel}
                </Badge>
              </div>
              <h1 className="text-xl font-semibold tracking-tight">
                Dayframe — Two-Stage Local AI Calendar Organizer
              </h1>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Most periodic screenshots are just coding, reading, or static windows. Dayframe pairs{" "}
                <span className="font-medium text-foreground">
                  Valen-Decision-1.5
                </span>{" "}
                (single forward pass, 0 output tokens, visual{" "}
                <code className="rounded bg-muted px-1">bbox</code> grounding) as a fast System-1 gatekeeper with{" "}
                <span className="font-medium text-foreground">Gemma 4</span> as the System-2 extractor &amp; calendar scheduler.
              </p>
            </div>
          </div>

          {/* 4-Stage Pipeline Diagram */}
          <div className="mt-5 grid grid-cols-1 gap-2.5 rounded-xl border bg-muted/30 p-3.5 text-xs sm:grid-cols-4">
            <div className="space-y-0.5">
              <div className="font-semibold text-foreground">
                1. Native Mac Capture &amp; Sync
              </div>
              <div className="text-[11px] text-muted-foreground">
                macOS Calendar.app + Mail.app + silent screencapture every{" "}
                {settings.intervalMinutes}m
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="font-semibold text-foreground">
                2. Valen-Decision-1.5 Gate
              </div>
              <div className="text-[11px] text-muted-foreground">
                0-token forward pass filters ~85% noise, drops private screens &amp; crops{" "}
                <code>bbox</code>
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="font-semibold text-foreground">
                3. Gemma 4 Reasoning
              </div>
              <div className="text-[11px] text-muted-foreground">
                Wakes only on actionable frames/emails to size duration &amp; solo holds
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="font-semibold text-foreground">
                4. Calendar Write-Back
              </div>
              <div className="text-[11px] text-muted-foreground">
                Slots open windows + ≥2h recurring prep directly into Calendar
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4">
            {[
              { n: 1 as const, label: "1. Local Models & Calendar Bridge" },
              { n: 2 as const, label: "2. Prep Rules & Gate Thresholds" },
              { n: 3 as const, label: "3. One-Off Calendar & Inbox Scan" },
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

        {/* STEP 1: Valen-Decision-1.5 + Gemma 4 + Mac Calendar/Mail Bridge */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {/* Stage 1 Card: Valen-Decision-1.5 Gatekeeper */}
              <div className="flex flex-col justify-between gap-4 rounded-2xl border bg-card p-5 shadow-2xs">
                <div className="space-y-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Filter className="size-4 text-primary" />
                      <div>
                        <h2 className="text-sm font-semibold">
                          Stage 1: Valen-Decision-1.5 Gatekeeper
                        </h2>
                        <p className="text-[11px] text-muted-foreground">
                          Multimodal System-1 triage, privacy filter &amp;{" "}
                          <code>bbox</code> cropper
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
                    <p className="text-[11px] text-muted-foreground">
                      {selectedValenSpec.totalFootprintNote} • Recommended:{" "}
                      {selectedValenSpec.recommendedMacRam}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="mb-1 block text-[11px] text-muted-foreground">
                        Local Valen Server Port
                      </label>
                      <Select
                        value={String(settings.valenPort)}
                        onValueChange={(val) => {
                          if (val)
                            onUpdateSettings({ valenPort: Number(val) });
                        }}
                      >
                        <SelectTrigger className="w-full text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="43823">127.0.0.1:43823</SelectItem>
                          <SelectItem value="8080">127.0.0.1:8080</SelectItem>
                          <SelectItem value="8000">127.0.0.1:8000</SelectItem>
                          <SelectItem value="30000">127.0.0.1:30000</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-muted-foreground">
                        Wake Gemma 4 Threshold
                      </label>
                      <div className="flex h-8 items-center gap-2 rounded-lg border px-2.5">
                        <span className="font-mono text-xs">
                          p ≥ {settings.valenSignalThreshold.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5 rounded-xl border bg-muted/40 p-3 text-xs">
                    <div className="font-medium">
                      Optional Local GGUF Runtime ({selectedValenSpec.repo})
                    </div>
                    <pre className="overflow-x-auto rounded-lg bg-background p-2 font-mono text-[10.5px] leading-relaxed">
{`hf download ${selectedValenSpec.repo} ${selectedValenSpec.ggufFile} vision-native-limits-F32.gguf --local-dir .
./serve -m ./${selectedValenSpec.ggufFile} --mmproj ./vision-native-limits-F32.gguf --host 127.0.0.1 --port ${settings.valenPort}`}
                    </pre>
                    <p className="text-[10.5px] text-muted-foreground">
                      If Valen isn&apos;t running yet, Dayframe automatically stays in Standby and sends captures directly to Gemma 4.
                    </p>
                  </div>

                  {valenPingMsg && (
                    <div className="rounded-xl border bg-muted/40 p-2.5 text-xs">
                      {valenPingMsg}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between border-t pt-3">
                  <Badge
                    variant={valenStatus.reachable ? "default" : "outline"}
                    className="text-[10px]"
                  >
                    {valenStatus.reachable
                      ? `Valen Online (${valenStatus.pingMs ?? 0}ms)`
                      : "Standby (Direct to Gemma 4)"}
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
                    Test Valen Gate
                  </Button>
                </div>
              </div>

              {/* Stage 2 Card: Gemma 4 via Ollama */}
              <div className="flex flex-col justify-between gap-4 rounded-2xl border bg-card p-5 shadow-2xs">
                <div className="space-y-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Cpu className="size-4 text-primary" />
                      <div>
                        <h2 className="text-sm font-semibold">
                          Stage 2: Gemma 4 Reasoning &amp; Extraction
                        </h2>
                        <p className="text-[11px] text-muted-foreground">
                          Runs via Ollama only when Valen detects an actionable item
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant={gemmaStatus.reachable ? "default" : "outline"}
                      className="text-[10px]"
                    >
                      {gemmaStatus.reachable
                        ? `Ollama Online (${gemmaStatus.pingMs ?? 0}ms)`
                        : "Ollama Offline"}
                    </Badge>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <label className="font-medium">Gemma 4 Ollama Tag</label>
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

                  <div className="space-y-1.5 rounded-xl border bg-muted/40 p-3 text-xs">
                    <div className="flex items-center gap-1.5 font-medium">
                      <Terminal className="size-3.5" />
                      Start Gemma 4 on Your MacBook
                    </div>
                    <pre className="overflow-x-auto rounded-lg bg-background p-2.5 font-mono text-[11px] leading-relaxed">
{`ollama pull ${settings.gemmaModel}
OLLAMA_ORIGINS="*" ollama serve`}
                    </pre>
                  </div>

                  {gemmaPingResult && (
                    <div
                      className={`rounded-xl border p-2.5 text-xs ${
                        gemmaPingResult.ok
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                          : "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
                      }`}
                    >
                      {gemmaPingResult.message}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end border-t pt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handlePingGemma()}
                    disabled={testingGemma}
                    className="gap-1.5"
                  >
                    {testingGemma ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    Test Gemma 4 Connection
                  </Button>
                </div>
              </div>
            </div>

            {/* Calendar, Mail & Screen Bridge Card */}
            <div className="rounded-2xl border bg-card p-5 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3.5">
                <div className="flex items-center gap-2">
                  <Laptop className="size-4 text-primary" />
                  <div>
                    <h2 className="text-sm font-semibold">
                      Seamless Calendar, Mail &amp; Screen Connection
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Connect directly to macOS Calendar.app &amp; Mail.app via{" "}
                      <code>npm run mac</code> (or Google Calendar + Gmail API)
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="xs"
                    variant={
                      settings.calendarSource !== "google-api"
                        ? "default"
                        : "outline"
                    }
                    onClick={() =>
                      onUpdateSettings({
                        calendarSource: "macos-bridge",
                        captureEngine: "macos-native",
                      })
                    }
                  >
                    Mac Native Bridge
                  </Button>
                  <Button
                    size="xs"
                    variant={
                      settings.calendarSource === "google-api"
                        ? "default"
                        : "outline"
                    }
                    onClick={() =>
                      onUpdateSettings({
                        calendarSource: "google-api",
                        captureEngine: "browser-screen",
                      })
                    }
                  >
                    Google Calendar + Gmail API
                  </Button>
                </div>
              </div>

              {settings.calendarSource !== "google-api" ? (
                <div className="mt-4 grid grid-cols-1 gap-4 text-xs md:grid-cols-2">
                  <div className="rounded-xl border bg-muted/40 p-3">
                    <div className="font-medium">
                      Run on MacBook (`npm run mac` auto-pairs)
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Connects Apple EventKit (iCloud, Google &amp; Exchange calendars in Calendar.app), Mail.app, and silent background{" "}
                      <code>screencapture</code>:
                    </p>
                    <pre className="mt-2 rounded-lg bg-background p-2 font-mono text-[11px]">
                      npm run mac
                    </pre>
                  </div>

                  <div className="space-y-2">
                    <label className="font-medium">
                      Mac Bridge Pairing Token
                    </label>
                    <div className="flex gap-1.5">
                      <Input
                        value={macPairingToken}
                        onChange={(e) =>
                          onChangeMacPairingToken(e.target.value)
                        }
                        placeholder="Auto-filled via npm run mac, or paste token..."
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
                      <Select
                        value={settings.writableCalendarId}
                        onValueChange={(val) => {
                          if (!val) return;
                          const found = macCalendars.find((c) => c.id === val);
                          onUpdateSettings({
                            writableCalendarId: val,
                            writableCalendarTitle: found?.title || "Calendar",
                          });
                        }}
                      >
                        <SelectTrigger className="w-full text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {macCalendars
                            .filter((c) => c.allowsModify)
                            .map((cal) => (
                              <SelectItem key={cal.id} value={cal.id}>
                                Write blocks to: {cal.title} ({cal.sourceTitle})
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-2 text-xs">
                  <label className="font-medium">
                    Google OAuth Access Token (`calendar.events` + `gmail.readonly`)
                  </label>
                  <Input
                    type="password"
                    value={googleAccessToken}
                    onChange={(e) => onChangeGoogleAccessToken(e.target.value)}
                    placeholder="ya29...."
                    className="font-mono text-xs"
                  />
                </div>
              )}

              <div className="mt-4 flex justify-end border-t pt-3">
                <Button size="sm" onClick={() => setStep(2)} className="gap-1.5">
                  Next: Prep Rules &amp; Gate Thresholds
                  <ArrowRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: Prep Rules, Valen Gate Sensitivity & Cadence */}
        {step === 2 && (
          <div className="space-y-5 rounded-2xl border bg-card p-6 shadow-2xs">
            <div>
              <h2 className="text-base font-semibold">
                Standing Rules, Prep Runway &amp; Gate Sensitivity
              </h2>
              <p className="text-xs text-muted-foreground">
                Configure your ≥2-hour meeting preparation habit, screenshot interval, and Valen-Decision probability cutoff.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-3 rounded-xl border p-4 text-xs">
                <div className="flex items-center gap-2 font-semibold">
                  <ShieldCheck className="size-4 text-amber-500" />
                  Recurring &amp; High-Stakes Meeting Prep Rule
                </div>
                <p className="text-muted-foreground">
                  Reserve prep finishing at least{" "}
                  <span className="font-semibold text-foreground">
                    {leadHours} hours before
                  </span>{" "}
                  recurring meetings (and Valen-flagged high-prep reviews).
                </p>

                <div className="grid grid-cols-2 gap-3 pt-1">
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
                        <SelectItem value="120">120 minutes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] text-muted-foreground">
                      Lead Before Meeting
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
                        <SelectItem value="4">At least 4 hours before</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border p-4 text-xs">
                <div className="flex items-center justify-between font-semibold">
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

                <div className="space-y-1.5 border-t pt-2.5">
                  <div className="flex items-center justify-between font-medium">
                    <span>Valen Actionability Cutoff</span>
                    <span className="font-mono">
                      p ≥ {settings.valenSignalThreshold.toFixed(2)}
                    </span>
                  </div>
                  <Slider
                    min={20}
                    max={80}
                    value={[Math.round(settings.valenSignalThreshold * 100)]}
                    onValueChange={(v) => {
                      const next = Array.isArray(v) ? v[0] : v;
                      if (typeof next === "number") {
                        onUpdateSettings({ valenSignalThreshold: next / 100 });
                      }
                    }}
                  />
                  <p className="text-[10.5px] text-muted-foreground">
                    Screenshots scoring below this probability are skipped in one forward pass without waking Gemma 4.
                  </p>
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
                  One-Off Baseline Scan (Calendar + Valen Triage + Gemma 4)
                </h2>
                <p className="max-w-xl text-xs text-muted-foreground">
                  Scans the next 7 days of your real calendar plus recent inbox emails. Valen filters out newsletters/FYI alerts and scores meeting prep needs; Gemma 4 extracts solo meeting holds and focus blocks.
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
                  ? "Scanning Calendar & Inbox..."
                  : scanCompletedOnce
                    ? "Re-Run Baseline Scan"
                    : "Run Initial Calendar & Mail Scan"}
              </Button>
            </div>

            {scanError && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200">
                <div className="font-semibold">
                  Connection Required to Scan Real Data
                </div>
                <p className="mt-1">{scanError}</p>
                <p className="mt-1.5 text-[11px] opacity-90">
                  Run <code className="rounded bg-background/60 px-1">npm run mac</code> on your MacBook (or connect Google Calendar in Step 1), or open your clean empty workspace below.
                </p>
              </div>
            )}

            {scanStats && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border bg-muted/30 p-3 text-xs">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Calendar className="size-3.5" />
                    Existing Calendar Events
                  </div>
                  <div className="mt-1 text-lg font-semibold">
                    {scanStats.existingCount}
                  </div>
                </div>
                <div className="rounded-xl border bg-muted/30 p-3 text-xs">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Mail className="size-3.5" />
                    Inbox Messages Screened
                  </div>
                  <div className="mt-1 text-lg font-semibold">
                    {scanStats.emailCount}
                  </div>
                </div>
                <div className="rounded-xl border bg-muted/30 p-3 text-xs">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <CheckCircle2 className="size-3.5 text-emerald-500" />
                    Prep &amp; Focus Blocks Proposed
                  </div>
                  <div className="mt-1 text-lg font-semibold">
                    {proposedBlocks.length}
                  </div>
                </div>
              </div>
            )}

            {proposedBlocks.length > 0 && (
              <div className="space-y-2.5">
                <div className="text-xs font-semibold">
                  Proposed Baseline Blocks ({proposedBlocks.length})
                </div>
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {proposedBlocks.map((blk) => (
                    <div
                      key={blk.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background p-3 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 font-semibold">
                          <span>{blk.title}</span>
                          <Badge variant="secondary" className="text-[10px]">
                            {blk.kind === "prep"
                              ? "Prep Rule"
                              : blk.isSoloHold
                                ? "Solo Hold"
                                : "Focus Block"}
                          </Badge>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {formatDateKeyLabel(blk.dateKey, todayKey)} •{" "}
                          {formatMinutesToTime(blk.startMinutes)} (
                          {formatDuration(blk.durationMinutes)}) — {blk.rationale}
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
                Loaded {existingBlocks.length} existing calendar events. No missing prep blocks or unscheduled inbox tasks were detected.
              </p>
            )}

            {scannedEmails.length > 0 && !gemmaStatus.reachable && (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                Found {scannedEmails.length} inbox emails, but local{" "}
                <code>{settings.gemmaModel}</code> is offline on{" "}
                <code>127.0.0.1:11434</code>.
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
                    Open Empty Workspace &amp; Connect Later
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
                      ? `Approve ${proposedBlocks.length} Blocks & Launch Workspace`
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
