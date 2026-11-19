"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { KickstartWizard } from "./kickstart-wizard";
import { TopMenubar } from "./top-menubar";
import { CaptureStreamPanel } from "./capture-stream-panel";
import { CalendarTimeline } from "./calendar-timeline";
import { OrganizerFeedbackPanel } from "./organizer-feedback-panel";
import { NightlyAndroidSheet } from "./nightly-android-sheet";
import { useScreenCapture } from "@/hooks/use-screen-capture";
import {
  CalendarBlock,
  DiscussionMessage,
  MacCalendarDescriptor,
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
} from "@/lib/gemma-client";
import {
  fetchMacAndroidFolderQueue,
  MacBridgeConnectionState,
  probeMacBridge,
  scanGoogleCalendarAndGmail,
  scanMacCalendarEvents,
  scanMacMailMessages,
  toLocalDateKey,
  writeBlockToGoogleCalendar,
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
      text: "Tell me any recurring meeting prep rules, duration adjustments, or workday boundaries — I keep them in your Standing Rules context for every Gemma 4 scan.",
      timestampIso: "",
    },
  ]);
  const [suggestedPrompts, setSuggestedPrompts] = useState<
    SuggestedPreferencePrompt[]
  >(DEFAULT_SUGGESTED_QUESTIONS);
  const [pipelineLogs, setPipelineLogs] = useState<PipelineLogEntry[]>([]);

  const [macPairingToken, setMacPairingToken] = useState("");
  const [googleAccessToken, setGoogleAccessToken] = useState("");
  const [macCalendars, setMacCalendars] = useState<MacCalendarDescriptor[]>([]);
  const [scannedEmails, setScannedEmails] = useState<ScannedEmailItem[]>([]);

  const [gemmaStatus, setGemmaStatus] = useState<LocalGemmaStatus>({
    reachable: false,
    installedModels: [],
    installedGemma4Models: [],
    selectedModelInstalled: false,
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
  const [isRunningNightlyBatch, setIsRunningNightlyBatch] = useState(false);
  const [lastBatchSummary, setLastBatchSummary] = useState<string | null>(null);
  const [toastBanner, setToastBanner] = useState<string | null>(null);

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
        ...prev.slice(0, 39),
      ]);
    },
    []
  );

  // Hydrate v2 state, purge legacy v1 toy data, and support #pair=<token> from npm run mac
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (cancelled) return;
      let loadedToken = "";
      try {
        localStorage.removeItem(LEGACY_TOY_KEY);
        const raw = localStorage.getItem(STORAGE_KEY_V2);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceV2>;
          if (parsed.settings) setSettings(parsed.settings);
          if (parsed.blocks) setBlocks(parsed.blocks);
          if (parsed.captures) setCaptures(parsed.captures);
          if (parsed.rules) setRules(parsed.rules);
          if (parsed.messages) setMessages(parsed.messages);
          if (parsed.suggestedPrompts)
            setSuggestedPrompts(parsed.suggestedPrompts);
          if (parsed.macPairingToken) {
            loadedToken = parsed.macPairingToken;
            setMacPairingToken(parsed.macPairingToken);
          }
        }
      } catch {
        // Ignore storage errors
      }

      if (typeof window !== "undefined" && window.location.hash.startsWith("#pair=")) {
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

      const [gStat, mStat] = await Promise.all([
        probeLocalGemma(DEFAULT_ORGANIZER_SETTINGS.gemmaModel),
        probeMacBridge(loadedToken),
      ]);
      if (cancelled) return;
      setGemmaStatus(gStat);
      setMacBridgeState(mStat);
      if (mStat.paired) {
        setSettings((prev) => ({
          ...prev,
          calendarSource: "macos-bridge",
          captureEngine: "macos-native",
        }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Persist user's real state locally (never storing OAuth access tokens in plain storage)
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
        macPairingToken,
      };
      localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(payload));
    } catch {
      // Ignore quota exceeded
    }
  }, [
    blocks,
    captures,
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
  }, [settings.gemmaModel]);

  const verifyAndLoadMacBridge = useCallback(async () => {
    const state = await probeMacBridge(macPairingToken);
    setMacBridgeState(state);
    if (state.paired) {
      setSettings((prev) => ({
        ...prev,
        calendarSource: "macos-bridge",
        captureEngine: "macos-native",
      }));
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
          `Paired with macOS Calendar (${scan.calendars.length} calendars available)`
        );
      }
    } else if (state.error) {
      showToast(state.error);
    }
  }, [macPairingToken, settings.writableCalendarId, showToast]);

  // Write a single block to the connected real calendar (macOS EventKit or Google Calendar API)
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
            title: `Wrote "${block.title}" to macOS Calendar`,
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
      } else if (
        settings.calendarSource === "google-api" &&
        googleAccessToken.trim()
      ) {
        const res = await writeBlockToGoogleCalendar({
          googleAccessToken,
          block,
        });
        if (res.ok) {
          appendLog({
            stage: "calendar-write",
            title: `Wrote "${block.title}" to Google Calendar`,
            detail: `${block.dateKey} at ${formatMinutesToTime(
              block.startMinutes
            )}`,
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
      googleAccessToken,
      macBridgeState.paired,
      macPairingToken,
      settings.calendarSource,
      settings.writableCalendarId,
    ]
  );

  // One-Off Initial Baseline Scan (or Re-Scan from Workspace)
  const runBaselineCalendarAndMailScan = useCallback(async (): Promise<{
    ok: boolean;
    existingCount: number;
    emailCount: number;
    proposedCount: number;
    error?: string;
  }> => {
    setIsSyncingCalendar(true);
    try {
      let fetchedCalendarBlocks: CalendarBlock[] = [];
      let fetchedEmails: ScannedEmailItem[] = [];

      if (
        settings.calendarSource === "google-api" &&
        googleAccessToken.trim()
      ) {
        const gRes = await scanGoogleCalendarAndGmail({
          googleAccessToken,
          daysAhead: 7,
        });
        if (!gRes.ok) {
          setIsSyncingCalendar(false);
          return {
            ok: false,
            existingCount: 0,
            emailCount: 0,
            proposedCount: 0,
            error: gRes.error,
          };
        }
        fetchedCalendarBlocks = gRes.blocks;
        fetchedEmails = gRes.emails;
      } else {
        const bridge = await probeMacBridge(macPairingToken);
        setMacBridgeState(bridge);
        if (!bridge.paired) {
          setIsSyncingCalendar(false);
          return {
            ok: false,
            existingCount: 0,
            emailCount: 0,
            proposedCount: 0,
            error:
              bridge.error ||
              "Mac Bridge is not paired yet. Run `npm run mac` on your MacBook or connect Google Calendar in Step 1.",
          };
        }

        const [calRes, mailRes] = await Promise.all([
          scanMacCalendarEvents({ pairingToken: macPairingToken, daysAhead: 7 }),
          scanMacMailMessages({ pairingToken: macPairingToken, limit: 10 }),
        ]);

        if (!calRes.ok) {
          setIsSyncingCalendar(false);
          return {
            ok: false,
            existingCount: 0,
            emailCount: 0,
            proposedCount: 0,
            error: calRes.error,
          };
        }

        setMacCalendars(calRes.calendars);
        fetchedCalendarBlocks = calRes.blocks;
        fetchedEmails = mailRes.messages;
      }

      setScannedEmails(fetchedEmails);
      appendLog({
        stage: "scan",
        title: "Completed Calendar & Mail Scan",
        detail: `Read ${fetchedCalendarBlocks.length} calendar events and ${fetchedEmails.length} inbox messages.`,
      });

      // 1. Reconcile recurring meeting prep blocks (e.g. >=2h before recurring meetings)
      let workingBlocks = reconcilePrepBlocks(
        fetchedCalendarBlocks,
        rules,
        settings,
        todayKey,
        "proposed"
      );

      // 2. If local Gemma 4 is online and emails were scanned, extract solo holds & focus blocks
      const gStatus = await probeLocalGemma(settings.gemmaModel);
      setGemmaStatus(gStatus);

      if (gStatus.reachable && fetchedEmails.length > 0) {
        const inboxAnalysis = await analyzeInboxEmailsWithGemma4({
          emails: fetchedEmails,
          model: settings.gemmaModel,
          todayDateKey: todayKey,
          rules,
        });
        appendLog({
          stage: "gemma4",
          title: `Gemma 4 analyzed ${fetchedEmails.length} inbox emails`,
          detail: inboxAnalysis.ok
            ? `Extracted ${inboxAnalysis.signals.length} actionable calendar blocks.`
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
            status: "proposed",
          });
          workingBlocks = placed.updatedBlocks;
        }
      }

      setBlocks(workingBlocks);
      setIsSyncingCalendar(false);

      const proposedCount = workingBlocks.filter(
        (b) => b.status !== "confirmed"
      ).length;

      return {
        ok: true,
        existingCount: fetchedCalendarBlocks.length,
        emailCount: fetchedEmails.length,
        proposedCount,
      };
    } catch (err) {
      setIsSyncingCalendar(false);
      return {
        ok: false,
        existingCount: 0,
        emailCount: 0,
        proposedCount: 0,
        error: err instanceof Error ? err.message : "Baseline scan failed.",
      };
    }
  }, [
    appendLog,
    captures,
    googleAccessToken,
    macPairingToken,
    rules,
    settings,
    todayKey,
  ]);

  // Finalize Kickstart Setup
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
    showToast("Dayframe workspace ready");
  };

  // Process incoming screenshot through local Gemma 4
  const processCapturedImage = useCallback(
    async (payload: {
      imageDataUrl: string;
      appName: string;
      windowTitle: string;
      device: "macbook" | "android";
    }) => {
      const { imageDataUrl, appName, windowTitle, device } = payload;

      const analysis = await analyzeScreenshotWithGemma4({
        imageDataUrl,
        model: settings.gemmaModel,
        appName,
        windowTitle,
        todayDateKey: todayKey,
        rules,
        device,
      });

      appendLog({
        stage: "gemma4",
        title: analysis.ok
          ? `Analyzed screenshot (${appName})`
          : `Gemma 4 unreachable for screenshot (${appName})`,
        detail: analysis.ok
          ? analysis.signal?.hasActionableItem
            ? `Scheduled: ${analysis.signal.title}`
            : "No new calendar action needed."
          : analysis.error || "Start local Ollama on 127.0.0.1:11434.",
        modelUsed: analysis.modelUsed,
        latencyMs: analysis.latencyMs,
      });

      if (!analysis.ok || !analysis.signal) {
        const offlineCap: ScreenshotCapture = {
          id: `cap-${Date.now()}`,
          timestampIso: new Date().toISOString(),
          device,
          appName,
          windowTitle,
          summaryText:
            analysis.error ||
            `Start local ${settings.gemmaModel} in Ollama to analyze screenshots.`,
          imageDataUrl,
          modelUsed: settings.gemmaModel,
          syncState: "needs-gemma",
        };
        setCaptures((prev) => [offlineCap, ...prev]);
        showToast(
          `Captured frame, but ${settings.gemmaModel} is offline on 127.0.0.1:11434`
        );
        return;
      }

      const targetDefaultDate =
        device === "android" ? addDaysToDateKey(todayKey, 1) : todayKey;

      const placement = placeSignalOnCalendar({
        signal: analysis.signal,
        sourceLabel: `${appName} screenshot`,
        defaultDateKey: targetDefaultDate,
        blocks,
        captures,
        rules,
        settings,
        status: settings.autoWriteToCalendar ? "confirmed" : "auto-scheduled",
      });

      let finalBlocks = placement.updatedBlocks;
      let createdBlock = placement.createdBlock;

      if (createdBlock && settings.autoWriteToCalendar) {
        const syncedBlock = await pushBlockToExternalCalendar(createdBlock);
        createdBlock = syncedBlock;
        finalBlocks = finalBlocks.map((b) =>
          b.id === syncedBlock.id ? syncedBlock : b
        );
      }

      const newCap: ScreenshotCapture = {
        id: `cap-${Date.now()}`,
        timestampIso: new Date().toISOString(),
        device,
        appName,
        windowTitle,
        summaryText: analysis.signal.summary,
        imageDataUrl,
        modelUsed: analysis.modelUsed,
        inferenceMs: analysis.latencyMs,
        syncState: !analysis.signal.hasActionableItem
          ? "no-action"
          : placement.deduplicated
            ? "deduplicated"
            : "scheduled",
        extractedSignal: analysis.signal,
        createdBlockId: createdBlock?.id,
      };

      setBlocks(finalBlocks);
      setCaptures((prev) => [newCap, ...prev]);

      if (createdBlock) {
        showToast(
          `Scheduled "${createdBlock.title}" on ${createdBlock.dateKey} at ${formatMinutesToTime(
            createdBlock.startMinutes
          )}`
        );
      }
    },
    [
      appendLog,
      blocks,
      captures,
      pushBlockToExternalCalendar,
      rules,
      settings,
      showToast,
      todayKey,
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
      void processCapturedImage({ ...frame, device: "macbook" }),
  });

  const handleUploadMacScreenshot = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      void processCapturedImage({
        imageDataUrl: dataUrl,
        appName: "Uploaded Screenshot",
        windowTitle: file.name,
        device: "macbook",
      });
    };
    reader.readAsDataURL(file);
  };

  // Calendar Block Actions
  const handleConfirmAndSyncBlock = async (id: string) => {
    const target = blocks.find((b) => b.id === id);
    if (!target) return;
    const synced = await pushBlockToExternalCalendar(target);
    setBlocks((prev) => prev.map((b) => (b.id === id ? synced : b)));
    showToast(
      synced.syncedToExternalCalendar
        ? `Written "${synced.title}" to your Calendar`
        : `Confirmed "${synced.title}"`
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
    showToast(`Approved ${count} block${count === 1 ? "" : "s"}`);
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
      const kw = target.title
        .replace(/^Prep:\s*/i, "")
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 2)
        .join("|");
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
      showToast("No later open slot today — try Push +1 Day");
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

  // Feedback & Rules Handlers
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

  // Android Folder Sync & Nightly Batch Processing
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
        summaryText: "Queued raw phone screenshot for nightly Gemma 4 batch run.",
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
        summaryText: "Queued raw phone screenshot (waiting for Mac Gemma 4 batch).",
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
    const queued = captures.filter(
      (c) => c.device === "android" && c.syncState === "queued-for-tonight"
    );

    let workingBlocks = [...blocks];
    let added = 0;
    let deduped = 0;
    const updatedMap = new Map<string, ScreenshotCapture>();

    for (const cap of queued) {
      const analysis = await analyzeScreenshotWithGemma4({
        imageDataUrl: cap.imageDataUrl,
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
            analysis.error || "Local Gemma 4 offline — kept in queue.",
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
            : "scheduled",
      });
    }

    setBlocks(workingBlocks);
    setCaptures((prev) => prev.map((c) => updatedMap.get(c.id) ?? c));
    setIsRunningNightlyBatch(false);
    const msg = `Processed ${queued.length} phone screenshot(s): ${added} scheduled onto Tomorrow, ${deduped} duplicates skipped.`;
    setLastBatchSummary(msg);
    showToast(msg);
  };

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/20 text-xs text-muted-foreground">
        Loading Dayframe...
      </div>
    );
  }

  // First-Run Kickstart Setup Phase (Zero fake data!)
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
        macBridgeState={macBridgeState}
        macPairingToken={macPairingToken}
        onChangeMacPairingToken={setMacPairingToken}
        onVerifyMacBridge={verifyAndLoadMacBridge}
        macCalendars={macCalendars}
        googleAccessToken={googleAccessToken}
        onChangeGoogleAccessToken={setGoogleAccessToken}
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

  return (
    <div className="min-h-screen bg-muted/20 text-foreground">
      <TopMenubar
        settings={settings}
        onUpdateSettings={(patch) =>
          setSettings((prev) => ({ ...prev, ...patch }))
        }
        gemmaStatus={gemmaStatus}
        onRecheckGemma={refreshGemmaStatus}
        macBridgeState={macBridgeState}
        isCapturing={isCapturing}
        isCapturePaused={isCapturePaused}
        onTogglePauseCapture={() => setIsCapturePaused((p) => !p)}
        secondsUntilNext={secondsUntilNext}
        skippedStaticCount={skippedStaticCount}
        onStartCapture={() => void startCapture()}
        onStopCapture={stopCapture}
        onSnapNow={() => void grabFrameNow(true)}
        isSyncingCalendar={isSyncingCalendar}
        onRescanCalendarAndMail={() => {
          void runBaselineCalendarAndMailScan().then((res) => {
            if (res.ok) {
              showToast(
                `Synced ${res.existingCount} calendar events & ${res.emailCount} emails`
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
            captureError={captureError}
            onDismissCaptureError={clearCaptureError}
            onUploadScreenshotFile={handleUploadMacScreenshot}
            onSelectBlockId={(id) => setSelectedBlockId(id)}
            gemmaModel={settings.gemmaModel}
          />
        </div>

        <div className="order-1 lg:order-2 lg:col-span-6">
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
            onConfirmAndSyncBlock={(id) => void handleConfirmAndSyncBlock(id)}
            onConfirmAndSyncAllAutoBlocks={() =>
              void handleConfirmAndSyncAllAutoBlocks()
            }
            onAdjustBlockDuration={handleAdjustBlockDuration}
            onMoveBlockToNextSlot={handleMoveBlockToNextSlot}
            onShiftBlockDate={handleShiftBlockDate}
            onDeleteBlock={handleDeleteBlock}
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
