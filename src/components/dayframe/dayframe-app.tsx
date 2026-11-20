"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { KickstartWizard } from "./kickstart-wizard";
import { TopMenubar } from "./top-menubar";
import { CaptureStreamPanel } from "./capture-stream-panel";
import { PendingConfirmationsDeck } from "./pending-confirmations-deck";
import { CalendarTimeline } from "./calendar-timeline";
import { EventWorkspaceDialog } from "./event-workspace-dialog";
import { OrganizerFeedbackPanel } from "./organizer-feedback-panel";
import { NightlyAndroidSheet } from "./nightly-android-sheet";
import { useScreenCapture } from "@/hooks/use-screen-capture";
import {
  CalendarBlock,
  CalibrationSample,
  DiscussionMessage,
  EventChatMessage,
  EventSubtask,
  GatekeeperStats,
  MacCalendarDescriptor,
  ModelLifecycleState,
  OrganizerSettings,
  PipelineLogEntry,
  RelevantPaperRef,
  ScannedEmailItem,
  ScreenshotCapture,
  StandingRule,
  SuggestedPreferencePrompt,
  UserModelGraph,
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
  isEligibleRealMeetingForPrep,
  placeGemmaContextualPrepBlock,
  placeSignalOnCalendar,
  reconcilePrepBlocks,
} from "@/lib/scheduler";
import {
  analyzeScreenshotWithGemma4,
  chatAndEnrichEventWithGemma4,
  decomposeGoalWithGemma4,
  induceUserAndTaskModelsWithGemma4,
  LocalGemmaStatus,
  planHolisticCalendarWithGemma4,
  probeLocalGemma,
  resolveInstalledGemmaTag,
  unloadGemmaModelImmediately,
} from "@/lib/gemma-client";
import {
  cropImageToValenBbox,
  filterInboxEmailsWithValen,
  probeValenRuntime,
  runValenScreenshotGate,
  VALEN_MODEL_CATALOG,
  ValenRuntimeStatus,
} from "@/lib/valen-decision";
import {
  pullNextFutureTaskIntoToday,
  scheduleBlocksForTargetEvent,
  scheduleTaskOntoCalendar,
  scheduleWeeklyCadenceOntoCalendar,
  takeOverdueWorkForward,
} from "@/lib/place-on-calendar";
import {
  parseEventChatCommand,
  parseNaturalTaskInput,
} from "@/lib/nl-schedule-parser";
import {
  DEFAULT_USER_MODEL_GRAPH,
  extractDistinctiveKeywords,
  findMatchingTaskModel,
  matchCapturesForKeywords,
  mergeTaskModelsWithConstraint,
  reassignTaskModelStriving,
  removeModelEntityWithConstraint,
  renameStrivingWithConstraint,
  renameTaskModelWithConstraint,
  upsertTaskModelFromSchedule,
} from "@/lib/user-task-model";
import {
  describeCalendar,
  isPersonalUmichCalendar,
  pickDefaultReadCalendarIds,
  pickPersonalUmichCalendar,
} from "@/lib/umich-calendar";
import { TaskComposer } from "./task-composer";
import {
  acknowledgeMacDiskCaptures,
  captureOpenSlackAndMailWindows,
  deleteBlockFromMacCalendar,
  configureMacBackgroundCollector,
  fetchMacAndroidFolderQueue,
  fetchMacDiskCaptureQueue,
  fetchMacModelLifecycle,
  MacBridgeConnectionState,
  probeMacBridge,
  openLocalMacFile,
  scanMacCalendarEvents,
  scanMacMailMessages,
  searchLocalMacPapers,
  searchMacMailByQuery,
  sendMacNativeNotification,
  sleepAllModelsViaMacDaemon,
  stopValenViaMacDaemon,
  toLocalDateKey,
  updateBlockOnMacCalendar,
  wakeOllamaViaMacDaemon,
  wakeValenViaMacDaemon,
  writeBlockToMacCalendar,
} from "@/lib/calendar-connectors";

const STORAGE_KEY_V3 = "dayframe.contextual.v3";
const LEGACY_V2_KEY = "dayframe.real.v2";
const LEGACY_TOY_KEY = "dayframe.workspace.v1";

interface PersistedWorkspaceV2 {
  settings: OrganizerSettings;
  blocks: CalendarBlock[];
  captures: ScreenshotCapture[];
  rules: StandingRule[];
  messages: DiscussionMessage[];
  suggestedPrompts: SuggestedPreferencePrompt[];
  gateStats: GatekeeperStats;
  calibrationSamples: CalibrationSample[];
  userGraph: UserModelGraph;
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

  const [calibrationSamples, setCalibrationSamples] = useState<
    CalibrationSample[]
  >([]);
  const [userGraph, setUserGraph] = useState<UserModelGraph>(
    DEFAULT_USER_MODEL_GRAPH
  );
  const [isInducingModels, setIsInducingModels] = useState(false);
  const [isEnrichingEvent, setIsEnrichingEvent] = useState(false);
  const [scopeDialogOpen, setScopeDialogOpen] = useState(false);
  const [decomposingWithAi, setDecomposingWithAi] = useState(false);
  const [scarcityWarning, setScarcityWarning] = useState<string | null>(null);

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
        // Migrate pairing token from v2 if upgrading, while purging stale v2 naive prep blocks
        const legacyV2Raw = localStorage.getItem(LEGACY_V2_KEY);
        if (legacyV2Raw) {
          try {
            const v2 = JSON.parse(legacyV2Raw) as Partial<PersistedWorkspaceV2>;
            if (v2.macPairingToken) {
              loadedToken = v2.macPairingToken;
              setMacPairingToken(v2.macPairingToken);
            }
          } catch {}
          localStorage.removeItem(LEGACY_V2_KEY);
        }

        const raw = localStorage.getItem(STORAGE_KEY_V3);
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
              autoWriteToCalendar: true,
              confirmationPolicy:
                parsed.settings.confirmationPolicy === "always-ask"
                  ? "always-ask"
                  : "auto-high-confidence",
            };
            if (
              !merged.pinnedWriteCalendar &&
              !isPersonalUmichCalendar(
                merged.writableCalendarTitle,
                merged.writableCalendarSource
              )
            ) {
              merged.writableCalendarId = "";
              merged.writableCalendarTitle = "UMich calendar not selected";
              merged.writableCalendarSource = "";
            }
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
          if (parsed.calibrationSamples)
            setCalibrationSamples(parsed.calibrationSamples);
          if (parsed.userGraph)
            setUserGraph({
              ...DEFAULT_USER_MODEL_GRAPH,
              ...parsed.userGraph,
            });
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
        const [life, calInit] = await Promise.all([
          fetchMacModelLifecycle({
            pairingToken: loadedToken,
            valenPort: loadedValenPort,
          }),
          scanMacCalendarEvents({ pairingToken: loadedToken, daysAhead: 28 }),
        ]);
        if (!cancelled && life) {
          setModelLifecycle({ ...life, activePhase: "sleeping" });
        }
        if (!cancelled && calInit.ok) {
          setMacCalendars(calInit.calendars);
          setSettings((prev) => {
            const pinned = prev.pinnedWriteCalendar
              ? calInit.calendars.find(
                  (c) => c.id === prev.writableCalendarId && c.allowsModify
                )
              : undefined;
            const picked = pinned || pickPersonalUmichCalendar(calInit.calendars);
            const defaultReads = pickDefaultReadCalendarIds(
              calInit.calendars,
              picked?.id
            );
            if (!picked) {
              return {
                ...prev,
                readCalendarIds: prev.readCalendarScopeInitialized
                  ? prev.readCalendarIds
                  : defaultReads,
                readCalendarScopeInitialized: true,
              };
            }
            const activeReads = prev.readCalendarScopeInitialized
              ? prev.readCalendarIds.includes(picked.id)
                ? prev.readCalendarIds
                : [picked.id, ...prev.readCalendarIds]
              : defaultReads;
            return {
              ...prev,
              writableCalendarId: picked.id,
              writableCalendarTitle: picked.title,
              writableCalendarSource: picked.sourceTitle,
              readCalendarIds: activeReads,
              readCalendarScopeInitialized: true,
            };
          });
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
        calibrationSamples,
        userGraph,
        macPairingToken,
      };
      localStorage.setItem(STORAGE_KEY_V3, JSON.stringify(payload));
    } catch {
      // Ignore quota exceeded
    }
  }, [
    blocks,
    calibrationSamples,
    captures,
    gateStats,
    hydrated,
    macPairingToken,
    messages,
    rules,
    settings,
    suggestedPrompts,
    userGraph,
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

  const writeCalendarRef = useRef(settings.writableCalendarId);

  const rememberWriteCalendar = useCallback(
    (calendars: MacCalendarDescriptor[]) => {
      setMacCalendars(calendars);
      const pinned = settings.pinnedWriteCalendar
        ? calendars.find(
            (c) => c.id === settings.writableCalendarId && c.allowsModify
          )
        : undefined;
      const picked = pinned || pickPersonalUmichCalendar(calendars);

      const defaultReads = pickDefaultReadCalendarIds(
        calendars,
        picked?.id
      );

      if (!picked) {
        writeCalendarRef.current = "";
        setSettings((prev) => ({
          ...prev,
          writableCalendarId: "",
          writableCalendarTitle: "UMich calendar not selected",
          writableCalendarSource: "",
          readCalendarIds: prev.readCalendarScopeInitialized
            ? prev.readCalendarIds
            : defaultReads,
          readCalendarScopeInitialized: true,
        }));
        return null;
      }
      writeCalendarRef.current = picked.id;
      setSettings((prev) => {
        const activeReads = prev.readCalendarScopeInitialized
          ? prev.readCalendarIds.includes(picked.id)
            ? prev.readCalendarIds
            : [picked.id, ...prev.readCalendarIds]
          : defaultReads;
        return {
          ...prev,
          writableCalendarId: picked.id,
          writableCalendarTitle: picked.title,
          writableCalendarSource: picked.sourceTitle,
          readCalendarIds: activeReads,
          readCalendarScopeInitialized: true,
        };
      });
      return picked;
    },
    [settings.pinnedWriteCalendar, settings.writableCalendarId]
  );

  useEffect(() => {
    writeCalendarRef.current = settings.writableCalendarId;
  }, [settings.writableCalendarId]);

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
        daysAhead: 28,
      });
      if (scan.ok) {
        const picked = rememberWriteCalendar(scan.calendars);
        showToast(
          picked
            ? `Writing only to ${describeCalendar(picked)}`
            : "Paired. Choose your personal UMich calendar before anything is written."
        );
      }
    } else if (state.error) {
      showToast(state.error);
    }
  }, [macPairingToken, rememberWriteCalendar, showToast, syncLifecycleSnapshot]);

  const pushBlockToExternalCalendar = useCallback(
    async (block: CalendarBlock): Promise<CalendarBlock> => {
      if (block.syncedToExternalCalendar || block.occupiesTimeOnly) return block;
      const calendarId = writeCalendarRef.current;
      if (!calendarId) return block;

      if (macBridgeState.paired && macPairingToken) {
        const res = await writeBlockToMacCalendar({
          pairingToken: macPairingToken,
          block,
          calendarId,
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
    ]
  );

  // Contextual Scan: Calendar (attendees/notes/URLs) + Open Slack/Mail Windows + Apple Mail -> Gemma 4 -> Unload to 0 MB RAM
  const runBaselineCalendarAndMailScan = useCallback(async (): Promise<{
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
  }> => {
    setIsSyncingCalendar(true);
    try {
      const bridge = await probeMacBridge(macPairingToken);
      setMacBridgeState(bridge);
      if (!bridge.paired) {
        return {
          ok: false,
          existingCount: 0,
          eligibleMeetingCount: 0,
          skippedChoreCount: 0,
          windowsCapturedNames: [],
          emailCount: 0,
          proposedCount: 0,
          gemmaRan: false,
          error:
            bridge.error ||
            "Mac Daemon is not paired yet. Run `./dayframe` (or `Dayframe.command`) on your MacBook.",
        };
      }

      const [calRes, mailRes, winRes] = await Promise.all([
        scanMacCalendarEvents({ pairingToken: macPairingToken, daysAhead: 28 }),
        scanMacMailMessages({ pairingToken: macPairingToken, limit: 12 }),
        captureOpenSlackAndMailWindows({
          pairingToken: macPairingToken,
          maxWindows: 4,
        }),
      ]);

      if (!calRes.ok) {
        return {
          ok: false,
          existingCount: 0,
          eligibleMeetingCount: 0,
          skippedChoreCount: 0,
          windowsCapturedNames: [],
          emailCount: 0,
          proposedCount: 0,
          gemmaRan: false,
          error: calRes.error,
        };
      }

      const writeTarget = rememberWriteCalendar(calRes.calendars);
      const writeId = writeTarget?.id || "";
      const activeReadIds = settings.readCalendarScopeInitialized && settings.readCalendarIds.length > 0
        ? Array.from(new Set([...(writeId ? [writeId] : []), ...settings.readCalendarIds]))
        : pickDefaultReadCalendarIds(calRes.calendars, writeId || undefined);
      const activeReadSet = new Set(activeReadIds);

      const fetchedCalendarBlocks = calRes.blocks
        .filter((block) => !block.calendarId || activeReadSet.has(block.calendarId))
        .map((block) => ({
          ...block,
          occupiesTimeOnly: Boolean(
            writeId &&
              block.calendarId &&
              block.calendarId !== writeId &&
              !block.isDayframeCreated
          ),
        }));
      const fetchedEmails = mailRes.messages;
      setScannedEmails(fetchedEmails);

      const eligibleMeetings = fetchedCalendarBlocks.filter(
        isEligibleRealMeetingForPrep
      );
      const skippedChoreCount = Math.max(
        0,
        fetchedCalendarBlocks.length - eligibleMeetings.length
      );
      const capturedWindows = winRes.windowsCaptured ?? [];
      const windowsCapturedNames = capturedWindows.map(
        (w) =>
          `${w.ownerName}${
            w.windowTitle && w.windowTitle !== w.ownerName
              ? ` (${w.windowTitle.slice(0, 28)})`
              : ""
          }`
      );

      const valenSpec =
        VALEN_MODEL_CATALOG.find((v) => v.id === settings.valenModelId) ??
        VALEN_MODEL_CATALOG[0];

      // Phase 1 (Optional): Valen screens Apple Mail newsletters, then stops immediately
      let candidateEmails = fetchedEmails;
      if (settings.valenEnabled && fetchedEmails.length > 0) {
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

        if (settings.unloadModelsAfterBatch) {
          await stopValenViaMacDaemon(macPairingToken);
        }
      }

      // Start ONLY from real existing calendar events + explicit keyword rules (NO blind recurring chore prep!)
      let workingBlocks = reconcilePrepBlocks(
        fetchedCalendarBlocks,
        rules,
        settings,
        todayKey
      );
      let workingCaptures = [...captures];

      // Phase 2: ALWAYS wake Gemma 4 to inspect open Slack/Mail windows + reason holistically across Calendar & Mail
      setModelLifecycle((prev) => ({ ...prev, activePhase: "waking-gemma" }));
      await wakeOllamaViaMacDaemon(macPairingToken);
      const gStatus = await probeLocalGemma(settings.gemmaModel);
      setGemmaStatus(gStatus);

      let gemmaRan = false;
      let gemmaNote: string | undefined;

      if (!gStatus.reachable) {
        gemmaNote =
          "Local Ollama could not be started on 127.0.0.1:11434. Install Ollama (`brew install ollama` and `ollama pull gemma4:e4b`) so Gemma 4 can analyze your meetings, Slack, and emails.";
      } else {
        const activeGemmaTag = resolveInstalledGemmaTag(
          settings.gemmaModel,
          gStatus
        );
        setModelLifecycle((prev) => ({
          ...prev,
          activePhase: "reasoning-gemma",
        }));

        // 2A. Read captured open Slack & Gmail/Mail windows with Gemma 4 Vision
        const windowObservations: Array<{ source: string; detail: string }> = [];

        for (const win of capturedWindows) {
          const sourceName =
            win.kind === "slack"
              ? `Slack (${win.windowTitle.slice(0, 40)})`
              : `${win.ownerName} (${win.windowTitle.slice(0, 40)})`;

          const winAnalysis = await analyzeScreenshotWithGemma4({
            imageDataUrl: win.imageDataUrl,
            model: activeGemmaTag,
            appName: win.ownerName,
            windowTitle: win.windowTitle,
            todayDateKey: todayKey,
            existingBlocks: workingBlocks,
            rules,
            settings,
            device: "macbook",
          });

          if (winAnalysis.ok) {
            gemmaRan = true;
            if (winAnalysis.rawObservation) {
              windowObservations.push({
                source: sourceName,
                detail: winAnalysis.rawObservation,
              });
            }

            const capId = `cap-win-${Date.now()}-${win.windowId}`;
            let createdId: string | undefined;
            let asked = false;
            let dedup = false;

            if (winAnalysis.signal?.hasActionableItem) {
              const placed = placeSignalOnCalendar({
                signal: winAnalysis.signal,
                sourceLabel: sourceName,
                sourceCaptureId: capId,
                contextSources: [sourceName],
                defaultDateKey: todayKey,
                blocks: workingBlocks,
                captures: workingCaptures,
                rules,
                settings,
              });
              workingBlocks = placed.updatedBlocks;
              createdId = placed.createdBlock?.id;
              asked = placed.askedUser;
              dedup = placed.deduplicated;
            }

            const newWinCap: ScreenshotCapture = {
              id: capId,
              timestampIso: new Date().toISOString(),
              device: "macbook",
              appName: sourceName,
              windowTitle: win.windowTitle,
              summaryText:
                winAnalysis.signal?.contextEvidence ||
                winAnalysis.signal?.summary ||
                "Read window context.",
              imageDataUrl: win.imageDataUrl,
              modelUsed: activeGemmaTag,
              inferenceMs: winAnalysis.latencyMs,
              extractedSignal: winAnalysis.signal,
              createdBlockId: createdId,
              syncState: !winAnalysis.signal?.hasActionableItem
                ? "no-action"
                : dedup
                  ? "deduplicated"
                  : asked
                    ? "awaiting-confirmation"
                    : "scheduled",
            };
            workingCaptures = [newWinCap, ...workingCaptures];
          }
        }

        // 2B. Holistic Gemma 4 planner across eligible meetings + Slack observations + Apple Mail
        const holistic = await planHolisticCalendarWithGemma4({
          model: activeGemmaTag,
          todayDateKey: todayKey,
          allCalendarBlocks: workingBlocks,
          emails: candidateEmails,
          windowObservations,
          rules,
          settings,
        });

        if (holistic.ok) {
          gemmaRan = true;
          appendLog({
            stage: "gemma4",
            title: `Gemma 4 analyzed ${eligibleMeetings.length} real meeting(s), ${capturedWindows.length} Slack/Mail window(s), and ${candidateEmails.length} email(s)`,
            detail: `Skipped ${skippedChoreCount} chores/solo routines; proposed ${holistic.prepProposals.length} contextual prep block(s) and ${holistic.actionProposals.length} task/hold block(s).`,
            modelUsed: activeGemmaTag,
            latencyMs: holistic.latencyMs,
          });

          for (const prep of holistic.prepProposals) {
            const targetMeeting = workingBlocks.find(
              (b) => b.id === prep.meetingId
            );
            if (!targetMeeting) continue;
            const res = placeGemmaContextualPrepBlock({
              meeting: targetMeeting,
              prepTitle: prep.prepTitle,
              prepMinutes: prep.prepMinutes,
              contextEvidence: prep.contextEvidence,
              contextSources: prep.contextSources,
              confidence: prep.confidence,
              askUser: prep.askUser,
              clarifyingQuestion: prep.clarifyingQuestion,
              blocks: workingBlocks,
              rules,
              settings,
              todayKey,
            });
            workingBlocks = res.updatedBlocks;
          }

          for (const act of holistic.actionProposals) {
            const placed = placeSignalOnCalendar({
              signal: act.signal,
              sourceLabel: act.sourceLabel,
              contextSources: act.contextSources,
              defaultDateKey: todayKey,
              blocks: workingBlocks,
              captures: workingCaptures,
              rules,
              settings,
            });
            workingBlocks = placed.updatedBlocks;
          }
        } else if (holistic.error) {
          gemmaNote = holistic.error;
        }
      }

      if (settings.autoWriteToCalendar && writeCalendarRef.current) {
        const written: CalendarBlock[] = [];
        for (const block of workingBlocks) {
          if (
            block.isDayframeCreated &&
            block.status === "confirmed" &&
            !block.syncedToExternalCalendar
          ) {
            written.push(await pushBlockToExternalCalendar(block));
          } else {
            written.push(block);
          }
        }
        workingBlocks = written;
      }

      setCaptures(workingCaptures);
      setBlocks(workingBlocks);
      const proposedCount = workingBlocks.filter(
        (b) => b.status === "proposed"
      ).length;

      return {
        ok: true,
        existingCount: fetchedCalendarBlocks.length,
        eligibleMeetingCount: eligibleMeetings.length,
        skippedChoreCount,
        windowsCapturedNames,
        screenPermissionNeeded: winRes.screenPermissionNeeded,
        emailCount: fetchedEmails.length,
        proposedCount,
        gemmaRan,
        gemmaNote,
      };
    } catch (err) {
      return {
        ok: false,
        existingCount: 0,
        eligibleMeetingCount: 0,
        skippedChoreCount: 0,
        windowsCapturedNames: [],
        emailCount: 0,
        proposedCount: 0,
        gemmaRan: false,
        error: err instanceof Error ? err.message : "Contextual scan failed.",
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
    pushBlockToExternalCalendar,
    rememberWriteCalendar,
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

      let pendingBatch = mergedCaptures.filter(
        (c) =>
          c.device === "macbook" &&
          (c.syncState === "queued-for-batch" || c.syncState === "needs-gemma")
      );

      // If no queued screenshots yet, capture currently open Slack & Mail windows directly!
      if (pendingBatch.length === 0 && macBridgeState.paired && macPairingToken) {
        const liveWins = await captureOpenSlackAndMailWindows({
          pairingToken: macPairingToken,
          maxWindows: 3,
        });
        if (liveWins.ok && liveWins.windowsCaptured.length > 0) {
          const freshWinCaps: ScreenshotCapture[] = liveWins.windowsCaptured.map(
            (w) => ({
              id: `cap-livewin-${Date.now()}-${w.windowId}`,
              timestampIso: new Date().toISOString(),
              device: "macbook",
              appName:
                w.kind === "slack" ? `Slack (${w.ownerName})` : w.ownerName,
              windowTitle: w.windowTitle,
              summaryText: "Captured open Slack/Mail window for batch sweep...",
              imageDataUrl: w.imageDataUrl,
              modelUsed: settings.gemmaModel,
              syncState: "queued-for-batch",
            })
          );
          mergedCaptures = [...freshWinCaps, ...mergedCaptures];
          pendingBatch = freshWinCaps;
        }
      }

      if (pendingBatch.length === 0) {
        showToast(
          "No queued screenshots or open Slack/Mail windows found (models stayed at 0 MB RAM)"
        );
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
        const gStat = await probeLocalGemma(settings.gemmaModel);
        setGemmaStatus(gStat);
        const activeGemmaTag = resolveInstalledGemmaTag(
          settings.gemmaModel,
          gStat
        );
        setModelLifecycle((prev) => ({
          ...prev,
          activePhase: "reasoning-gemma",
        }));

        for (const item of survivorsForGemma) {
          const analysis = await analyzeScreenshotWithGemma4({
            imageDataUrl: item.croppedImage,
            model: activeGemmaTag,
            appName: item.cap.appName,
            windowTitle: item.cap.windowTitle,
            todayDateKey: todayKey,
            existingBlocks: workingBlocks,
            rules,
            settings,
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

    if (target.isDayframeCreated && target.externalEventId && macPairingToken) {
      void deleteBlockFromMacCalendar({
        pairingToken: macPairingToken,
        eventId: target.externalEventId,
      });
    }

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
    const target = blocks.find((b) => b.id === id);
    if (target?.isDayframeCreated && target.externalEventId && macPairingToken) {
      void deleteBlockFromMacCalendar({
        pairingToken: macPairingToken,
        eventId: target.externalEventId,
      });
    }
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

  const refreshFilteredCalendarBlocks = async (
    nextReadIds: string[],
    nextWriteId: string
  ) => {
    if (!macBridgeState.paired || !macPairingToken) return;
    const scan = await scanMacCalendarEvents({
      pairingToken: macPairingToken,
      daysAhead: 28,
      allowedReadCalendarIds: nextReadIds,
    });
    if (!scan.ok) return;
    setMacCalendars(scan.calendars);
    const localUnsynced = blocks.filter(
      (b) => b.isDayframeCreated && !b.syncedToExternalCalendar
    );
    const mapped = scan.blocks.map((block) => ({
      ...block,
      occupiesTimeOnly: Boolean(
        nextWriteId &&
          block.calendarId &&
          block.calendarId !== nextWriteId &&
          !block.isDayframeCreated
      ),
    }));
    setBlocks(
      [...mapped, ...localUnsynced].sort(
        (a, b) =>
          a.dateKey.localeCompare(b.dateKey) ||
          a.startMinutes - b.startMinutes
      )
    );
  };

  const handlePickWriteCalendar = (calendarId: string) => {
    const found = macCalendars.find((c) => c.id === calendarId);
    if (!found) return;
    writeCalendarRef.current = found.id;
    const nextReads = settings.readCalendarIds.includes(found.id)
      ? settings.readCalendarIds
      : [found.id, ...settings.readCalendarIds];
    setSettings((prev) => ({
      ...prev,
      writableCalendarId: found.id,
      writableCalendarTitle: found.title,
      writableCalendarSource: found.sourceTitle,
      pinnedWriteCalendar: true,
      readCalendarIds: nextReads,
      readCalendarScopeInitialized: true,
    }));
    void refreshFilteredCalendarBlocks(nextReads, found.id);
    showToast(`Pinned write target to ${describeCalendar(found)}`);
  };

  const handleToggleReadCalendar = (calendarId: string, checked: boolean) => {
    const set = new Set(settings.readCalendarIds);
    if (checked) set.add(calendarId);
    else set.delete(calendarId);
    if (settings.writableCalendarId) set.add(settings.writableCalendarId);
    const nextReads = Array.from(set);
    setSettings((prev) => ({
      ...prev,
      readCalendarIds: nextReads,
      readCalendarScopeInitialized: true,
    }));
    void refreshFilteredCalendarBlocks(nextReads, settings.writableCalendarId);
  };

  const handleSelectOnlyUmichReadCalendar = () => {
    const onlyId = settings.writableCalendarId;
    if (!onlyId) return;
    const nextReads = [onlyId];
    setSettings((prev) => ({
      ...prev,
      readCalendarIds: nextReads,
      readCalendarScopeInitialized: true,
    }));
    void refreshFilteredCalendarBlocks(nextReads, onlyId);
    showToast(`Reading & writing exclusively on ${settings.writableCalendarTitle}`);
  };

  const handleAddTaskToCalendar = async (task: {
    title: string;
    gutMinutes: number;
    applyMultiplier: boolean;
    deadlineDateKey?: string;
    useGemmaBreakdown?: boolean;
  }) => {
    if (!writeCalendarRef.current) {
      setScopeDialogOpen(true);
      showToast("Choose your personal UMich calendar first. Nothing was written.");
      return;
    }

    const parsed = parseNaturalTaskInput({
      rawText: task.title,
      fallbackGutMinutes: task.gutMinutes,
      explicitDeadlineDateKey: task.deadlineDateKey,
      todayKey,
    });

    // Automatically search local Mail & local PDFs for matching context on creation!
    const [matchedEmails, matchedPapers] =
      macBridgeState.paired && macPairingToken
        ? await Promise.all([
            searchMacMailByQuery({
              pairingToken: macPairingToken,
              query: parsed.canonicalTitle,
              limit: 4,
            }),
            searchLocalMacPapers({
              pairingToken: macPairingToken,
              query: parsed.canonicalTitle,
            }),
          ])
        : [[], []];

    const cadenceNote =
      parsed.mode === "weekly-cadence" && parsed.weeklyCadence
        ? `${formatDuration(parsed.weeklyCadence.minutesPerWeek)}/week × ${
            parsed.weeklyCadence.weeksCount
          } weeks`
        : parsed.deadlineDateKey
          ? `Deadline ${parsed.deadlineDateKey}`
          : undefined;

    const upserted = upsertTaskModelFromSchedule({
      graph: userGraph,
      canonicalTitle: parsed.canonicalTitle,
      cadenceNote,
      deadlineDateKey: parsed.deadlineDateKey,
      typicalSessionMinutes:
        parsed.mode === "weekly-cadence"
          ? 60
          : Math.min(90, parsed.gutMinutes ?? task.gutMinutes),
      matchedEmails,
      matchedPapers,
    });
    setUserGraph(upserted.graph);

    const autoNotes =
      matchedEmails.length > 0
        ? `Related Mail: "${matchedEmails[0].subject}" (${matchedEmails[0].sender})\n${matchedEmails[0].snippet.slice(0, 260)}`
        : undefined;

    let planBlocks = blocks;
    let createdBlocks: CalendarBlock[] = [];
    let planNote = "";

    if (parsed.mode === "weekly-cadence" && parsed.weeklyCadence) {
      const wkPlan = scheduleWeeklyCadenceOntoCalendar({
        canonicalTitle: upserted.taskModel.canonicalTitle,
        minutesPerWeek: parsed.weeklyCadence.minutesPerWeek,
        weeksCount: parsed.weeklyCadence.weeksCount,
        taskModelId: upserted.taskModel.id,
        notes: autoNotes,
        blocks,
        rules,
        settings: {
          ...settings,
          writableCalendarId: writeCalendarRef.current,
        },
        todayKey,
      });
      planBlocks = wkPlan.blocks;
      createdBlocks = wkPlan.created;
      planNote = wkPlan.note;
      setScarcityWarning(null);
    } else {
      const effectiveGut =
        parsed.mode === "explicit-block-count" && parsed.explicitBlocks
          ? parsed.explicitBlocks.count *
            parsed.explicitBlocks.durationMinutesEach
          : (parsed.gutMinutes ?? task.gutMinutes);
      const shouldApplyMult =
        task.applyMultiplier && !parsed.hasExplicitDuration;

      let milestoneLabels: string[] | undefined;
      if (task.useGemmaBreakdown) {
        setDecomposingWithAi(true);
        try {
          const mult = shouldApplyMult ? settings.calibrationMultiplier : 1;
          const estTotal = Math.max(
            15,
            Math.round((effectiveGut * mult) / 15) * 15
          );
          const segCount =
            estTotal <= 90
              ? 1
              : estTotal >= 180
                ? 1 + Math.ceil((estTotal - 45) / 90)
                : Math.ceil(estTotal / 75);

          if (macBridgeState.paired && macPairingToken) {
            await wakeOllamaViaMacDaemon(macPairingToken);
          }
          const gStat = await probeLocalGemma(settings.gemmaModel);
          if (gStat.reachable) {
            const tag = resolveInstalledGemmaTag(settings.gemmaModel, gStat);
            const breakdown = await decomposeGoalWithGemma4({
              model: tag,
              goalTitle: upserted.taskModel.canonicalTitle,
              segmentCount: segCount,
              deadlineDateKey: parsed.deadlineDateKey,
            });
            if (breakdown.ok) {
              milestoneLabels = breakdown.milestones;
            }
          }
        } finally {
          if (settings.unloadModelsAfterBatch) {
            await sleepAllModelsViaMacDaemon({
              pairingToken: macPairingToken,
              gemmaModel: settings.gemmaModel,
            });
            await unloadGemmaModelImmediately(settings.gemmaModel);
          }
          setDecomposingWithAi(false);
        }
      }

      const plan = scheduleTaskOntoCalendar({
        title: upserted.taskModel.canonicalTitle,
        gutMinutes: effectiveGut,
        applyMultiplier: shouldApplyMult,
        deadlineDateKey: parsed.deadlineDateKey,
        milestoneLabels,
        blocks,
        rules,
        settings: {
          ...settings,
          writableCalendarId: writeCalendarRef.current,
        },
        todayKey,
      });

      setScarcityWarning(plan.scarcityWarning ?? null);
      planBlocks = plan.blocks;
      createdBlocks = plan.created;
      planNote = plan.note;
    }

    if (createdBlocks.length === 0) {
      showToast(planNote);
      return;
    }

    // Attach Task Model ID, auto-matched papers, and email context onto created blocks before writing to Calendar.app
    const enrichedCreated = createdBlocks.map((b) => ({
      ...b,
      taskModelId: upserted.taskModel.id,
      notes: b.notes || autoNotes,
      subtasks:
        upserted.taskModel.immediateTodos.length > 0
          ? upserted.taskModel.immediateTodos
          : undefined,
      relevantPapers:
        upserted.taskModel.relevantPapers.length > 0
          ? upserted.taskModel.relevantPapers.slice(0, 4)
          : undefined,
    }));

    const written: CalendarBlock[] = [];
    for (const block of enrichedCreated) {
      written.push(await pushBlockToExternalCalendar(block));
    }
    setBlocks(planBlocks.map((b) => written.find((w) => w.id === b.id) ?? b));
    showToast(planNote);
  };

  // Syncs updated block details (notes, checklist, papers, title, alarms) back to macOS Calendar.app
  const persistBlockUpdateToCalendar = async (
    updated: CalendarBlock,
    alarmMinutesBefore?: number
  ) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === updated.id ? updated : b))
    );
    if (
      updated.syncedToExternalCalendar &&
      updated.externalEventId &&
      macBridgeState.paired &&
      macPairingToken
    ) {
      await updateBlockOnMacCalendar({
        pairingToken: macPairingToken,
        eventId: updated.externalEventId,
        block: updated,
        alarmMinutesBefore,
      });
    }
  };

  const handlePullEventContextAndPapers = async (
    blockId: string,
    customQuestion?: string
  ) => {
    const target = blocks.find((b) => b.id === blockId);
    if (!target) return;

    setIsEnrichingEvent(true);
    try {
      const keywords = extractDistinctiveKeywords(target.title);
      const searchQuery =
        keywords.join(" ") || target.title.slice(0, 50);

      const [matchedEmails, localPapers] =
        macBridgeState.paired && macPairingToken
          ? await Promise.all([
              searchMacMailByQuery({
                pairingToken: macPairingToken,
                query: searchQuery,
                limit: 5,
              }),
              searchLocalMacPapers({
                pairingToken: macPairingToken,
                query: searchQuery,
              }),
            ])
          : [[], []];

      const matchedCaps = matchCapturesForKeywords(keywords, captures).map(
        (c) => ({
          app: c.appName,
          title: c.windowTitle,
          summary: c.summaryText,
        })
      );

      if (macBridgeState.paired && macPairingToken) {
        await wakeOllamaViaMacDaemon(macPairingToken);
      }
      const gStat = await probeLocalGemma(settings.gemmaModel);

      let replyText = "";
      let digest = "";
      let newTodoStrings: string[] = [];
      let aiPapers: Array<{ title: string; authorsOrVenue?: string }> = [];

      if (gStat.reachable) {
        const tag = resolveInstalledGemmaTag(settings.gemmaModel, gStat);
        const enriched = await chatAndEnrichEventWithGemma4({
          model: tag,
          event: target,
          userPrompt:
            customQuestion ||
            "Read all matched emails, Slack/screen context, and local PDFs. Summarize what matters for this event, list immediate concrete action items, and note relevant papers.",
          matchedEmails,
          matchedCaptures: matchedCaps,
          localPapers,
          userGraph,
        });
        if (enriched.ok) {
          replyText = enriched.reply;
          digest = enriched.contextDigest || "";
          newTodoStrings = enriched.immediateTodos;
          aiPapers = enriched.suggestedPapers;
        } else {
          replyText = enriched.reply;
        }
      } else {
        replyText = `Found ${matchedEmails.length} matching email(s), ${matchedCaps.length} screen/Slack frame(s), and ${localPapers.length} local PDF(s). (Install/start local Ollama to run Gemma 4 synthesis.)`;
      }

      const existingTodos = target.subtasks ?? [];
      const existingTodoTexts = new Set(
        existingTodos.map((t) => t.text.toLowerCase())
      );
      const addedTodos: EventSubtask[] = newTodoStrings
        .filter((t) => !existingTodoTexts.has(t.toLowerCase()))
        .map((t, idx) => ({
          id: `sub-${Date.now()}-${idx}`,
          text: t,
          done: false,
          source: "Gemma 4 Context",
        }));

      const existingPapers = target.relevantPapers ?? [];
      const existingPaperTitles = new Set(
        existingPapers.map((p) => p.title.toLowerCase())
      );
      const localPaperRefs: RelevantPaperRef[] = localPapers
        .filter((p) => !existingPaperTitles.has(p.title.toLowerCase()))
        .map((p, idx) => ({
          id: `lp-${Date.now()}-${idx}`,
          title: p.title,
          pathOrUrl: p.path,
          source: "local-pdf",
        }));
      const aiPaperRefs: RelevantPaperRef[] = aiPapers
        .filter(
          (p) =>
            !existingPaperTitles.has(p.title.toLowerCase()) &&
            !localPaperRefs.some(
              (lp) => lp.title.toLowerCase() === p.title.toLowerCase()
            )
        )
        .map((p, idx) => ({
          id: `ap-${Date.now()}-${idx}`,
          title: p.title,
          authorsOrVenue: p.authorsOrVenue,
          source: "mail-or-slack",
        }));

      const emailBrief =
        matchedEmails.length > 0
          ? matchedEmails
              .slice(0, 2)
              .map((m) => `• Mail (${m.subject}): ${m.snippet.slice(0, 180)}`)
              .join("\n")
          : "";
      const combinedNotes = [target.notes, digest, emailBrief]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 2400);

      const chatAddition: EventChatMessage[] = [
        ...(customQuestion
          ? [
              {
                id: `ec-u-${Date.now()}`,
                role: "user" as const,
                text: customQuestion,
                timestampIso: new Date().toISOString(),
              },
            ]
          : []),
        {
          id: `ec-a-${Date.now() + 1}`,
          role: "assistant" as const,
          text: replyText,
          timestampIso: new Date().toISOString(),
          actionBadge: `Linked ${matchedEmails.length} mail · ${
            localPaperRefs.length + aiPaperRefs.length
          } papers · ${addedTodos.length} todos`,
        },
      ];

      const updatedBlock: CalendarBlock = {
        ...target,
        notes: combinedNotes || target.notes,
        subtasks: [...existingTodos, ...addedTodos],
        relevantPapers: [...existingPapers, ...localPaperRefs, ...aiPaperRefs],
        eventChat: [...(target.eventChat ?? []), ...chatAddition],
      };

      await persistBlockUpdateToCalendar(updatedBlock);

      // Also enrich matching Task-Specific Model
      const up = upsertTaskModelFromSchedule({
        graph: userGraph,
        canonicalTitle: target.title,
        typicalSessionMinutes: target.durationMinutes,
        matchedEmails,
        matchedPapers: localPapers,
      });
      setUserGraph({
        ...up.graph,
        taskModels: up.graph.taskModels.map((m) =>
          m.id === up.taskModel.id
            ? {
                ...m,
                summary: digest || m.summary,
                immediateTodos: [
                  ...m.immediateTodos,
                  ...addedTodos.filter(
                    (td) =>
                      !m.immediateTodos.some(
                        (x) => x.text.toLowerCase() === td.text.toLowerCase()
                      )
                  ),
                ],
              }
            : m
        ),
      });
    } finally {
      if (settings.unloadModelsAfterBatch) {
        await sleepAllModelsViaMacDaemon({
          pairingToken: macPairingToken,
          gemmaModel: settings.gemmaModel,
        });
        await unloadGemmaModelImmediately(settings.gemmaModel);
      }
      setIsEnrichingEvent(false);
    }
  };

  const handleSendEventChat = async (blockId: string, text: string) => {
    const target = blocks.find((b) => b.id === blockId);
    if (!target) return;

    const intent = parseEventChatCommand(text);
    const appendChatPair = async (
      base: CalendarBlock,
      reply: string,
      actionBadge?: string,
      alarmMins?: number
    ) => {
      const next: CalendarBlock = {
        ...base,
        eventChat: [
          ...(base.eventChat ?? []),
          {
            id: `ec-u-${Date.now()}`,
            role: "user",
            text,
            timestampIso: new Date().toISOString(),
          },
          {
            id: `ec-a-${Date.now() + 1}`,
            role: "assistant",
            text: reply,
            timestampIso: new Date().toISOString(),
            actionBadge,
          },
        ],
      };
      await persistBlockUpdateToCalendar(next, alarmMins);
    };

    if (intent.kind === "schedule-blocks-for-event") {
      if (!writeCalendarRef.current) {
        setScopeDialogOpen(true);
        showToast("Choose your personal UMich calendar first.");
        return;
      }
      const res = scheduleBlocksForTargetEvent({
        targetEvent: target,
        count: intent.count,
        durationMinutesEach: intent.durationMinutesEach,
        beforeEventTime: intent.beforeEventTime,
        blocks,
        rules,
        settings: {
          ...settings,
          writableCalendarId: writeCalendarRef.current,
        },
        todayKey,
      });

      const written: CalendarBlock[] = [];
      for (const blk of res.created) {
        written.push(await pushBlockToExternalCalendar(blk));
      }

      const nextChat: EventChatMessage[] = [
        ...(target.eventChat ?? []),
        {
          id: `ec-u-${Date.now()}`,
          role: "user",
          text,
          timestampIso: new Date().toISOString(),
        },
        {
          id: `ec-a-${Date.now() + 1}`,
          role: "assistant",
          text: res.note,
          timestampIso: new Date().toISOString(),
          actionBadge:
            written.length > 0
              ? `Scheduled ${written.length} block(s)`
              : undefined,
        },
      ];

      setBlocks(
        res.blocks.map((b) => {
          const w = written.find((x) => x.id === b.id);
          if (w) return w;
          if (b.id === target.id) return { ...b, eventChat: nextChat };
          return b;
        })
      );
      showToast(res.note);
      return;
    }

    if (intent.kind === "pull-context-and-papers") {
      await handlePullEventContextAndPapers(blockId, text);
      return;
    }

    if (intent.kind === "add-subtask") {
      const sub: EventSubtask = {
        id: `sub-${Date.now()}`,
        text: intent.todoText,
        done: false,
      };
      await appendChatPair(
        { ...target, subtasks: [...(target.subtasks ?? []), sub] },
        `Added "${intent.todoText}" to this block's checklist and synced to Calendar.app.`,
        "Todo added"
      );
      return;
    }

    if (intent.kind === "add-reminder") {
      const lead = intent.leadMinutes ?? 30;
      const rem = {
        id: `rem-${Date.now()}`,
        text: intent.reminderText,
        leadMinutes: lead,
      };
      await appendChatPair(
        { ...target, reminders: [...(target.reminders ?? []), rem] },
        `Set reminder ${lead}m before: "${intent.reminderText}".`,
        `Alert ${lead}m before`,
        lead
      );
      return;
    }

    if (intent.kind === "add-paper") {
      const paper: RelevantPaperRef = {
        id: `pap-${Date.now()}`,
        title: intent.paperTitle,
        pathOrUrl: intent.url,
        source: "manual",
      };
      await appendChatPair(
        {
          ...target,
          relevantPapers: [...(target.relevantPapers ?? []), paper],
        },
        `Attached paper "${intent.paperTitle}" to this event.`,
        "Paper attached"
      );
      return;
    }

    if (intent.kind === "rename-event") {
      await appendChatPair(
        { ...target, title: intent.newTitle, userEditedTitle: true },
        `Renamed event to "${intent.newTitle}".`,
        "Renamed"
      );
      return;
    }

    if (intent.kind === "resize-event") {
      await appendChatPair(
        { ...target, durationMinutes: intent.durationMinutes },
        `Resized block to ${formatDuration(intent.durationMinutes)}.`,
        `Resized → ${formatDuration(intent.durationMinutes)}`
      );
      return;
    }

    if (intent.kind === "move-event-days") {
      handleShiftBlockDate(blockId, intent.deltaDays);
      return;
    }

    // Default: full Gemma 4 contextual co-pilot question
    await handlePullEventContextAndPapers(blockId, intent.prompt);
  };

  const handleInduceModelsNow = async () => {
    setIsInducingModels(true);
    try {
      if (macBridgeState.paired && macPairingToken) {
        await wakeOllamaViaMacDaemon(macPairingToken);
      }
      const gStat = await probeLocalGemma(settings.gemmaModel);
      if (!gStat.reachable) {
        showToast("Start or install local Ollama to synthesize models.");
        return;
      }
      const tag = resolveInstalledGemmaTag(settings.gemmaModel, gStat);
      const result = await induceUserAndTaskModelsWithGemma4({
        model: tag,
        currentGraph: userGraph,
        blocks,
        captures: captures.slice(0, 15).map((c) => ({
          app: c.appName,
          title: c.windowTitle,
          summary: c.summaryText,
        })),
        emails: scannedEmails,
      });

      if (!result.ok) {
        showToast("Model synthesis did not return updates.");
        return;
      }

      setUserGraph((prev) => {
        // Preserve [user-edited] strivings verbatim; merge or append newly induced ones
        const lockedStrivings = prev.strivings.filter((s) => s.userEdited);
        const inducedStrivings = result.strivings
          .filter(
            (s) =>
              !lockedStrivings.some(
                (ls) => ls.title.toLowerCase() === s.title.toLowerCase()
              )
          )
          .map((s, idx) => ({
            id: `st-${Date.now()}-${idx}`,
            title: s.title,
            domain: s.domain,
            description: s.description,
            confidence: s.confidence,
          }));
        const nextStrivings = [...lockedStrivings, ...inducedStrivings].slice(
          0,
          6
        );

        const nextTaskModels = [...prev.taskModels];
        for (const induced of result.taskModels) {
          const matchedStriving = nextStrivings.find(
            (st) =>
              induced.parentStrivingTitle &&
              st.title
                .toLowerCase()
                .includes(induced.parentStrivingTitle.toLowerCase().slice(0, 18))
          );

          const existingIdx = nextTaskModels.findIndex(
            (m) =>
              m.canonicalTitle.toLowerCase() ===
              induced.canonicalTitle.toLowerCase()
          );

          const mappedTodos: EventSubtask[] = induced.immediateTodos.map(
            (txt, i) => ({
              id: `tm-td-${Date.now()}-${i}`,
              text: txt,
              done: false,
            })
          );

          if (existingIdx >= 0) {
            const cur = nextTaskModels[existingIdx];
            nextTaskModels[existingIdx] = {
              ...cur,
              canonicalTitle: cur.userEdited
                ? cur.canonicalTitle
                : induced.canonicalTitle,
              parentStrivingId: cur.userReassigned
                ? cur.parentStrivingId
                : (matchedStriving?.id ?? cur.parentStrivingId),
              summary: induced.summary || cur.summary,
              keywords: Array.from(
                new Set([...cur.keywords, ...induced.keywords])
              ),
              immediateTodos:
                cur.immediateTodos.length > 0 ? cur.immediateTodos : mappedTodos,
              updatedAtIso: new Date().toISOString(),
            };
          } else {
            nextTaskModels.push({
              id: `tm-ind-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
              canonicalTitle: induced.canonicalTitle,
              keywords: induced.keywords,
              parentStrivingId: matchedStriving?.id,
              summary: induced.summary,
              typicalSessionMinutes: induced.typicalSessionMinutes,
              immediateTodos: mappedTodos,
              relevantPapers: [],
              evidence: [],
              updatedAtIso: new Date().toISOString(),
            });
          }
        }

        return {
          ...prev,
          strivings: nextStrivings,
          taskModels: nextTaskModels,
        };
      });

      showToast(
        `Synthesized ${result.taskModels.length} Task Model(s) & ${result.strivings.length} Striving(s)`
      );
    } finally {
      if (settings.unloadModelsAfterBatch) {
        await sleepAllModelsViaMacDaemon({
          pairingToken: macPairingToken,
          gemmaModel: settings.gemmaModel,
        });
        await unloadGemmaModelImmediately(settings.gemmaModel);
      }
      setIsInducingModels(false);
    }
  };

  const handleScheduleSessionForTaskModel = async (taskModelId: string) => {
    const tm = userGraph.taskModels.find((m) => m.id === taskModelId);
    if (!tm) return;
    await handleAddTaskToCalendar({
      title: tm.canonicalTitle,
      gutMinutes: tm.typicalSessionMinutes,
      applyMultiplier: false,
      deadlineDateKey: tm.deadlineDateKey,
    });
  };

  const handleToggleBlockDone = async (
    id: string,
    actualMinutesOverride?: number
  ) => {
    const target = blocks.find((b) => b.id === id);
    if (!target) return;

    const nextDone = !target.done;
    const actualMins = actualMinutesOverride ?? target.durationMinutes;

    if (nextDone) {
      const sample: CalibrationSample = {
        id: `cal-${Date.now()}`,
        title: target.title,
        gutMinutes: target.gutMinutes ?? target.durationMinutes,
        scheduledMinutes: target.durationMinutes,
        actualMinutes: actualMins,
        completedAtIso: new Date().toISOString(),
      };
      setCalibrationSamples((prev) => [sample, ...prev.slice(0, 49)]);
    }

    let updatedBlock: CalendarBlock = {
      ...target,
      done: nextDone,
      completedAtIso: nextDone ? new Date().toISOString() : undefined,
      actualMinutesTaken: nextDone ? actualMins : undefined,
    };

    if (
      target.syncedToExternalCalendar &&
      target.externalEventId &&
      macBridgeState.paired &&
      macPairingToken &&
      writeCalendarRef.current
    ) {
      await deleteBlockFromMacCalendar({
        pairingToken: macPairingToken,
        eventId: target.externalEventId,
      });
      const rewritten = await writeBlockToMacCalendar({
        pairingToken: macPairingToken,
        block: updatedBlock,
        calendarId: writeCalendarRef.current,
      });
      if (rewritten.ok) {
        updatedBlock = {
          ...updatedBlock,
          externalEventId: rewritten.externalEventId,
          syncedToExternalCalendar: true,
        };
      }
    }

    setBlocks((prev) => prev.map((b) => (b.id === id ? updatedBlock : b)));
    showToast(
      nextDone
        ? `Done: "${target.title}" (logged ${formatDuration(actualMins)} for calibration)`
        : `Reopened "${target.title}"`
    );
  };

  const handleReplanOverdue = async () => {
    const plan = takeOverdueWorkForward({
      blocks,
      rules,
      settings: {
        ...settings,
        writableCalendarId: writeCalendarRef.current,
      },
      todayKey,
    });
    if (plan.moved.length === 0) {
      showToast("Clean slate — 0 unfinished blocks need moving.");
      return;
    }
    for (const old of blocks) {
      if (plan.removedIds.includes(old.id) && old.externalEventId && macPairingToken) {
        await deleteBlockFromMacCalendar({
          pairingToken: macPairingToken,
          eventId: old.externalEventId,
        });
      }
    }
    const written: CalendarBlock[] = [];
    for (const block of plan.moved) {
      written.push(await pushBlockToExternalCalendar(block));
    }
    setBlocks(plan.blocks.map((b) => written.find((w) => w.id === b.id) || b));
    showToast(
      `Re-planned ${written.length} unfinished block${
        written.length === 1 ? "" : "s"
      } into upcoming open space.`
    );
  };

  const handlePullFutureTaskIntoToday = async () => {
    const res = pullNextFutureTaskIntoToday({
      blocks,
      rules,
      settings: {
        ...settings,
        writableCalendarId: writeCalendarRef.current,
      },
      todayKey,
    });
    if (!res.pulled) {
      showToast("No open slot left today (or no upcoming tasks to pull forward).");
      return;
    }
    if (res.oldExternalEventId && macPairingToken) {
      await deleteBlockFromMacCalendar({
        pairingToken: macPairingToken,
        eventId: res.oldExternalEventId,
      });
    }
    const synced = await pushBlockToExternalCalendar(res.pulled);
    setBlocks(res.blocks.map((b) => (b.id === synced.id ? synced : b)));
    showToast(
      `Pulled "${synced.title}" into today at ${formatMinutesToTime(
        synced.startMinutes
      )}!`
    );
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

  const nowDt = new Date();
  const nowMinutesOfDay = nowDt.getHours() * 60 + nowDt.getMinutes();
  const overdueCount = blocks.filter((b) => {
    if (!b.isDayframeCreated || b.done || b.occupiesTimeOnly) return false;
    if (b.kind === "meeting" && !b.isSoloHold) return false;
    if (b.dateKey < todayKey) return true;
    if (
      b.dateKey === todayKey &&
      b.startMinutes + b.durationMinutes <= nowMinutesOfDay
    ) {
      return true;
    }
    return false;
  }).length;

  const futurePullableCount = blocks.filter(
    (b) =>
      b.isDayframeCreated &&
      !b.done &&
      !b.occupiesTimeOnly &&
      b.dateKey > todayKey &&
      (b.kind === "deep-work" || b.kind === "follow-up")
  ).length;

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
                `Synced ${res.existingCount} events from selected calendar(s)`
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
        onOpenCalendarScope={() => setScopeDialogOpen(true)}
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
          <TaskComposer
            settings={settings}
            onUpdateSettings={(patch) =>
              setSettings((prev) => ({ ...prev, ...patch }))
            }
            calendars={macCalendars}
            onSelectWriteCalendar={handlePickWriteCalendar}
            onToggleReadCalendar={handleToggleReadCalendar}
            onSelectOnlyUmichReadCalendar={handleSelectOnlyUmichReadCalendar}
            onRefreshCalendars={() => void verifyAndLoadMacBridge()}
            calibrationSamples={calibrationSamples}
            busy={isSyncingCalendar}
            decomposingWithAi={decomposingWithAi}
            overdueCount={overdueCount}
            futurePullableCount={futurePullableCount}
            scarcityWarning={scarcityWarning}
            onDismissScarcityWarning={() => setScarcityWarning(null)}
            scopeDialogOpen={scopeDialogOpen}
            onScopeDialogOpenChange={setScopeDialogOpen}
            onAddTask={(task) => void handleAddTaskToCalendar(task)}
            onReplanOverdue={() => void handleReplanOverdue()}
            onPullFutureTaskIntoToday={() =>
              void handlePullFutureTaskIntoToday()
            }
          />

          {proposedBlocks.length > 0 && (
            <PendingConfirmationsDeck
              todayKey={todayKey}
              proposedBlocks={proposedBlocks}
              allBlocks={blocks}
              captures={captures}
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
          )}

          <CalendarTimeline
            todayKey={todayKey}
            anchorDateKey={anchorDateKey}
            onChangeAnchorDateKey={setAnchorDateKey}
            horizonDays={settings.timelineHorizonDays ?? 7}
            onChangeHorizonDays={(days) =>
              setSettings((prev) => ({ ...prev, timelineHorizonDays: days }))
            }
            blocks={blocks}
            rules={rules}
            settings={settings}
            onSelectBlockId={setSelectedBlockId}
            onConfirmAndSyncAllAutoBlocks={() =>
              void handleConfirmAndSyncAllAutoBlocks()
            }
            onToggleBlockDone={(id, actual) =>
              void handleToggleBlockDone(id, actual)
            }
            onRunCalendarScanNow={() => {
              void runBaselineCalendarAndMailScan().then((r) => {
                if (!r.ok && r.error) showToast(r.error);
              });
            }}
            onOpenCalendarScope={() => setScopeDialogOpen(true)}
          />
        </div>

        <div className="order-3 lg:col-span-3">
          <OrganizerFeedbackPanel
            userGraph={userGraph}
            blocks={blocks}
            isInducingModels={isInducingModels}
            onInduceModelsNow={() => void handleInduceModelsNow()}
            onUpdateUserProfile={(patch) =>
              setUserGraph((prev) => ({
                ...prev,
                profile: { ...prev.profile, ...patch },
              }))
            }
            onRenameStriving={(id, newTitle) =>
              setUserGraph((prev) =>
                renameStrivingWithConstraint(prev, id, newTitle)
              )
            }
            onRenameTaskModel={(id, newTitle) =>
              setUserGraph((prev) =>
                renameTaskModelWithConstraint(prev, id, newTitle)
              )
            }
            onMergeTaskModels={(keepId, absorbId) =>
              setUserGraph((prev) =>
                mergeTaskModelsWithConstraint(prev, keepId, absorbId)
              )
            }
            onReassignTaskModel={(tmId, stId) =>
              setUserGraph((prev) =>
                reassignTaskModelStriving(prev, tmId, stId)
              )
            }
            onRemoveModelNode={(kind, id) =>
              setUserGraph((prev) =>
                removeModelEntityWithConstraint(prev, kind, id)
              )
            }
            onScheduleSessionForTaskModel={(tmId) =>
              void handleScheduleSessionForTaskModel(tmId)
            }
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

      {(() => {
        const activeBlock =
          blocks.find((b) => b.id === selectedBlockId) ?? null;
        const activeCapture = activeBlock?.sourceCaptureId
          ? (captures.find((c) => c.id === activeBlock.sourceCaptureId) ?? null)
          : null;
        const activeTm = activeBlock
          ? (userGraph.taskModels.find(
              (m) => m.id === activeBlock.taskModelId
            ) ?? findMatchingTaskModel(activeBlock.title, userGraph.taskModels))
          : undefined;

        return (
          <EventWorkspaceDialog
            todayKey={todayKey}
            block={activeBlock}
            linkedTaskModel={activeTm}
            linkedCapture={activeCapture}
            isBusyEnriching={isEnrichingEvent}
            onClose={() => setSelectedBlockId(null)}
            onSendEventChat={handleSendEventChat}
            onPullContextAndPapers={(id) =>
              handlePullEventContextAndPapers(id)
            }
            onRenameEvent={(id, newTitle) => {
              const found = blocks.find((b) => b.id === id);
              if (!found) return;
              void persistBlockUpdateToCalendar({
                ...found,
                title: newTitle,
                userEditedTitle: true,
              });
            }}
            onSaveEventNotes={(id, nextNotes) => {
              const found = blocks.find((b) => b.id === id);
              if (!found) return;
              void persistBlockUpdateToCalendar({ ...found, notes: nextNotes });
              showToast("Saved notes & synced to Calendar.app");
            }}
            onToggleSubtask={(id, subId) => {
              const found = blocks.find((b) => b.id === id);
              if (!found) return;
              const nextSubs = (found.subtasks ?? []).map((s) =>
                s.id === subId ? { ...s, done: !s.done } : s
              );
              void persistBlockUpdateToCalendar({
                ...found,
                subtasks: nextSubs,
              });
            }}
            onAddSubtask={(id, text) => {
              const found = blocks.find((b) => b.id === id);
              if (!found) return;
              const nextSubs = [
                ...(found.subtasks ?? []),
                { id: `sub-${Date.now()}`, text, done: false },
              ];
              void persistBlockUpdateToCalendar({
                ...found,
                subtasks: nextSubs,
              });
            }}
            onRemoveSubtask={(id, subId) => {
              const found = blocks.find((b) => b.id === id);
              if (!found) return;
              const nextSubs = (found.subtasks ?? []).filter(
                (s) => s.id !== subId
              );
              void persistBlockUpdateToCalendar({
                ...found,
                subtasks: nextSubs,
              });
            }}
            onAddPaper={(id, title, pathOrUrl) => {
              const found = blocks.find((b) => b.id === id);
              if (!found) return;
              const nextPapers: RelevantPaperRef[] = [
                ...(found.relevantPapers ?? []),
                {
                  id: `pap-${Date.now()}`,
                  title,
                  pathOrUrl,
                  source: "manual",
                },
              ];
              void persistBlockUpdateToCalendar({
                ...found,
                relevantPapers: nextPapers,
              });
            }}
            onRemovePaper={(id, paperId) => {
              const found = blocks.find((b) => b.id === id);
              if (!found) return;
              const nextPapers = (found.relevantPapers ?? []).filter(
                (p) => p.id !== paperId
              );
              void persistBlockUpdateToCalendar({
                ...found,
                relevantPapers: nextPapers,
              });
            }}
            onOpenLocalPaper={(pathOrUrl) => {
              void openLocalMacFile({
                pairingToken: macPairingToken,
                path: pathOrUrl,
              });
            }}
            onAddReminder={(id, text, leadMinutes) => {
              const found = blocks.find((b) => b.id === id);
              if (!found) return;
              const nextRems = [
                ...(found.reminders ?? []),
                { id: `rem-${Date.now()}`, text, leadMinutes },
              ];
              void persistBlockUpdateToCalendar(
                { ...found, reminders: nextRems },
                leadMinutes
              );
              showToast(`Added ${leadMinutes}m alert on Calendar.app`);
            }}
            onToggleBlockDone={(id, actual) =>
              void handleToggleBlockDone(id, actual)
            }
            onAdjustBlockDuration={handleAdjustBlockDuration}
            onConfirmAndSyncBlock={(id) =>
              void handleApproveProposedBlock(id, false)
            }
            onMoveBlockToNextSlot={handleMoveBlockToNextSlot}
            onShiftBlockDate={handleShiftBlockDate}
            onDeleteBlock={(id) => handleSkipProposedBlock(id, false)}
          />
        );
      })()}

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
