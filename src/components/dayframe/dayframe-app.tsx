"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { KickstartWizard } from "./kickstart-wizard";
import { TopMenubar } from "./top-menubar";
import { CaptureStreamPanel } from "./capture-stream-panel";
import { PendingConfirmationsDeck } from "./pending-confirmations-deck";
import { CalendarTimeline } from "./calendar-timeline";
import { OrganizerFeedbackPanel } from "./organizer-feedback-panel";
import { NightlyAndroidSheet } from "./nightly-android-sheet";
import { useScreenCapture } from "@/hooks/use-screen-capture";
import {
  CalendarBlock,
  DiscussionMessage,
  GatekeeperStats,
  MacCalendarDescriptor,
  ModelLifecycleState,
  OrganizerSettings,
  PipelineLogEntry,
  ScannedEmailItem,
  ScreenshotCapture,
  StandingRule,
  SuggestedPreferencePrompt,
} from "@/lib/types";
import {
  addDaysToDateKey,
  applyUserRuleFeedback,
  DEFAULT_ORGANIZER_SETTINGS,
  DEFAULT_STANDING_RULES,
  DEFAULT_SUGGESTED_QUESTIONS,
  extractRuleTriggerFromTitle,
  findOpenSlot,
  formatDuration,
  formatMinutesToTime,
  placeSignalOnCalendar,
  reconcilePrepBlocks,
} from "@/lib/scheduler";
import {
  analyzeInboxEmailsWithGemma4,
  analyzeScreenshotWithGemma4,
  LocalGemmaStatus,
  probeLocalGemma,
  unloadGemmaModelImmediately,
} from "@/lib/gemma-client";
import {
  cropImageToValenBbox,
  evaluateMeetingPrepNeedWithValen,
  filterInboxEmailsWithValen,
  probeValenRuntime,
  runValenScreenshotGate,
  VALEN_MODEL_CATALOG,
  ValenRuntimeStatus,
} from "@/lib/valen-decision";
import {
  acknowledgeMacDiskCaptures,
  configureMacBackgroundCollector,
  fetchMacAndroidFolderQueue,
  fetchMacDiskCaptureQueue,
  fetchMacModelLifecycle,
  MacBridgeConnectionState,
  probeMacBridge,
  scanMacCalendarEvents,
  scanMacMailMessages,
  sendMacNativeNotification,
  sleepAllModelsViaMacDaemon,
  stopValenViaMacDaemon,
  toLocalDateKey,
  wakeOllamaViaMacDaemon,
  wakeValenViaMacDaemon,
  writeBlockToMacCalendar,
} from "@/lib/calendar-connectors";

const STORAGE_KEY_V2 = "dayframe.real.v2";
const LEGACY_TOY_KEY = "dayframe.workspace.v1";

interface PersistedWorkspaceV2 {
  settings: OrganizerSettings;
  blocks: CalendarBlock[];
  captures: ScreenshotCapture[];
  rules: StandingRule[];
  messages: DiscussionMessage[];
  suggestedPrompts: SuggestedPreferencePrompt[];
  gateStats: GatekeeperStats;
  macPairingToken: string;
}

export function DayframeApp() {
  const [todayKey, setTodayKey] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const [settings, setSettings] = useState<OrganizerSettings>(
    DEFAULT_ORGANIZER_SETTINGS
  );
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [captures, setCaptures] = useState<ScreenshotCapture[]>([]);
  const [rules, setRules] = useState<StandingRule[]>(DEFAULT_STANDING_RULES);
  const [messages, setMessages] = useState<DiscussionMessage[]>([
    {
      id: "welcome-msg",
      role: "assistant",
      text: "Tell me any recurring prep rules, duration habits, or 'always ask' preferences — everything stays 100% offline on your MacBook, and models stay stopped at 0 MB RAM between batches.",
      timestampIso: "",
    },
  ]);
  const [suggestedPrompts, setSuggestedPrompts] = useState<
    SuggestedPreferencePrompt[]
  >(DEFAULT_SUGGESTED_QUESTIONS);
  const [gateStats, setGateStats] = useState<GatekeeperStats>({
    totalScreened: 0,
    filteredNoiseCount: 0,
    privacyDroppedCount: 0,
    routedToGemmaCount: 0,
  });
  const [pipelineLogs, setPipelineLogs] = useState<PipelineLogEntry[]>([]);

  const [macPairingToken, setMacPairingToken] = useState("");
  const [macCalendars, setMacCalendars] = useState<MacCalendarDescriptor[]>([]);
  const [scannedEmails, setScannedEmails] = useState<ScannedEmailItem[]>([]);
  const [diskQueuedCount, setDiskQueuedCount] = useState(0);

  const [gemmaStatus, setGemmaStatus] = useState<LocalGemmaStatus>({
    reachable: false,
    installedModels: [],
    installedGemma4Models: [],
    selectedModelInstalled: false,
  });
  const [valenStatus, setValenStatus] = useState<ValenRuntimeStatus>({
    reachable: false,
    port: DEFAULT_ORGANIZER_SETTINGS.valenPort,
  });
  const [modelLifecycle, setModelLifecycle] = useState<ModelLifecycleState>({
    allModelsSleeping: true,
    valenRunning: false,
    ollamaDaemonRunning: false,
    loadedOllamaModels: [],
    residentAiRamMb: 0,
    activePhase: "sleeping",
  });
  const [macBridgeState, setMacBridgeState] =
    useState<MacBridgeConnectionState>({
      reachable: false,
      paired: false,
    });

  const [anchorDateKey, setAnchorDateKey] = useState("");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [androidSheetOpen, setAndroidSheetOpen] = useState(false);
  const [isCapturePaused, setIsCapturePaused] = useState(false);
  const [isSyncingCalendar, setIsSyncingCalendar] = useState(false);
  const [isRunningBatchSweep, setIsRunningBatchSweep] = useState(false);
  const [isRunningNightlyBatch, setIsRunningNightlyBatch] = useState(false);
  const [lastBatchSummary, setLastBatchSummary] = useState<string | null>(null);
  const [toastBanner, setToastBanner] = useState<string | null>(null);

  const completedBatchWindowsRef = useRef<Set<string>>(new Set());
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastBanner(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastBanner(null), 5000);
  }, []);

  const appendLog = useCallback(
    (entry: Omit<PipelineLogEntry, "id" | "timestampIso">) => {
      setPipelineLogs((prev) => [
        {
          ...entry,
          id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestampIso: new Date().toISOString(),
        },
        ...prev.slice(0, 49),
      ]);
    },
    []
  );

  const syncLifecycleSnapshot = useCallback(
    async (tokenOverride?: string) => {
      const tok = tokenOverride ?? macPairingToken;
      const snap = await fetchMacModelLifecycle({
        pairingToken: tok,
        valenPort: settings.valenPort,
      });
      if (snap) {
        setModelLifecycle((prev) => ({
          ...snap,
          activePhase:
            prev.activePhase === "sleeping" ? "sleeping" : prev.activePhase,
        }));
      }
    },
    [macPairingToken, settings.valenPort]
  );

  // Hydrate v2 state, purge legacy v1 toy data, and auto-pair from #pair=<token>
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (cancelled) return;
      let loadedToken = "";
      let loadedValenPort = DEFAULT_ORGANIZER_SETTINGS.valenPort;
      let loadedValenModel = DEFAULT_ORGANIZER_SETTINGS.valenModelId;
      let loadedGemmaModel = DEFAULT_ORGANIZER_SETTINGS.gemmaModel;

      try {
        localStorage.removeItem(LEGACY_TOY_KEY);
        const raw = localStorage.getItem(STORAGE_KEY_V2);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceV2>;
          if (parsed.settings) {
            const merged: OrganizerSettings = {
              ...DEFAULT_ORGANIZER_SETTINGS,
              ...parsed.settings,
              calendarSource:
                parsed.settings.calendarSource === "macos-bridge"
                  ? "macos-bridge"
                  : "none",
            };
            setSettings(merged);
            loadedValenPort = merged.valenPort;
            loadedValenModel = merged.valenModelId;
            loadedGemmaModel = merged.gemmaModel;
          }
          if (parsed.blocks) setBlocks(parsed.blocks);
          if (parsed.captures) setCaptures(parsed.captures);
          if (parsed.rules) setRules(parsed.rules);
          if (parsed.messages) setMessages(parsed.messages);
          if (parsed.suggestedPrompts)
            setSuggestedPrompts(parsed.suggestedPrompts);
          if (parsed.gateStats) setGateStats(parsed.gateStats);
          if (parsed.macPairingToken) {
            loadedToken = parsed.macPairingToken;
            setMacPairingToken(parsed.macPairingToken);
          }
        }
      } catch {
        // Ignore storage errors
      }

      if (
        typeof window !== "undefined" &&
        window.location.hash.startsWith("#pair=")
      ) {
        const hashToken = decodeURIComponent(
          window.location.hash.replace("#pair=", "").trim()
        );
        if (hashToken) {
          loadedToken = hashToken;
          setMacPairingToken(hashToken);
          window.history.replaceState(null, "", window.location.pathname);
        }
      }

      const currentTodayKey = toLocalDateKey(new Date());
      setTodayKey(currentTodayKey);
      setAnchorDateKey(currentTodayKey);
      setHydrated(true);

      const [gStat, mStat, vStat] = await Promise.all([
        probeLocalGemma(loadedGemmaModel),
        probeMacBridge(loadedToken),
        probeValenRuntime({
          port: loadedValenPort,
          modelId: loadedValenModel,
          macPairingToken: loadedToken,
        }),
      ]);
      if (cancelled) return;
      setGemmaStatus(gStat);
      setMacBridgeState(mStat);
      setValenStatus(vStat);
      setDiskQueuedCount(mStat.queuedCaptureCount ?? 0);
      if (mStat.paired) {
        setSettings((prev) => ({
          ...prev,
          calendarSource: "macos-bridge",
          captureEngine: "macos-native",
        }));
        const life = await fetchMacModelLifecycle({
          pairingToken: loadedToken,
          valenPort: loadedValenPort,
        });
        if (!cancelled && life) {
          setModelLifecycle({ ...life, activePhase: "sleeping" });
        }
      }
    });

    const onHashChange = () => {
      if (window.location.hash.startsWith("#pair=")) {
        const hashToken = decodeURIComponent(
          window.location.hash.replace("#pair=", "").trim()
        );
        if (hashToken) {
          setMacPairingToken(hashToken);
          window.history.replaceState(null, "", window.location.pathname);
          void probeMacBridge(hashToken).then((st) => setMacBridgeState(st));
        }
      }
    };
    window.addEventListener("hashchange", onHashChange);

    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const payload: PersistedWorkspaceV2 = {
        settings,
        blocks,
        captures,
        rules,
        messages,
        suggestedPrompts,
        gateStats,
        macPairingToken,
      };
      localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(payload));
    } catch {
      // Ignore quota exceeded
    }
  }, [
    blocks,
    captures,
    gateStats,
    hydrated,
    macPairingToken,
    messages,
    rules,
    settings,
    suggestedPrompts,
  ]);

  const refreshGemmaStatus = useCallback(async () => {
    const res = await probeLocalGemma(settings.gemmaModel);
    setGemmaStatus(res);
    await syncLifecycleSnapshot();
  }, [settings.gemmaModel, syncLifecycleSnapshot]);

  const refreshValenStatus = useCallback(async () => {
    const res = await probeValenRuntime({
      port: settings.valenPort,
      modelId: settings.valenModelId,
      macPairingToken,
    });
    setValenStatus(res);
    await syncLifecycleSnapshot();
    return res;
  }, [macPairingToken, settings.valenModelId, settings.valenPort, syncLifecycleSnapshot]);

  const handleForceSleepModels = useCallback(async () => {
    setModelLifecycle((prev) => ({ ...prev, activePhase: "unloading" }));
    await sleepAllModelsViaMacDaemon({
      pairingToken: macPairingToken,
      gemmaModel: settings.gemmaModel,
    });
    await unloadGemmaModelImmediately(settings.gemmaModel);
    setModelLifecycle({
      allModelsSleeping: true,
      valenRunning: false,
      ollamaDaemonRunning: false,
      loadedOllamaModels: [],
      residentAiRamMb: 0,
      activePhase: "sleeping",
      lastBatchCompletedIso: new Date().toISOString(),
    });
    setValenStatus((prev) => ({ ...prev, reachable: false }));
    setGemmaStatus((prev) => ({ ...prev, reachable: false }));
    appendLog({
      stage: "lifecycle",
      title: "Unloaded & stopped all local AI models",
      detail: "Valen terminated and Gemma 4 unloaded (keep_alive: 0) → 0 MB AI RAM.",
    });
    showToast("All AI models unloaded & stopped (0 MB RAM)");
  }, [appendLog, macPairingToken, settings.gemmaModel, showToast]);

  const verifyAndLoadMacBridge = useCallback(async () => {
    const state = await probeMacBridge(macPairingToken);
    setMacBridgeState(state);
    setDiskQueuedCount(state.queuedCaptureCount ?? 0);
    if (state.paired) {
      setSettings((prev) => ({
        ...prev,
        calendarSource: "macos-bridge",
        captureEngine: "macos-native",
      }));
      await syncLifecycleSnapshot(macPairingToken);
      const scan = await scanMacCalendarEvents({
        pairingToken: macPairingToken,
        daysAhead: 7,
      });
      if (scan.ok) {
        setMacCalendars(scan.calendars);
        if (!settings.writableCalendarId && scan.defaultCalendarId) {
          const def = scan.calendars.find(
            (c) => c.id === scan.defaultCalendarId
          );
          setSettings((prev) => ({
            ...prev,
            writableCalendarId: scan.defaultCalendarId,
            writableCalendarTitle: def?.title || "Default Calendar",
          }));
        }
        showToast(
          `Paired offline with macOS Calendar (${scan.calendars.length} calendars available)`
        );
      }
    } else if (state.error) {
      showToast(state.error);
    }
  }, [macPairingToken, settings.writableCalendarId, showToast, syncLifecycleSnapshot]);

  const pushBlockToExternalCalendar = useCallback(
    async (block: CalendarBlock): Promise<CalendarBlock> => {
      if (block.syncedToExternalCalendar) return block;

      if (macBridgeState.paired && macPairingToken) {
        const res = await writeBlockToMacCalendar({
          pairingToken: macPairingToken,
          block,
          calendarId: settings.writableCalendarId,
        });
        if (res.ok) {
          appendLog({
            stage: "calendar-write",
            title: `Wrote "${block.title}" to macOS Calendar.app`,
            detail: `${block.dateKey} at ${formatMinutesToTime(
              block.startMinutes
            )} (${formatDuration(block.durationMinutes)})`,
          });
          return {
            ...block,
            status: "confirmed",
            syncedToExternalCalendar: true,
            externalEventId: res.externalEventId,
          };
        }
      }

      return { ...block, status: "confirmed" };
    },
    [
      appendLog,
      macBridgeState.paired,
      macPairingToken,
      settings.writableCalendarId,
    ]
  );

  // One-Off Baseline Scan: Wake -> Scan Calendar & Mail -> Unload Back to 0 MB RAM
  const runBaselineCalendarAndMailScan = useCallback(async (): Promise<{
    ok: boolean;
    existingCount: number;
    emailCount: number;
    proposedCount: number;
    error?: string;
  }> => {
    setIsSyncingCalendar(true);
    try {
      const bridge = await probeMacBridge(macPairingToken);
      setMacBridgeState(bridge);
      if (!bridge.paired) {
        return {
          ok: false,
          existingCount: 0,
          emailCount: 0,
          proposedCount: 0,
          error:
            bridge.error ||
            "Mac Daemon is not paired yet. Run `./dayframe` (or `Dayframe.command`) on your MacBook.",
        };
      }

      const [calRes, mailRes] = await Promise.all([
        scanMacCalendarEvents({ pairingToken: macPairingToken, daysAhead: 7 }),
        scanMacMailMessages({ pairingToken: macPairingToken, limit: 12 }),
      ]);

      if (!calRes.ok) {
        return {
          ok: false,
          existingCount: 0,
          emailCount: 0,
          proposedCount: 0,
          error: calRes.error,
        };
      }

      setMacCalendars(calRes.calendars);
      const fetchedCalendarBlocks = [...calRes.blocks];
      const fetchedEmails = mailRes.messages;
      setScannedEmails(fetchedEmails);

      const valenSpec =
        VALEN_MODEL_CATALOG.find((v) => v.id === settings.valenModelId) ??
        VALEN_MODEL_CATALOG[0];

      // Phase 1: Wake Valen on demand -> Score meetings & filter emails -> Stop Valen immediately
      let candidateEmails = fetchedEmails;
      if (settings.valenEnabled) {
        setModelLifecycle((prev) => ({ ...prev, activePhase: "waking-valen" }));
        await wakeValenViaMacDaemon({
          pairingToken: macPairingToken,
          port: settings.valenPort,
          ggufFile: valenSpec.ggufFile,
        });
        setModelLifecycle((prev) => ({
          ...prev,
          activePhase: "screening-valen",
        }));

        for (let i = 0; i < fetchedCalendarBlocks.length; i++) {
          const ev = fetchedCalendarBlocks[i];
          if (!ev.isRecurring && ev.durationMinutes >= 30) {
            const prepEval = await evaluateMeetingPrepNeedWithValen({
              meetingTitle: ev.title,
              durationMinutes: ev.durationMinutes,
              modelId: settings.valenModelId,
              port: settings.valenPort,
              macPairingToken,
            });
            if (!prepEval) break;
            if (prepEval.needsPrep) {
              fetchedCalendarBlocks[i] = {
                ...ev,
                isRecurring: true,
                rationale: `Valen-Decision scored prep necessity p=${prepEval.probability.toFixed(
                  2
                )} (${prepEval.recommendedPrepMinutes}m recommended).`,
              };
            }
          }
        }

        if (fetchedEmails.length > 0) {
          const emailGate = await filterInboxEmailsWithValen({
            emails: fetchedEmails,
            modelId: settings.valenModelId,
            port: settings.valenPort,
            threshold: settings.valenSignalThreshold,
            macPairingToken,
          });
          if (emailGate.usedValen) {
            candidateEmails = emailGate.keptEmails;
            appendLog({
              stage: "valen-gate",
              title: `Valen screened ${fetchedEmails.length} Mail messages`,
              detail: `Filtered ${emailGate.droppedCount} newsletters/FYI alerts; forwarded ${candidateEmails.length} to Gemma 4.`,
              modelUsed: settings.valenModelId,
              latencyMs: emailGate.totalLatencyMs,
            });
          }
        }

        if (settings.unloadModelsAfterBatch) {
          await stopValenViaMacDaemon(macPairingToken);
          appendLog({
            stage: "lifecycle",
            title: "Stopped Valen-Decision after Stage-1 triage",
            detail: "Freed Stage-1 memory before waking Gemma 4.",
          });
        }
      }

      let workingBlocks = reconcilePrepBlocks(
        fetchedCalendarBlocks,
        rules,
        settings,
        todayKey,
        "proposed"
      );

      // Phase 2: Wake Gemma 4 ONLY if candidate emails exist -> Extract -> Unload to 0 MB
      if (candidateEmails.length > 0) {
        setModelLifecycle((prev) => ({ ...prev, activePhase: "waking-gemma" }));
        await wakeOllamaViaMacDaemon(macPairingToken);
        const gStatus = await probeLocalGemma(settings.gemmaModel);
        setGemmaStatus(gStatus);

        if (gStatus.reachable) {
          setModelLifecycle((prev) => ({
            ...prev,
            activePhase: "reasoning-gemma",
          }));
          const inboxAnalysis = await analyzeInboxEmailsWithGemma4({
            emails: candidateEmails,
            model: settings.gemmaModel,
            todayDateKey: todayKey,
            rules,
          });
          appendLog({
            stage: "gemma4",
            title: `Gemma 4 analyzed ${candidateEmails.length} Mail messages`,
            detail: inboxAnalysis.ok
              ? `Proposed ${inboxAnalysis.signals.length} calendar candidate(s) for your confirmation.`
              : inboxAnalysis.error || "Inbox extraction failed.",
            modelUsed: settings.gemmaModel,
            latencyMs: inboxAnalysis.latencyMs,
          });

          for (const sig of inboxAnalysis.signals) {
            const placed = placeSignalOnCalendar({
              signal: sig,
              sourceLabel: sig.sourceLabel,
              defaultDateKey: todayKey,
              blocks: workingBlocks,
              captures,
              rules,
              settings,
              forceAskUser: true,
            });
            workingBlocks = placed.updatedBlocks;
          }
        }
      }

      setBlocks(workingBlocks);
      const proposedCount = workingBlocks.filter(
        (b) => b.status === "proposed"
      ).length;

      return {
        ok: true,
        existingCount: fetchedCalendarBlocks.length,
        emailCount: fetchedEmails.length,
        proposedCount,
      };
    } catch (err) {
      return {
        ok: false,
        existingCount: 0,
        emailCount: 0,
        proposedCount: 0,
        error: err instanceof Error ? err.message : "Baseline scan failed.",
      };
    } finally {
      if (settings.unloadModelsAfterBatch) {
        setModelLifecycle((prev) => ({ ...prev, activePhase: "unloading" }));
        await sleepAllModelsViaMacDaemon({
          pairingToken: macPairingToken,
          gemmaModel: settings.gemmaModel,
        });
        await unloadGemmaModelImmediately(settings.gemmaModel);
        setModelLifecycle({
          allModelsSleeping: true,
          valenRunning: false,
          ollamaDaemonRunning: false,
          loadedOllamaModels: [],
          residentAiRamMb: 0,
          activePhase: "sleeping",
          lastBatchCompletedIso: new Date().toISOString(),
        });
        appendLog({
          stage: "lifecycle",
          title: "Models unloaded after scan (0 MB RAM)",
          detail: "All AI processes returned to zero-resource sleep.",
        });
      }
      setIsSyncingCalendar(false);
    }
  }, [
    appendLog,
    captures,
    macPairingToken,
    rules,
    settings,
    todayKey,
  ]);

  // Core Scheduled/Manual Batch Sweep: Wake Valen -> Stop -> Wake Gemma 4 -> Unload to 0 MB
  const runOfflineBatchSweep = useCallback(async () => {
    if (isRunningBatchSweep) return;
    setIsRunningBatchSweep(true);

    try {
      // 1. Pull any disk-queued screenshots collected silently by the Mac daemon
      let mergedCaptures = [...captures];
      const diskIdsToAck: string[] = [];

      if (macBridgeState.paired && macPairingToken) {
        const diskQueue = await fetchMacDiskCaptureQueue({
          pairingToken: macPairingToken,
          includeImages: true,
        });
        if (diskQueue.ok && diskQueue.items.length > 0) {
          const existingDiskIds = new Set(
            mergedCaptures.map((c) => c.diskQueueId).filter(Boolean)
          );
          const imported: ScreenshotCapture[] = diskQueue.items
            .filter((item) => !existingDiskIds.has(item.id))
            .map((item) => {
              diskIdsToAck.push(item.id);
              return {
                id: `cap-disk-${item.id}`,
                diskQueueId: item.id,
                timestampIso: item.capturedAtIso,
                device: "macbook",
                appName: item.appName,
                windowTitle: item.windowTitle,
                summaryText: "Queued silently on disk — sweeping now...",
                imageDataUrl: item.imageDataUrl,
                modelUsed: settings.gemmaModel,
                syncState: "queued-for-batch",
              };
            });
          if (imported.length > 0) {
            mergedCaptures = [...imported, ...mergedCaptures];
          }
        }
      }

      const pendingBatch = mergedCaptures.filter(
        (c) =>
          c.device === "macbook" &&
          (c.syncState === "queued-for-batch" || c.syncState === "needs-gemma")
      );

      if (pendingBatch.length === 0) {
        showToast("Queue is empty — 0 screenshots waiting (models stayed at 0 MB RAM)");
        return;
      }

      const valenSpec =
        VALEN_MODEL_CATALOG.find((v) => v.id === settings.valenModelId) ??
        VALEN_MODEL_CATALOG[0];

      const updatedCapMap = new Map<string, ScreenshotCapture>();
      const droppedCaptureIds = new Set<string>();
      const survivorsForGemma: Array<{
        cap: ScreenshotCapture;
        croppedImage: string;
        valenMeta?: ScreenshotCapture["valenGate"];
      }> = [];

      let screenedCount = 0;
      let filteredNoise = 0;
      let privacyDropped = 0;

      // 2. Stage 1: Wake Valen -> Screen all queued frames in 1 burst -> Stop Valen immediately!
      if (settings.valenEnabled) {
        setModelLifecycle((prev) => ({ ...prev, activePhase: "waking-valen" }));
        if (macBridgeState.paired && macPairingToken) {
          await wakeValenViaMacDaemon({
            pairingToken: macPairingToken,
            port: settings.valenPort,
            ggufFile: valenSpec.ggufFile,
          });
        }
        setModelLifecycle((prev) => ({
          ...prev,
          activePhase: "screening-valen",
        }));

        for (const cap of pendingBatch) {
          const decision = await runValenScreenshotGate({
            imageDataUrl: cap.imageDataUrl,
            appName: cap.appName,
            windowTitle: cap.windowTitle,
            modelId: settings.valenModelId,
            port: settings.valenPort,
            signalThreshold: settings.valenSignalThreshold,
            macPairingToken,
          });

          if (!decision) {
            // Valen not installed; route directly to Gemma 4
            survivorsForGemma.push({
              cap,
              croppedImage: cap.imageDataUrl,
            });
            continue;
          }

          screenedCount++;

          if (decision.isSensitiveScreen) {
            privacyDropped++;
            droppedCaptureIds.add(cap.id);
            continue;
          }

          if (!decision.hasCalendarSignal) {
            filteredNoise++;
            updatedCapMap.set(cap.id, {
              ...cap,
              summaryText: `Filtered by Valen-Decision-1.5 (p=${decision.signalProbability.toFixed(
                2
              )}) — no Gemma 4 run needed.`,
              modelUsed: settings.valenModelId,
              inferenceMs: decision.latencyMs,
              valenGate: {
                signalProbability: decision.signalProbability,
                intentChoice: decision.intentChoice,
                urgencyScore: decision.urgencyScore,
                latencyMs: decision.latencyMs,
              },
              syncState: "filtered-by-valen",
            });
            continue;
          }

          const cropped = await cropImageToValenBbox(
            cap.imageDataUrl,
            decision.bbox,
            0.45,
            decision.bboxConfidence
          );
          survivorsForGemma.push({
            cap,
            croppedImage: cropped,
            valenMeta: {
              signalProbability: decision.signalProbability,
              intentChoice: decision.intentChoice,
              urgencyScore: decision.urgencyScore,
              latencyMs: decision.latencyMs,
              bboxCropped: cropped !== cap.imageDataUrl,
            },
          });
        }

        if (screenedCount > 0) {
          setGateStats((prev) => ({
            totalScreened: prev.totalScreened + screenedCount,
            filteredNoiseCount: prev.filteredNoiseCount + filteredNoise,
            privacyDroppedCount: prev.privacyDroppedCount + privacyDropped,
            routedToGemmaCount:
              prev.routedToGemmaCount + survivorsForGemma.length,
          }));
          appendLog({
            stage: "valen-gate",
            title: `Batch Stage 1: Valen screened ${screenedCount} queued frame(s)`,
            detail: `Skipped ${filteredNoise} noise + ${privacyDropped} private; ${survivorsForGemma.length} need Gemma 4.`,
            modelUsed: settings.valenModelId,
          });
        }

        if (settings.unloadModelsAfterBatch && macBridgeState.paired) {
          await stopValenViaMacDaemon(macPairingToken);
          appendLog({
            stage: "lifecycle",
            title: "Stopped Valen-Decision server (0 MB RAM)",
            detail: "Stage 1 complete — freed memory before Stage 2.",
          });
        }
      } else {
        for (const cap of pendingBatch) {
          survivorsForGemma.push({ cap, croppedImage: cap.imageDataUrl });
        }
      }

      // 3. Stage 2: Wake Gemma 4 ONLY if >=1 actionable screenshot survived!
      let workingBlocks = [...blocks];
      let askedQuestionsCount = 0;
      let autoConfirmedCount = 0;

      if (survivorsForGemma.length > 0) {
        setModelLifecycle((prev) => ({ ...prev, activePhase: "waking-gemma" }));
        if (macBridgeState.paired && macPairingToken) {
          await wakeOllamaViaMacDaemon(macPairingToken);
        }
        setModelLifecycle((prev) => ({
          ...prev,
          activePhase: "reasoning-gemma",
        }));

        for (const item of survivorsForGemma) {
          const analysis = await analyzeScreenshotWithGemma4({
            imageDataUrl: item.croppedImage,
            model: settings.gemmaModel,
            appName: item.cap.appName,
            windowTitle: item.cap.windowTitle,
            todayDateKey: todayKey,
            rules,
            device: "macbook",
            valenHint: item.valenMeta
              ? {
                  intentChoice: item.valenMeta.intentChoice,
                  urgencyScore: item.valenMeta.urgencyScore,
                  signalProbability: item.valenMeta.signalProbability,
                  bboxCropped: Boolean(item.valenMeta.bboxCropped),
                }
              : undefined,
          });

          if (!analysis.ok || !analysis.signal) {
            updatedCapMap.set(item.cap.id, {
              ...item.cap,
              summaryText:
                analysis.error ||
                `Kept in offline queue — run ./dayframe on your MacBook to process with ${settings.gemmaModel}.`,
              valenGate: item.valenMeta,
              syncState: "needs-gemma",
            });
            continue;
          }

          const placement = placeSignalOnCalendar({
            signal: analysis.signal,
            sourceLabel: `${item.cap.appName} screenshot`,
            sourceCaptureId: item.cap.id,
            defaultDateKey: todayKey,
            blocks: workingBlocks,
            captures: mergedCaptures,
            rules,
            settings,
          });

          workingBlocks = placement.updatedBlocks;
          let createdBlock = placement.createdBlock;

          if (createdBlock) {
            if (placement.askedUser) {
              askedQuestionsCount++;
              appendLog({
                stage: "ask-user",
                title: `Asking user: "${createdBlock.title}"`,
                detail:
                  createdBlock.clarifyingQuestion ||
                  "Queued in Confirmation Deck before touching Calendar.app.",
              });
            } else if (settings.autoWriteToCalendar) {
              const synced = await pushBlockToExternalCalendar(createdBlock);
              createdBlock = synced;
              workingBlocks = workingBlocks.map((b) =>
                b.id === synced.id ? synced : b
              );
              autoConfirmedCount++;
            } else {
              autoConfirmedCount++;
            }
          }

          updatedCapMap.set(item.cap.id, {
            ...item.cap,
            imageDataUrl: item.croppedImage,
            summaryText: analysis.signal.summary,
            modelUsed: analysis.modelUsed,
            inferenceMs: analysis.latencyMs,
            valenGate: item.valenMeta,
            extractedSignal: analysis.signal,
            createdBlockId: createdBlock?.id,
            syncState: !analysis.signal.hasActionableItem || placement.ignoredByRule
              ? "no-action"
              : placement.deduplicated
                ? "deduplicated"
                : placement.askedUser
                  ? "awaiting-confirmation"
                  : "scheduled",
          });
        }
      } else {
        appendLog({
          stage: "lifecycle",
          title: "Skipped waking Gemma 4 completely",
          detail: "0 actionable screenshots survived Valen triage — saved 100% of Stage-2 RAM/GPU.",
        });
      }

      // Acknowledge & delete processed raw disk files
      const allProcessedDiskIds = [
        ...diskIdsToAck,
        ...pendingBatch
          .filter((c) => {
            const updated = updatedCapMap.get(c.id);
            return (
              droppedCaptureIds.has(c.id) ||
              (updated && updated.syncState !== "needs-gemma")
            );
          })
          .map((c) => c.diskQueueId)
          .filter((id): id is string => Boolean(id)),
      ];
      if (allProcessedDiskIds.length > 0 && macBridgeState.paired) {
        await acknowledgeMacDiskCaptures({
          pairingToken: macPairingToken,
          ids: Array.from(new Set(allProcessedDiskIds)),
        });
        setDiskQueuedCount(0);
      }

      setBlocks(workingBlocks);
      setCaptures(
        mergedCaptures
          .filter((c) => !droppedCaptureIds.has(c.id))
          .map((c) => updatedCapMap.get(c.id) ?? c)
      );
      setSettings((prev) => ({
        ...prev,
        lastBatchRunIso: new Date().toISOString(),
      }));

      if (askedQuestionsCount > 0 && macBridgeState.paired && macPairingToken) {
        await sendMacNativeNotification({
          pairingToken: macPairingToken,
          title: "Dayframe — Confirm Calendar Blocks?",
          message: `${askedQuestionsCount} item${
            askedQuestionsCount === 1 ? " needs" : "s need"
          } your Yes/No before adding to Calendar.app.`,
        });
      }

      showToast(
        `Batch complete: ${askedQuestionsCount} asking you, ${autoConfirmedCount} scheduled, ${filteredNoise} noise skipped — unloading models to 0 MB`
      );
    } finally {
      if (settings.unloadModelsAfterBatch) {
        setModelLifecycle((prev) => ({ ...prev, activePhase: "unloading" }));
        await sleepAllModelsViaMacDaemon({
          pairingToken: macPairingToken,
          gemmaModel: settings.gemmaModel,
        });
        await unloadGemmaModelImmediately(settings.gemmaModel);
        setModelLifecycle({
          allModelsSleeping: true,
          valenRunning: false,
          ollamaDaemonRunning: false,
          loadedOllamaModels: [],
          residentAiRamMb: 0,
          activePhase: "sleeping",
          lastBatchCompletedIso: new Date().toISOString(),
        });
        setValenStatus((prev) => ({ ...prev, reachable: false }));
        setGemmaStatus((prev) => ({ ...prev, reachable: false }));
        appendLog({
          stage: "lifecycle",
          title: "Batch finished → All AI models stopped (0 MB RAM)",
          detail: "Unloaded Gemma 4 weights (keep_alive: 0) and stopped transient daemons.",
        });
      } else {
        setModelLifecycle((prev) => ({ ...prev, activePhase: "sleeping" }));
      }
      setIsRunningBatchSweep(false);
    }
  }, [
    appendLog,
    blocks,
    captures,
    isRunningBatchSweep,
    macBridgeState.paired,
    macPairingToken,
    pushBlockToExternalCalendar,
    rules,
    settings,
    showToast,
    todayKey,
  ]);

  // Scheduled Daily Batch Clock (checks every 30s; wakes models ONLY at configured windows!)
  useEffect(() => {
    if (!hydrated || !settings.setupCompleted) return;
    if (settings.batchExecutionMode !== "scheduled-batches") return;

    const timer = setInterval(() => {
      const now = new Date();
      const dKey = toLocalDateKey(now);
      const minsNow = now.getHours() * 60 + now.getMinutes();

      // Poll disk queue count silently (lightweight JSON stat, 0 AI RAM)
      if (macBridgeState.paired && macPairingToken && !isRunningBatchSweep) {
        void fetchMacDiskCaptureQueue({
          pairingToken: macPairingToken,
          includeImages: false,
        }).then((q) => {
          if (q.ok) setDiskQueuedCount(q.totalQueued);
        });
      }

      for (const winMin of settings.batchWindowMinutes) {
        const key = `${dKey}:${winMin}`;
        if (
          minsNow >= winMin &&
          minsNow <= winMin + 3 &&
          !completedBatchWindowsRef.current.has(key)
        ) {
          completedBatchWindowsRef.current.add(key);
          void runOfflineBatchSweep();
          break;
        }
      }
    }, 30000);

    return () => clearInterval(timer);
  }, [
    hydrated,
    isRunningBatchSweep,
    macBridgeState.paired,
    macPairingToken,
    runOfflineBatchSweep,
    settings.batchExecutionMode,
    settings.batchWindowMinutes,
    settings.setupCompleted,
  ]);

  // Handle incoming frame: Queue at 0 MB RAM by default, or run instant if user chose instant mode
  const handleIncomingFrame = useCallback(
    async (payload: {
      imageDataUrl: string;
      appName: string;
      windowTitle: string;
      device: "macbook" | "android";
    }) => {
      if (settings.batchExecutionMode === "scheduled-batches") {
        const queuedCap: ScreenshotCapture = {
          id: `cap-q-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          timestampIso: new Date().toISOString(),
          device: payload.device,
          appName: payload.appName,
          windowTitle: payload.windowTitle,
          summaryText:
            "Queued silently at 0 MB AI RAM — waiting for next scheduled batch sweep.",
          imageDataUrl: payload.imageDataUrl,
          modelUsed: settings.gemmaModel,
          syncState: "queued-for-batch",
        };
        setCaptures((prev) => [queuedCap, ...prev]);
        appendLog({
          stage: "capture",
          title: `Queued frame silently (${payload.appName})`,
          detail: "0 MB AI RAM used — queued for scheduled batch sweep.",
        });
        showToast("Screenshot queued silently (0 MB AI RAM)");
        return;
      }

      // Instant mode: enqueue then immediately trigger a single-item sweep
      const instantCap: ScreenshotCapture = {
        id: `cap-inst-${Date.now()}`,
        timestampIso: new Date().toISOString(),
        device: payload.device,
        appName: payload.appName,
        windowTitle: payload.windowTitle,
        summaryText: "Processing immediately...",
        imageDataUrl: payload.imageDataUrl,
        modelUsed: settings.gemmaModel,
        syncState: "queued-for-batch",
      };
      setCaptures((prev) => [instantCap, ...prev]);
      setTimeout(() => {
        void runOfflineBatchSweep();
      }, 60);
    },
    [
      appendLog,
      runOfflineBatchSweep,
      settings.batchExecutionMode,
      settings.gemmaModel,
      showToast,
    ]
  );

  const {
    isCapturing,
    secondsUntilNext,
    captureError,
    skippedStaticCount,
    startCapture,
    stopCapture,
    grabFrameNow,
    clearCaptureError,
  } = useScreenCapture({
    mode: settings.captureEngine,
    macPairingToken,
    macBridgeReady: macBridgeState.paired,
    intervalMinutes: settings.intervalMinutes,
    skipDuplicateFrames: settings.skipDuplicateFrames,
    isPaused: isCapturePaused,
    onFrameCaptured: (frame) =>
      void handleIncomingFrame({ ...frame, device: "macbook" }),
  });

  const handleStartSilentQueue = useCallback(async () => {
    if (macBridgeState.paired && macPairingToken) {
      await configureMacBackgroundCollector({
        pairingToken: macPairingToken,
        enabled: true,
        intervalMinutes: settings.intervalMinutes,
      });
    }
    await startCapture();
  }, [
    macBridgeState.paired,
    macPairingToken,
    settings.intervalMinutes,
    startCapture,
  ]);

  const handleStopSilentQueue = useCallback(async () => {
    if (macBridgeState.paired && macPairingToken) {
      await configureMacBackgroundCollector({
        pairingToken: macPairingToken,
        enabled: false,
        intervalMinutes: settings.intervalMinutes,
      });
    }
    stopCapture();
  }, [
    macBridgeState.paired,
    macPairingToken,
    settings.intervalMinutes,
    stopCapture,
  ]);

  const handleUploadMacScreenshot = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      void handleIncomingFrame({
        imageDataUrl: dataUrl,
        appName: "Uploaded Screenshot",
        windowTitle: file.name,
        device: "macbook",
      });
    };
    reader.readAsDataURL(file);
  };

  const handleFinalizeKickstart = async (writeApprovedToCalendar: boolean) => {
    if (writeApprovedToCalendar) {
      const updated: CalendarBlock[] = [];
      for (const blk of blocks) {
        if (blk.status !== "confirmed") {
          updated.push(await pushBlockToExternalCalendar(blk));
        } else {
          updated.push(blk);
        }
      }
      setBlocks(updated);
    }

    setSettings((prev) => ({
      ...prev,
      setupCompleted: true,
      lastInitialScanIso: new Date().toISOString(),
    }));
    showToast("Offline workspace ready — models sleeping at 0 MB RAM");
  };

  // Confirmation Queue Decisions ("Yes, Put on Calendar" / "Always" / "No, Skip" / "Never")
  const handleApproveProposedBlock = async (
    id: string,
    rememberAlwaysRule: boolean
  ) => {
    const target = blocks.find((b) => b.id === id);
    if (!target) return;

    const synced = await pushBlockToExternalCalendar({
      ...target,
      status: "confirmed",
    });

    setBlocks((prev) => prev.map((b) => (b.id === id ? synced : b)));
    if (target.sourceCaptureId) {
      setCaptures((prev) =>
        prev.map((c) =>
          c.id === target.sourceCaptureId ? { ...c, syncState: "scheduled" } : c
        )
      );
    }

    if (rememberAlwaysRule) {
      const trigger = extractRuleTriggerFromTitle(target.title);
      if (trigger) {
        const autoRule: StandingRule = {
          id: `rule-auto-${Date.now()}`,
          title: `Auto-schedule "${trigger.replace("|", " ")}" (${formatDuration(
            target.durationMinutes
          )})`,
          description: `Confirmed by you: automatically schedule matching items for ${formatDuration(
            target.durationMinutes
          )} without asking each time.`,
          category: "auto-confirm",
          enabled: true,
          triggerPattern: trigger,
          fixedMinutesOverride: target.durationMinutes,
          createdFromFeedback: true,
        };
        setRules((prev) => [autoRule, ...prev]);
      }
    }

    showToast(
      synced.syncedToExternalCalendar
        ? `Added "${synced.title}" to macOS Calendar.app`
        : `Confirmed "${synced.title}" on your schedule`
    );
  };

  const handleSkipProposedBlock = (id: string, rememberNeverRule: boolean) => {
    const target = blocks.find((b) => b.id === id);
    if (!target) return;

    setBlocks((prev) =>
      prev.filter((b) => b.id !== id && b.linkedMeetingId !== id)
    );
    if (target.sourceCaptureId) {
      setCaptures((prev) =>
        prev.map((c) =>
          c.id === target.sourceCaptureId ? { ...c, syncState: "no-action" } : c
        )
      );
    }

    if (rememberNeverRule) {
      const trigger = extractRuleTriggerFromTitle(target.title);
      if (trigger) {
        const ignoreRule: StandingRule = {
          id: `rule-ign-${Date.now()}`,
          title: `Ignore "${trigger.replace("|", " ")}"`,
          description: `Skipped by you: do not propose calendar blocks matching "${trigger}".`,
          category: "ignore-pattern",
          enabled: true,
          triggerPattern: trigger,
          createdFromFeedback: true,
        };
        setRules((prev) => [ignoreRule, ...prev]);
      }
    }

    showToast(
      rememberNeverRule
        ? `Skipped "${target.title}" and saved Never rule`
        : `Skipped "${target.title}"`
    );
  };

  const handleConfirmAndSyncAllAutoBlocks = async () => {
    const updated: CalendarBlock[] = [];
    let count = 0;
    for (const b of blocks) {
      if (b.status !== "confirmed") {
        count++;
        updated.push(await pushBlockToExternalCalendar(b));
      } else {
        updated.push(b);
      }
    }
    setBlocks(updated);
    setCaptures((prev) =>
      prev.map((c) =>
        c.syncState === "awaiting-confirmation"
          ? { ...c, syncState: "scheduled" }
          : c
      )
    );
    showToast(`Approved ${count} block${count === 1 ? "" : "s"}`);
  };

  const handleSetBlockExactDuration = (id: string, minutes: number) => {
    const clamped = Math.max(15, Math.min(240, minutes));
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, durationMinutes: clamped } : b))
    );
  };

  const handleAdjustBlockDuration = (
    id: string,
    deltaMinutes: number,
    saveRule: boolean
  ) => {
    const target = blocks.find((b) => b.id === id);
    if (!target) return;
    const nextDuration = Math.max(
      15,
      Math.min(240, target.durationMinutes + deltaMinutes)
    );
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === id ? { ...b, durationMinutes: nextDuration } : b
      )
    );

    if (saveRule) {
      const kw = extractRuleTriggerFromTitle(target.title);
      if (kw) {
        const calRule: StandingRule = {
          id: `rule-cal-${Date.now()}`,
          title: `Budget ${formatDuration(nextDuration)} for "${kw.replace(
            "|",
            " "
          )}"`,
          description: `Calibrated from your adjustment on "${target.title}".`,
          category: "duration-calibration",
          enabled: true,
          triggerPattern: kw,
          fixedMinutesOverride: nextDuration,
          createdFromFeedback: true,
        };
        setRules((prev) => [calRule, ...prev]);
      }
    }
    showToast(`Resized to ${formatDuration(nextDuration)}`);
  };

  const handleMoveBlockToNextSlot = (id: string) => {
    const target = blocks.find((b) => b.id === id);
    if (!target) return;
    const others = blocks.filter((b) => b.id !== id);
    const blocker: CalendarBlock = {
      ...target,
      id: "__cursor__",
      startMinutes: settings.workdayStartMinutes,
      durationMinutes: Math.max(
        15,
        target.startMinutes + 15 - settings.workdayStartMinutes
      ),
    };
    const nextSlot = findOpenSlot({
      dateKey: target.dateKey,
      durationMinutes: target.durationMinutes,
      blocks: [...others, blocker],
      rules,
      settings,
    });
    if (nextSlot !== null) {
      setBlocks(
        others
          .concat({ ...target, startMinutes: nextSlot })
          .sort(
            (a, b) =>
              a.dateKey.localeCompare(b.dateKey) ||
              a.startMinutes - b.startMinutes
          )
      );
      showToast(`Moved to ${formatMinutesToTime(nextSlot)}`);
    } else {
      showToast("No later open slot today — moving to Tomorrow");
      handleShiftBlockDate(id, 1);
    }
  };

  const handleShiftBlockDate = (id: string, deltaDays: number) => {
    const target = blocks.find((b) => b.id === id);
    if (!target) return;
    const destDate = addDaysToDateKey(target.dateKey, deltaDays);
    const others = blocks.filter((b) => b.id !== id);
    const slot =
      findOpenSlot({
        dateKey: destDate,
        durationMinutes: target.durationMinutes,
        blocks: others,
        rules,
        settings,
      }) ?? target.startMinutes;

    setBlocks(
      others
        .concat({ ...target, dateKey: destDate, startMinutes: slot })
        .sort(
          (a, b) =>
            a.dateKey.localeCompare(b.dateKey) ||
            a.startMinutes - b.startMinutes
        )
    );
    showToast(`Moved to ${destDate} at ${formatMinutesToTime(slot)}`);
  };

  const handleDeleteBlock = (id: string) => {
    setBlocks((prev) =>
      prev.filter((b) => b.id !== id && b.linkedMeetingId !== id)
    );
  };

  const handleSendFeedback = (text: string) => {
    const res = applyUserRuleFeedback({ text, blocks, rules, settings });
    setBlocks(res.blocks);
    setRules(res.rules);
    setSettings(res.settings);
    setMessages((prev) => [
      ...prev,
      {
        id: `u-${Date.now()}`,
        role: "user",
        text,
        timestampIso: new Date().toISOString(),
      },
      {
        id: `a-${Date.now() + 1}`,
        role: "assistant",
        text: res.assistantReply,
        timestampIso: new Date().toISOString(),
        appliedActionSummary: res.actionSummary,
      },
    ]);
    appendLog({
      stage: "feedback",
      title: "Applied user feedback rule",
      detail: res.actionSummary,
    });
    showToast(res.actionSummary);
  };

  const handleUpdateRecurringPrepRule = (
    prepMinutes: number,
    leadHours: number
  ) => {
    const leadMins = Math.round(leadHours * 60);
    const nextRules = rules.map((r) =>
      r.category === "prep-time" && r.appliesToRecurring
        ? {
            ...r,
            prepDurationMinutes: prepMinutes,
            minLeadMinutesBeforeMeeting: leadMins,
            title: `≥${formatDuration(leadMins)} runway before recurring meetings`,
            description: `Reserve ${formatDuration(
              prepMinutes
            )} finishing at least ${formatDuration(
              leadMins
            )} before recurring meetings.`,
          }
        : r
    );
    setRules(nextRules);
    setBlocks((prev) => reconcilePrepBlocks(prev, nextRules, settings, todayKey));
  };

  const handleRefreshMacAndroidFolder = async () => {
    if (!macBridgeState.paired || !macPairingToken) return;
    const res = await fetchMacAndroidFolderQueue(macPairingToken);
    if (!res.ok) return;

    const existingTitles = new Set(
      captures.filter((c) => c.device === "android").map((c) => c.windowTitle)
    );
    const incoming: ScreenshotCapture[] = res.screenshots
      .filter((s) => !existingTitles.has(s.filename))
      .map((s) => ({
        id: `cap-and-${Date.now()}-${s.filename}`,
        timestampIso: s.capturedAtIso,
        device: "android",
        appName: "Android Synced Folder",
        windowTitle: s.filename,
        summaryText:
          "Queued raw phone screenshot (0 MB RAM until nightly batch).",
        imageDataUrl: s.imageDataUrl,
        modelUsed: settings.gemmaModel,
        syncState: "queued-for-tonight",
      }));

    if (incoming.length > 0) {
      setCaptures((prev) => [...incoming, ...prev]);
      showToast(`Loaded ${incoming.length} new screenshot(s) from Android folder`);
    } else {
      showToast("No new unqueued files in ~/Pictures/Dayframe-Android");
    }
  };

  const handleUploadAndroidScreenshot = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const queued: ScreenshotCapture = {
        id: `cap-and-up-${Date.now()}`,
        timestampIso: new Date().toISOString(),
        device: "android",
        appName: "Android Companion",
        windowTitle: file.name,
        summaryText:
          "Queued raw phone screenshot (0 MB RAM until nightly batch).",
        imageDataUrl: String(reader.result ?? ""),
        modelUsed: settings.gemmaModel,
        syncState: "queued-for-tonight",
      };
      setCaptures((prev) => [queued, ...prev]);
      showToast("Queued phone screenshot for nightly batch run");
    };
    reader.readAsDataURL(file);
  };

  const handleRunNightlyBatchNow = async () => {
    setIsRunningNightlyBatch(true);
    try {
      const queued = captures.filter(
        (c) => c.device === "android" && c.syncState === "queued-for-tonight"
      );
      if (queued.length === 0) {
        showToast("No Android screenshots queued");
        return;
      }

      const valenSpec =
        VALEN_MODEL_CATALOG.find((v) => v.id === settings.valenModelId) ??
        VALEN_MODEL_CATALOG[0];

      const updatedMap = new Map<string, ScreenshotCapture>();
      const survivors: Array<{ cap: ScreenshotCapture; img: string }> = [];
      let skippedNoise = 0;

      if (settings.valenEnabled) {
        setModelLifecycle((prev) => ({ ...prev, activePhase: "waking-valen" }));
        if (macBridgeState.paired && macPairingToken) {
          await wakeValenViaMacDaemon({
            pairingToken: macPairingToken,
            port: settings.valenPort,
            ggufFile: valenSpec.ggufFile,
          });
        }
        setModelLifecycle((prev) => ({
          ...prev,
          activePhase: "screening-valen",
        }));
        for (const cap of queued) {
          const decision = await runValenScreenshotGate({
            imageDataUrl: cap.imageDataUrl,
            appName: cap.appName,
            windowTitle: cap.windowTitle,
            modelId: settings.valenModelId,
            port: settings.valenPort,
            signalThreshold: settings.valenSignalThreshold,
            macPairingToken,
          });
          if (
            decision &&
            (decision.isSensitiveScreen || !decision.hasCalendarSignal)
          ) {
            skippedNoise++;
            updatedMap.set(cap.id, {
              ...cap,
              summaryText: `Skipped by Valen Gate (p=${decision.signalProbability.toFixed(
                2
              )}) — no Gemma 4 run needed.`,
              syncState: "filtered-by-valen",
            });
            continue;
          }
          const img = decision?.bbox
            ? await cropImageToValenBbox(
                cap.imageDataUrl,
                decision.bbox,
                0.45,
                decision.bboxConfidence
              )
            : cap.imageDataUrl;
          survivors.push({ cap, img });
        }
        if (settings.unloadModelsAfterBatch && macBridgeState.paired) {
          await stopValenViaMacDaemon(macPairingToken);
        }
      } else {
        for (const cap of queued) {
          survivors.push({ cap, img: cap.imageDataUrl });
        }
      }

      let workingBlocks = [...blocks];
      let added = 0;
      let deduped = 0;

      if (survivors.length > 0) {
        setModelLifecycle((prev) => ({ ...prev, activePhase: "waking-gemma" }));
        if (macBridgeState.paired && macPairingToken) {
          await wakeOllamaViaMacDaemon(macPairingToken);
        }
        setModelLifecycle((prev) => ({
          ...prev,
          activePhase: "reasoning-gemma",
        }));

        for (const { cap, img } of survivors) {
          const analysis = await analyzeScreenshotWithGemma4({
            imageDataUrl: img,
            model: settings.gemmaModel,
            appName: cap.appName,
            windowTitle: cap.windowTitle,
            todayDateKey: todayKey,
            rules,
            device: "android",
          });

          if (!analysis.ok || !analysis.signal) {
            updatedMap.set(cap.id, {
              ...cap,
              summaryText:
                analysis.error || "Local Gemma 4 sleeping — kept in queue.",
            });
            continue;
          }

          const placement = placeSignalOnCalendar({
            signal: analysis.signal,
            sourceLabel: `Android (${cap.windowTitle})`,
            sourceCaptureId: cap.id,
            defaultDateKey: addDaysToDateKey(todayKey, 1),
            blocks: workingBlocks,
            captures,
            rules,
            settings,
          });

          workingBlocks = placement.updatedBlocks;
          if (placement.deduplicated) deduped++;
          if (placement.createdBlock) added++;

          updatedMap.set(cap.id, {
            ...cap,
            summaryText: analysis.signal.summary,
            inferenceMs: analysis.latencyMs,
            extractedSignal: analysis.signal,
            createdBlockId: placement.createdBlock?.id,
            syncState: !analysis.signal.hasActionableItem
              ? "no-action"
              : placement.deduplicated
                ? "deduplicated"
                : placement.askedUser
                  ? "awaiting-confirmation"
                  : "scheduled",
          });
        }
      }

      setBlocks(workingBlocks);
      setCaptures((prev) => prev.map((c) => updatedMap.get(c.id) ?? c));
      const msg = `Processed ${queued.length} phone shot(s): ${added} proposed for Tomorrow, ${deduped} duplicates skipped, ${skippedNoise} noise filtered — models unloaded back to 0 MB.`;
      setLastBatchSummary(msg);
      showToast(msg);
    } finally {
      if (settings.unloadModelsAfterBatch) {
        setModelLifecycle((prev) => ({ ...prev, activePhase: "unloading" }));
        await sleepAllModelsViaMacDaemon({
          pairingToken: macPairingToken,
          gemmaModel: settings.gemmaModel,
        });
        await unloadGemmaModelImmediately(settings.gemmaModel);
        setModelLifecycle({
          allModelsSleeping: true,
          valenRunning: false,
          ollamaDaemonRunning: false,
          loadedOllamaModels: [],
          residentAiRamMb: 0,
          activePhase: "sleeping",
          lastBatchCompletedIso: new Date().toISOString(),
        });
      }
      setIsRunningNightlyBatch(false);
    }
  };

  if (!settings.setupCompleted) {
    return (
      <KickstartWizard
        todayKey={todayKey}
        settings={settings}
        onUpdateSettings={(patch) =>
          setSettings((prev) => ({ ...prev, ...patch }))
        }
        rules={rules}
        onUpdateRecurringPrepRule={handleUpdateRecurringPrepRule}
        onAddPlainEnglishRule={(text) => handleSendFeedback(text)}
        gemmaStatus={gemmaStatus}
        onRecheckGemma={refreshGemmaStatus}
        valenStatus={valenStatus}
        onRecheckValen={refreshValenStatus}
        macBridgeState={macBridgeState}
        macPairingToken={macPairingToken}
        onChangeMacPairingToken={setMacPairingToken}
        onVerifyMacBridge={verifyAndLoadMacBridge}
        macCalendars={macCalendars}
        onRunOneOffInitialScan={runBaselineCalendarAndMailScan}
        scannedBlocks={blocks}
        scannedEmails={scannedEmails}
        onAdjustScannedBlockDuration={(id, delta) =>
          handleAdjustBlockDuration(id, delta, false)
        }
        onRemoveScannedBlock={handleDeleteBlock}
        onFinalizeKickstart={handleFinalizeKickstart}
      />
    );
  }

  const androidCaptures = captures.filter((c) => c.device === "android");
  const queuedAndroidCount = androidCaptures.filter(
    (c) => c.syncState === "queued-for-tonight"
  ).length;
  const inMemoryQueuedMacCount = captures.filter(
    (c) =>
      c.device === "macbook" &&
      (c.syncState === "queued-for-batch" || c.syncState === "needs-gemma")
  ).length;
  const totalQueuedBatchCount = inMemoryQueuedMacCount + diskQueuedCount;
  const proposedBlocks = blocks.filter((b) => b.status === "proposed");

  return (
    <div className="min-h-screen bg-muted/20 text-foreground">
      <TopMenubar
        settings={settings}
        onUpdateSettings={(patch) =>
          setSettings((prev) => ({ ...prev, ...patch }))
        }
        gemmaStatus={gemmaStatus}
        onRecheckGemma={refreshGemmaStatus}
        valenStatus={valenStatus}
        onRecheckValen={refreshValenStatus}
        modelLifecycle={modelLifecycle}
        onForceSleepModels={handleForceSleepModels}
        gateStats={gateStats}
        macBridgeState={macBridgeState}
        isCapturing={isCapturing}
        isCapturePaused={isCapturePaused}
        onTogglePauseCapture={() => setIsCapturePaused((p) => !p)}
        secondsUntilNext={secondsUntilNext}
        skippedStaticCount={skippedStaticCount}
        onStartCapture={() => void handleStartSilentQueue()}
        onStopCapture={() => void handleStopSilentQueue()}
        onSnapNow={() => void grabFrameNow(true)}
        queuedBatchCount={totalQueuedBatchCount}
        isRunningBatchSweep={isRunningBatchSweep}
        onRunBatchSweepNow={() => void runOfflineBatchSweep()}
        isSyncingCalendar={isSyncingCalendar}
        onRescanCalendarAndMail={() => {
          void runBaselineCalendarAndMailScan().then((res) => {
            if (res.ok) {
              showToast(
                `Synced ${res.existingCount} events & ${res.emailCount} Mail messages (${res.proposedCount} awaiting your Yes/No)`
              );
            } else if (res.error) {
              showToast(res.error);
            }
          });
        }}
        queuedAndroidCount={queuedAndroidCount}
        onOpenAndroidSync={() => setAndroidSheetOpen(true)}
        onReopenSetupWizard={() =>
          setSettings((prev) => ({ ...prev, setupCompleted: false }))
        }
        pipelineLogs={pipelineLogs}
      />

      <main className="mx-auto grid max-w-[1600px] grid-cols-1 gap-4 p-4 lg:grid-cols-12 lg:p-6">
        <div className="order-2 lg:order-1 lg:col-span-3">
          <CaptureStreamPanel
            captures={captures}
            queuedBatchCount={totalQueuedBatchCount}
            isRunningBatch={isRunningBatchSweep}
            onRunBatchNow={() => void runOfflineBatchSweep()}
            captureError={captureError}
            onDismissCaptureError={clearCaptureError}
            onUploadScreenshotFile={handleUploadMacScreenshot}
            onSelectBlockId={(id) => setSelectedBlockId(id)}
            gemmaModel={settings.gemmaModel}
          />
        </div>

        <div className="order-1 space-y-4 lg:order-2 lg:col-span-6">
          <PendingConfirmationsDeck
            todayKey={todayKey}
            proposedBlocks={proposedBlocks}
            confirmationPolicy={settings.confirmationPolicy}
            onChangeConfirmationPolicy={(policy) =>
              setSettings((prev) => ({ ...prev, confirmationPolicy: policy }))
            }
            onApproveBlock={(id, alwaysRule) =>
              void handleApproveProposedBlock(id, alwaysRule)
            }
            onSkipBlock={handleSkipProposedBlock}
            onApproveAll={() => void handleConfirmAndSyncAllAutoBlocks()}
            onSetBlockExactDuration={handleSetBlockExactDuration}
            onMoveBlockToNextSlot={handleMoveBlockToNextSlot}
            onPushBlockTomorrow={(id) => handleShiftBlockDate(id, 1)}
          />

          <CalendarTimeline
            todayKey={todayKey}
            anchorDateKey={anchorDateKey}
            onChangeAnchorDateKey={setAnchorDateKey}
            blocks={blocks}
            captures={captures}
            rules={rules}
            settings={settings}
            selectedBlockId={selectedBlockId}
            onSelectBlockId={setSelectedBlockId}
            onConfirmAndSyncBlock={(id) =>
              void handleApproveProposedBlock(id, false)
            }
            onConfirmAndSyncAllAutoBlocks={() =>
              void handleConfirmAndSyncAllAutoBlocks()
            }
            onAdjustBlockDuration={handleAdjustBlockDuration}
            onMoveBlockToNextSlot={handleMoveBlockToNextSlot}
            onShiftBlockDate={handleShiftBlockDate}
            onDeleteBlock={(id) => handleSkipProposedBlock(id, false)}
            onRunCalendarScanNow={() => {
              void runBaselineCalendarAndMailScan().then((r) => {
                if (!r.ok && r.error) showToast(r.error);
              });
            }}
            onOpenSetupWizard={() =>
              setSettings((prev) => ({ ...prev, setupCompleted: false }))
            }
          />
        </div>

        <div className="order-3 lg:col-span-3">
          <OrganizerFeedbackPanel
            messages={messages}
            rules={rules}
            suggestedPrompts={suggestedPrompts}
            onSendFeedback={handleSendFeedback}
            onAcceptSuggestion={(promptId) => {
              const prompt = suggestedPrompts.find((p) => p.id === promptId);
              if (!prompt) return;
              const newRule: StandingRule = {
                ...prompt.ruleToCreate,
                id: `rule-sug-${Date.now()}`,
                createdFromFeedback: true,
              };
              const nextRules = [newRule, ...rules];
              setRules(nextRules);
              setBlocks((prev) =>
                reconcilePrepBlocks(prev, nextRules, settings, todayKey)
              );
              setSuggestedPrompts((prev) =>
                prev.map((p) =>
                  p.id === promptId ? { ...p, answered: "accepted" } : p
                )
              );
              showToast(`Enabled rule: ${newRule.title}`);
            }}
            onDismissSuggestion={(promptId) =>
              setSuggestedPrompts((prev) =>
                prev.map((p) =>
                  p.id === promptId ? { ...p, answered: "dismissed" } : p
                )
              )
            }
            onToggleRule={(ruleId, enabled) => {
              const nextRules = rules.map((r) =>
                r.id === ruleId ? { ...r, enabled } : r
              );
              setRules(nextRules);
              setBlocks((prev) =>
                reconcilePrepBlocks(prev, nextRules, settings, todayKey)
              );
            }}
            onDeleteRule={(ruleId) => {
              const nextRules = rules.filter((r) => r.id !== ruleId);
              setRules(nextRules);
              setBlocks((prev) =>
                reconcilePrepBlocks(prev, nextRules, settings, todayKey)
              );
            }}
            onAddManualPrepRule={(opts) => {
              const leadMins = Math.round(opts.leadHours * 60);
              const newRule: StandingRule = {
                id: `rule-man-${Date.now()}`,
                title: `${formatDuration(opts.prepMinutes)} prep (≥${formatDuration(
                  leadMins
                )} ahead) for "${opts.keyword}"`,
                description: `Reserve ${formatDuration(
                  opts.prepMinutes
                )} finishing ≥${formatDuration(leadMins)} before "${opts.keyword}".`,
                category: "prep-time",
                enabled: true,
                triggerPattern: opts.keyword,
                prepDurationMinutes: opts.prepMinutes,
                minLeadMinutesBeforeMeeting: leadMins,
                createdFromFeedback: true,
              };
              const nextRules = [newRule, ...rules];
              setRules(nextRules);
              setBlocks((prev) =>
                reconcilePrepBlocks(prev, nextRules, settings, todayKey)
              );
              showToast(`Added prep rule for "${opts.keyword}"`);
            }}
          />
        </div>
      </main>

      <NightlyAndroidSheet
        open={androidSheetOpen}
        onOpenChange={setAndroidSheetOpen}
        androidCaptures={androidCaptures}
        androidFolderPath={
          macBridgeState.androidSyncFolder || "~/Pictures/Dayframe-Android"
        }
        macBridgePaired={macBridgeState.paired}
        nightlySyncHour={settings.nightlyAndroidSyncHour}
        gemmaModel={settings.gemmaModel}
        isRunningBatch={isRunningNightlyBatch}
        lastBatchSummary={lastBatchSummary}
        onRefreshMacAndroidFolder={() => void handleRefreshMacAndroidFolder()}
        onRunNightlyBatchNow={() => void handleRunNightlyBatchNow()}
        onUploadAndroidScreenshot={handleUploadAndroidScreenshot}
      />

      {toastBanner && (
        <div className="fixed right-5 bottom-5 z-40 max-w-sm rounded-xl border bg-foreground px-4 py-2.5 text-xs font-medium text-background shadow-lg">
          {toastBanner}
        </div>
      )}
    </div>
  );
}
