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
  const [gemmaPingResult, setGemmaPingResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
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

  const handleExecuteScan = async () => {
    setRunningScan(true);
    setScanError(null);
    const res = await onRunOneOffInitialScan();
    setRunningScan(false);
    if (!res.ok) {
      setScanError(
        res.error || "Could not scan calendar yet. Check your connection in Step 1."
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
    <div className="min-h-screen bg-muted/20 px-4 py-8 lg:py-12">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Top Architecture Header */}
        <div className="rounded-2xl border bg-card p-6 shadow-2xs">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Badge variant="default" className="text-[11px]">
                  Kickstart Setup
                </Badge>
                <Badge variant="outline" className="font-mono text-[11px]">
                  Local Model: {settings.gemmaModel}
                </Badge>
              </div>
              <h1 className="text-xl font-semibold tracking-tight">
                Set Up Dayframe with Your Calendar, Mail &amp; Local Gemma 4
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground">
                No fake sample feeds and no manual <code className="rounded bg-muted px-1">.ics</code> uploads. Connect your Mac&apos;s native Calendar &amp; Mail (or Google Workspace), set your prep rules, and run a one-off baseline scan to organize your real week.
              </p>
            </div>
          </div>

          {/* How It Works Pipeline Bar */}
          <div className="mt-5 grid grid-cols-1 gap-2.5 rounded-xl border bg-muted/30 p-3.5 text-xs sm:grid-cols-4">
            <div className="space-y-0.5">
              <div className="font-semibold text-foreground">
                1. Seamless Calendar &amp; Mail
              </div>
              <div className="text-[11px] text-muted-foreground">
                macOS EventKit (iCloud / Google / Exchange) + Mail.app or Google API
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="font-semibold text-foreground">
                2. Local Gemma 4 Vision
              </div>
              <div className="text-[11px] text-muted-foreground">
                Runs on your Mac via Ollama (127.0.0.1:11434) — text &amp; screenshots stay local
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="font-semibold text-foreground">
                3. One-Off Baseline Scan
              </div>
              <div className="text-[11px] text-muted-foreground">
                Scans existing meetings + unread emails to attach prep &amp; solo holds
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="font-semibold text-foreground">
                4. Periodic Screen Loop
              </div>
              <div className="text-[11px] text-muted-foreground">
                Silent screenshots every {settings.intervalMinutes}m keep new Slack/email items slotted
              </div>
            </div>
          </div>

          {/* Stepper Pills */}
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4">
            {[
              { n: 1 as const, label: "1. Gemma 4 & Calendar Connection" },
              { n: 2 as const, label: "2. Prep Rules & Workday Cadence" },
              { n: 3 as const, label: "3. One-Off Initial Calendar & Mail Scan" },
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

        {/* STEP 1: Connect Local Gemma 4 + Native macOS Calendar/Mail Bridge (or Google API) */}
        {step === 1 && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Card 1A: Gemma 4 via Ollama */}
            <div className="flex flex-col justify-between gap-4 rounded-2xl border bg-card p-5 shadow-2xs">
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Cpu className="size-4 text-primary" />
                    <h2 className="text-sm font-semibold">
                      Local AI Model — Gemma 4 (Multimodal)
                    </h2>
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

                <p className="text-xs text-muted-foreground">
                  Gemma 4 natively understands both screenshots (vision) and email/calendar text in one local model on Apple Silicon.
                </p>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    Select Gemma 4 Variant
                  </label>
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
                      {gemmaStatus.installedModels
                        .filter(
                          (inst) =>
                            !GEMMA4_MODEL_CATALOG.some((c) => c.tag === inst)
                        )
                        .map((other) => (
                          <SelectItem key={other} value={other}>
                            {other} (Installed in Ollama)
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 rounded-xl border bg-muted/40 p-3 text-xs">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Terminal className="size-3.5" />
                    Run on your MacBook Terminal
                  </div>
                  <pre className="overflow-x-auto rounded-lg bg-background p-2.5 font-mono text-[11px] leading-relaxed">
{`ollama pull ${settings.gemmaModel}
OLLAMA_ORIGINS="*" ollama serve`}
                  </pre>
                </div>

                {gemmaPingResult && (
                  <div
                    className={`rounded-xl border p-3 text-xs ${
                      gemmaPingResult.ok
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
                    }`}
                  >
                    {gemmaPingResult.message}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 border-t pt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePingGemma}
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

            {/* Card 1B: Seamless Calendar & Mail Connection */}
            <div className="flex flex-col justify-between gap-4 rounded-2xl border bg-card p-5 shadow-2xs">
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Laptop className="size-4 text-primary" />
                    <h2 className="text-sm font-semibold">
                      Calendar, Mail &amp; Screen Bridge
                    </h2>
                  </div>
                  <Badge
                    variant={
                      macBridgeState.paired ||
                      (settings.calendarSource === "google-api" &&
                        Boolean(googleAccessToken.trim()))
                        ? "default"
                        : "outline"
                    }
                    className="text-[10px]"
                  >
                    {macBridgeState.paired
                      ? "macOS Connected"
                      : settings.calendarSource === "google-api" &&
                          googleAccessToken.trim()
                        ? "Google API Ready"
                        : "Not Paired Yet"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSettings({
                        calendarSource: "macos-bridge",
                        captureEngine: "macos-native",
                      })
                    }
                    className={`rounded-xl border p-2.5 text-left text-xs transition-colors ${
                      settings.calendarSource !== "google-api"
                        ? "border-foreground bg-muted/50 font-medium"
                        : "hover:bg-muted/30"
                    }`}
                  >
                    <div className="font-semibold">Mac App / Native Bridge</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      Apple Calendar.app + Mail.app + silent screencapture
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSettings({
                        calendarSource: "google-api",
                        captureEngine: "browser-screen",
                      })
                    }
                    className={`rounded-xl border p-2.5 text-left text-xs transition-colors ${
                      settings.calendarSource === "google-api"
                        ? "border-foreground bg-muted/50 font-medium"
                        : "hover:bg-muted/30"
                    }`}
                  >
                    <div className="font-semibold">Google Calendar + Gmail</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      Direct HTTPS API + browser window capture
                    </div>
                  </button>
                </div>

                {settings.calendarSource !== "google-api" ? (
                  <div className="space-y-3 text-xs">
                    <div className="rounded-xl border bg-muted/40 p-3">
                      <div className="font-medium">
                        Launch as a Mac App (Auto-Pairs Calendar &amp; Mail)
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Clone this project on your MacBook and run one command — it connects directly to macOS{" "}
                        <span className="font-medium text-foreground">
                          Calendar.app
                        </span>{" "}
                        (including Google &amp; iCloud accounts signed in on your Mac),{" "}
                        <span className="font-medium text-foreground">
                          Mail.app
                        </span>
                        , and silent background{" "}
                        <code className="rounded bg-background px-1">
                          screencapture
                        </code>
                        :
                      </p>
                      <pre className="mt-2 overflow-x-auto rounded-lg bg-background p-2 font-mono text-[11px]">
{`npm run mac`}
                      </pre>
                    </div>

                    <div className="space-y-1.5">
                      <label className="font-medium">
                        Mac Bridge Pairing Token (printed by{" "}
                        <code className="text-[11px]">npm run mac-bridge</code>)
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
                      {macBridgeState.error && !macBridgeState.paired && (
                        <p className="text-[11px] text-muted-foreground">
                          {macBridgeState.error}
                        </p>
                      )}
                    </div>

                    {macBridgeState.paired && macCalendars.length > 0 && (
                      <div className="space-y-1.5">
                        <label className="font-medium">
                          Target Calendar for New Time-Blocks &amp; Solo Holds
                        </label>
                        <Select
                          value={settings.writableCalendarId}
                          onValueChange={(val) => {
                            if (!val) return;
                            const found = macCalendars.find(
                              (c) => c.id === val
                            );
                            onUpdateSettings({
                              writableCalendarId: val,
                              writableCalendarTitle:
                                found?.title || "Calendar",
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
                                  {cal.title} ({cal.sourceTitle})
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2.5 text-xs">
                    <p className="text-muted-foreground">
                      Connect directly to Google Calendar &amp; Gmail APIs (scopes:{" "}
                      <code className="rounded bg-muted px-1">
                        calendar.events
                      </code>{" "}
                      and{" "}
                      <code className="rounded bg-muted px-1">
                        gmail.readonly
                      </code>
                      ) with zero <code className="rounded bg-muted px-1">.ics</code> files:
                    </p>
                    <Input
                      type="password"
                      value={googleAccessToken}
                      onChange={(e) =>
                        onChangeGoogleAccessToken(e.target.value)
                      }
                      placeholder="Paste Google OAuth Access Token (ya29....)"
                      className="font-mono text-xs"
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end border-t pt-3">
                <Button
                  size="sm"
                  onClick={() => setStep(2)}
                  className="gap-1.5"
                >
                  Next: Organizing &amp; Prep Rules
                  <ArrowRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: Standing Rules, ≥2-Hour Recurring Prep & Cadence */}
        {step === 2 && (
          <div className="space-y-5 rounded-2xl border bg-card p-6 shadow-2xs">
            <div>
              <h2 className="text-base font-semibold">
                How Do You Want Your Day Organized?
              </h2>
              <p className="text-xs text-muted-foreground">
                Dayframe uses these rules during your initial calendar scan and on every periodic screenshot — with minimal hand-holding.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Recurring Prep Rule */}
              <div className="space-y-3 rounded-xl border p-4 text-xs">
                <div className="flex items-center gap-2 font-semibold">
                  <ShieldCheck className="size-4 text-amber-500" />
                  Recurring Meeting Preparation Rule
                </div>
                <p className="text-muted-foreground">
                  Reserve preparation time finishing at least{" "}
                  <span className="font-semibold text-foreground">
                    {leadHours} hours before
                  </span>{" "}
                  any recurring meeting (and the afternoon prior if a recurring meeting starts early in the morning).
                </p>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="mb-1 block text-[11px] text-muted-foreground">
                      Prep Block Length
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
                      Minimum Lead Before Meeting
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

              {/* Screenshot Cadence & Auto-Sync */}
              <div className="space-y-3 rounded-xl border p-4 text-xs">
                <div className="flex items-center justify-between font-semibold">
                  <span>Screenshot Capture Cadence</span>
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
                <p className="text-[11px] text-muted-foreground">
                  1 min catches fast-moving Slack channels; 5 min is gentle on battery. Unchanged static screens are skipped automatically.
                </p>

                <div className="flex items-center justify-between border-t pt-3">
                  <div>
                    <div className="font-medium">
                      Write blocks directly to my Calendar
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Pushes confirmed focus blocks, prep blocks &amp; solo holds straight into Calendar
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
            </div>

            {/* Extra Plain-English Rule Input */}
            <div className="space-y-2 rounded-xl border bg-muted/25 p-4 text-xs">
              <label className="font-semibold">
                Any other recurring habits or duration rules? (Optional)
              </label>
              <div className="flex gap-2">
                <Textarea
                  value={customRuleNote}
                  onChange={(e) => setCustomRuleNote(e.target.value)}
                  placeholder='e.g. "Architecture & PR reviews usually take me 45 minutes" or "Give me 60m prep at least 2 hours before client calls"'
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

        {/* STEP 3: One-Off Initial Calendar & Inbox Baseline Scan */}
        {step === 3 && (
          <div className="space-y-5 rounded-2xl border bg-card p-6 shadow-2xs">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-base font-semibold">
                  One-Off Baseline Scan (Calendar + Inbox)
                </h2>
                <p className="max-w-xl text-xs text-muted-foreground">
                  Before starting periodic screenshot capture, scan your existing calendar for the next 7 days and your recent inbox messages so Dayframe knows your real availability, attaches recurring meeting prep blocks, and catches unbooked meeting mentions.
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
                  ? "Scanning Calendar & Running Gemma 4..."
                  : scanCompletedOnce
                    ? "Re-Run Baseline Scan"
                    : "Run Initial Calendar & Mail Scan"}
              </Button>
            </div>

            {scanError && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200">
                <div className="font-semibold">Connection Required to Scan Real Data</div>
                <p className="mt-1">{scanError}</p>
                <p className="mt-1.5 text-[11px] opacity-90">
                  Start <code className="rounded bg-background/60 px-1">npm run mac</code> on your MacBook (or connect Google Calendar in Step 1), or open your clean empty workspace below and connect anytime from the top bar.
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
                    Recent Emails Inspected
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

            {/* Proposed Baseline Plan Review */}
            {proposedBlocks.length > 0 && (
              <div className="space-y-2.5">
                <div className="text-xs font-semibold">
                  Review Proposed Prep Blocks, Solo Holds &amp; Email Tasks ({proposedBlocks.length})
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
                          title="Shorten by 15m"
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
                          title="Extend by 15m"
                        >
                          <Plus className="size-3" />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => onRemoveScannedBlock(blk.id)}
                          title="Skip this block"
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
                Loaded {existingBlocks.length} existing calendar events. No missing recurring-meeting prep blocks or unscheduled inbox tasks were detected yet.
              </p>
            )}

            {scannedEmails.length > 0 && !gemmaStatus.reachable && (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                Found {scannedEmails.length} inbox emails, but local{" "}
                <code>{settings.gemmaModel}</code> is currently offline on{" "}
                <code>127.0.0.1:11434</code> — start Ollama to extract tasks &amp; meeting holds from those emails.
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
