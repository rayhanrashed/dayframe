"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { TopMenubar } from "./top-menubar";
import { CaptureStreamPanel } from "./capture-stream-panel";
import { CalendarTimeline } from "./calendar-timeline";
import { OrganizerFeedbackPanel } from "./organizer-feedback-panel";
import { NightlyAndroidSheet } from "./nightly-android-sheet";
import { useScreenCapture } from "@/hooks/use-screen-capture";
import {
  CalendarBlock,
  CaptureSettings,
  DiscussionMessage,
  ScreenshotCapture,
  StandingRule,
  SuggestedPreferencePrompt,
} from "@/lib/types";
import {
  DEFAULT_CAPTURE_SETTINGS,
  INITIAL_CALENDAR_BLOCKS,
  INITIAL_CAPTURES,
  INITIAL_DISCUSSION_MESSAGES,
  INITIAL_STANDING_RULES,
  INITIAL_SUGGESTED_PROMPTS,
  renderMacScreenshotSvg,
  SIMULATED_INCOMING_MAC_CAPTURES,
} from "@/lib/sample-data";
import {
  analyzeScreenshotWithLocalOllama,
  extractHeuristicSignalFromText,
  LocalOllamaStatus,
  probeLocalOllama,
} from "@/lib/ollama-vlm";
import {
  applyNaturalLanguageFeedback,
  findOpenSlot,
  formatDuration,
  formatMinutesToTime,
  reconcilePrepBlocks,
  scheduleSignalIntoCalendar,
} from "@/lib/scheduler";
import {
  buildIcsForBlocks,
  parseImportedIcs,
  triggerIcsDownload,
} from "@/lib/ics";

const STORAGE_KEY = "dayframe.workspace.v1";

interface PersistedState {
  settings: CaptureSettings;
  blocks: CalendarBlock[];
  captures: ScreenshotCapture[];
  rules: StandingRule[];
  messages: DiscussionMessage[];
  suggestedPrompts: SuggestedPreferencePrompt[];
  simCursor: number;
}

export function DayframeApp() {
  const [hydrated, setHydrated] = useState(false);
  const [settings, setSettings] = useState<CaptureSettings>(
    DEFAULT_CAPTURE_SETTINGS
  );
  const [blocks, setBlocks] = useState<CalendarBlock[]>(INITIAL_CALENDAR_BLOCKS);
  const [captures, setCaptures] =
    useState<ScreenshotCapture[]>(INITIAL_CAPTURES);
  const [rules, setRules] = useState<StandingRule[]>(INITIAL_STANDING_RULES);
  const [messages, setMessages] = useState<DiscussionMessage[]>(
    INITIAL_DISCUSSION_MESSAGES
  );
  const [suggestedPrompts, setSuggestedPrompts] = useState<
    SuggestedPreferencePrompt[]
  >(INITIAL_SUGGESTED_PROMPTS);
  const [simCursor, setSimCursor] = useState(0);

  const [viewMode, setViewMode] = useState<"split" | "today" | "tomorrow">(
    "split"
  );
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [androidSheetOpen, setAndroidSheetOpen] = useState(false);
  const [isCapturePaused, setIsCapturePaused] = useState(false);
  const [isProcessingCapture, setIsProcessingCapture] = useState(false);
  const [isRunningNightlyBatch, setIsRunningNightlyBatch] = useState(false);
  const [lastBatchSummary, setLastBatchSummary] = useState<string | null>(null);
  const [toastBanner, setToastBanner] = useState<string | null>(null);

  const [ollamaStatus, setOllamaStatus] = useState<LocalOllamaStatus>({
    connected: false,
    models: [],
    visionModels: [],
    recommendedModel: "llama3.2-vision",
  });

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToastBanner(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastBanner(null);
    }, 5200);
  }, []);

  // Hydrate saved local state on mount asynchronously to avoid synchronous cascading renders
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<PersistedState>;
          if (parsed.settings) setSettings(parsed.settings);
          if (parsed.blocks) setBlocks(parsed.blocks);
          if (parsed.captures) setCaptures(parsed.captures);
          if (parsed.rules) setRules(parsed.rules);
          if (parsed.messages) setMessages(parsed.messages);
          if (parsed.suggestedPrompts)
            setSuggestedPrompts(parsed.suggestedPrompts);
          if (typeof parsed.simCursor === "number")
            setSimCursor(parsed.simCursor);
        }
      } catch {
        // Ignore malformed localStorage
      }
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist changes locally on MacBook
  useEffect(() => {
    if (!hydrated) return;
    try {
      const stateToSave: PersistedState = {
        settings,
        blocks,
        captures,
        rules,
        messages,
        suggestedPrompts,
        simCursor,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    } catch {
      // Ignore quota errors if user uploads many large screenshots
    }
  }, [
    blocks,
    captures,
    hydrated,
    messages,
    rules,
    settings,
    simCursor,
    suggestedPrompts,
  ]);

  // Probe local Ollama on mount & manual re-check
  const refreshOllamaStatus = useCallback(async () => {
    const status = await probeLocalOllama();
    setOllamaStatus(status);
    if (status.connected && status.recommendedModel) {
      setSettings((prev) => ({
        ...prev,
        ollamaModel: prev.ollamaModel || status.recommendedModel,
      }));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    probeLocalOllama().then((status) => {
      if (cancelled) return;
      setOllamaStatus(status);
      if (status.connected && status.recommendedModel) {
        setSettings((prev) => ({
          ...prev,
          ollamaModel: prev.ollamaModel || status.recommendedModel,
        }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Handle a real live frame from MacBook DisplayMedia
  const handleLiveFrameCaptured = useCallback(
    async (imageDataUrl: string) => {
      setIsProcessingCapture(true);
      const tempCapture: ScreenshotCapture = {
        id: `cap-live-${Date.now()}`,
        timestampIso: new Date().toISOString(),
        source: "mac-screen",
        device: "macbook",
        appName: "Live MacBook Display",
        windowTitle: "Periodic Mac Screen Capture",
        ocrPreview: "Analyzing live MacBook screenshot with local model...",
        imageDataUrl,
        syncState: "no-action",
      };

      const { signal, usedLocalVlm } = await analyzeScreenshotWithLocalOllama({
        imageDataUrl,
        model: settings.ollamaModel,
        rules,
        device: "macbook",
      });

      const enrichedCapture: ScreenshotCapture = {
        ...tempCapture,
        ocrPreview: usedLocalVlm
          ? signal.summary
          : "Live screen frame captured (connect local Ollama on 127.0.0.1:11434 for live OCR, or paste text/screenshots directly).",
      };

      setBlocks((prevBlocks) => {
        const res = scheduleSignalIntoCalendar({
          capture: enrichedCapture,
          signal,
          currentBlocks: prevBlocks,
          existingCaptures: captures,
          rules,
          settings,
        });
        setCaptures((prevCaps) => [res.updatedCapture, ...prevCaps]);
        if (res.createdBlock) {
          showToast(
            `Scheduled "${res.createdBlock.title}" at ${formatMinutesToTime(
              res.createdBlock.startMinutes
            )}`
          );
        }
        return res.updatedBlocks;
      });
      setIsProcessingCapture(false);
    },
    [captures, rules, settings, showToast]
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
    intervalMinutes: settings.intervalMinutes,
    skipDuplicateFrames: settings.skipDuplicateFrames,
    isPaused: isCapturePaused,
    onFrameCaptured: handleLiveFrameCaptured,
  });

  const handleUpdateSettings = (patch: Partial<CaptureSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      if (patch.minGapBetweenBlocksMinutes !== undefined) {
        setBlocks((b) => reconcilePrepBlocks(b, rules, next));
      }
      return next;
    });
  };

  // Simulate next realistic Mail / Slack screenshot capture
  const handleSimulateNextMacCapture = () => {
    setIsProcessingCapture(true);
    const template =
      SIMULATED_INCOMING_MAC_CAPTURES[
        simCursor % SIMULATED_INCOMING_MAC_CAPTURES.length
      ];
    setSimCursor((c) => c + 1);

    setTimeout(() => {
      const newCap: ScreenshotCapture = {
        id: `cap-sim-${Date.now()}`,
        timestampIso: new Date().toISOString(),
        source: template.source,
        device: "macbook",
        appName: template.appName,
        windowTitle: template.windowTitle,
        ocrPreview: template.ocrPreview,
        imageDataUrl: template.imageDataUrl,
        syncState: "scheduled",
      };

      const res = scheduleSignalIntoCalendar({
        capture: newCap,
        signal: template.signal,
        currentBlocks: blocks,
        existingCaptures: captures,
        rules,
        settings,
      });

      setBlocks(res.updatedBlocks);
      setCaptures((prev) => [res.updatedCapture, ...prev]);
      setIsProcessingCapture(false);

      if (res.updatedCapture.syncState === "deduplicated") {
        showToast(
          `Skipped duplicate "${template.signal.title}" (already on your calendar)`
        );
      } else if (res.createdBlock) {
        if (res.createdBlock.dayOffset === 1 && viewMode === "today") {
          setViewMode("split");
        }
        showToast(
          `${
            res.createdBlock.isSoloHold ? "Solo invite" : "Time-block"
          } added: "${res.createdBlock.title}" (${
            res.createdBlock.dayOffset === 0 ? "Today" : "Tomorrow"
          } ${formatMinutesToTime(res.createdBlock.startMinutes)})`
        );
      }
    }, 320);
  };

  // Upload or paste a real PNG/JPEG screenshot
  const handleUploadScreenshotFile = async (file: File, noteHint?: string) => {
    setIsProcessingCapture(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result ?? "");
      const { signal } = await analyzeScreenshotWithLocalOllama({
        imageDataUrl: dataUrl,
        model: settings.ollamaModel,
        rules,
        hintText: noteHint || file.name.replace(/\.[^.]+$/, ""),
        device: "macbook",
      });

      const newCap: ScreenshotCapture = {
        id: `cap-upload-${Date.now()}`,
        timestampIso: new Date().toISOString(),
        source: "uploaded",
        device: "macbook",
        appName: "Uploaded Screenshot",
        windowTitle: file.name,
        ocrPreview: noteHint || signal.summary,
        imageDataUrl: dataUrl,
        syncState: "scheduled",
      };

      const res = scheduleSignalIntoCalendar({
        capture: newCap,
        signal,
        currentBlocks: blocks,
        existingCaptures: captures,
        rules,
        settings,
      });

      setBlocks(res.updatedBlocks);
      setCaptures((prev) => [res.updatedCapture, ...prev]);
      setIsProcessingCapture(false);
      if (res.createdBlock) {
        showToast(
          `Extracted "${res.createdBlock.title}" → ${
            res.createdBlock.dayOffset === 0 ? "Today" : "Tomorrow"
          } ${formatMinutesToTime(res.createdBlock.startMinutes)}`
        );
      }
    };
    reader.readAsDataURL(file);
  };

  // Quick Mail / Slack snippet extractor
  const handleQuickTextSimulate = (
    source: "mac-mail" | "mac-slack",
    text: string
  ) => {
    const signal = extractHeuristicSignalFromText(text, "macbook");
    const svgUrl = renderMacScreenshotSvg({
      app: source === "mac-mail" ? "mail" : "slack",
      headerTitle:
        source === "mac-mail" ? "Apple Mail — Captured Thread" : "Slack — Captured Thread",
      sender: source === "mac-mail" ? "Captured Email" : "Captured Slack Message",
      senderMeta: "Just now • Local Extractor",
      line1: text.slice(0, 62),
      line2: text.length > 62 ? text.slice(62, 124) : "",
      highlightPill: signal.isSoloInvite
        ? `Solo Calendar Invite (${signal.estimatedMinutes}m)`
        : `Time-Block (${signal.estimatedMinutes}m)`,
    });

    const newCap: ScreenshotCapture = {
      id: `cap-text-${Date.now()}`,
      timestampIso: new Date().toISOString(),
      source,
      device: "macbook",
      appName: source === "mac-mail" ? "Apple Mail" : "Slack",
      windowTitle: signal.title,
      ocrPreview: text,
      imageDataUrl: svgUrl,
      syncState: "scheduled",
    };

    const res = scheduleSignalIntoCalendar({
      capture: newCap,
      signal,
      currentBlocks: blocks,
      existingCaptures: captures,
      rules,
      settings,
    });

    setBlocks(res.updatedBlocks);
    setCaptures((prev) => [res.updatedCapture, ...prev]);
    if (res.createdBlock) {
      showToast(
        `Added "${res.createdBlock.title}" (${
          res.createdBlock.dayOffset === 0 ? "Today" : "Tomorrow"
        } ${formatMinutesToTime(res.createdBlock.startMinutes)})`
      );
    }
  };

  // Calendar Block Feedback Actions
  const handleConfirmBlock = (id: string) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, status: "confirmed" } : b))
    );
    showToast("Confirmed slot on your calendar");
  };

  const handleConfirmAllAutoBlocks = () => {
    const count = blocks.filter((b) => b.status === "auto-scheduled").length;
    setBlocks((prev) =>
      prev.map((b) =>
        b.status === "auto-scheduled" ? { ...b, status: "confirmed" } : b
      )
    );
    showToast(`Locked ${count} auto-scheduled blocks onto your calendar`);
  };

  const handleAdjustBlockDuration = (
    id: string,
    deltaMinutes: number,
    saveCalibrationRule: boolean
  ) => {
    const target = blocks.find((b) => b.id === id);
    if (!target) return;
    const nextDuration = Math.max(
      15,
      Math.min(240, target.durationMinutes + deltaMinutes)
    );

    setBlocks((prev) =>
      prev.map((b) =>
        b.id === id
          ? {
              ...b,
              durationMinutes: nextDuration,
              rationale: `${b.rationale} (Adjusted to ${formatDuration(
                nextDuration
              )} from your feedback.)`,
            }
          : b
      )
    );

    if (saveCalibrationRule) {
      const cleanWords = target.title
        .replace(/^Prep:\s*/i, "")
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 2)
        .join("|");

      if (cleanWords) {
        const calRule: StandingRule = {
          id: `rule-cal-${Date.now()}`,
          title: `Budget ${formatDuration(nextDuration)} for "${cleanWords.replace(
            "|",
            " "
          )}"`,
          description: `Learned from your direct block feedback on "${target.title}".`,
          category: "duration-calibration",
          enabled: true,
          triggerPattern: cleanWords,
          fixedMinutesOverride: nextDuration,
          createdFromFeedback: true,
        };
        setRules((prev) => [calRule, ...prev]);
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${Date.now()}`,
            role: "assistant",
            text: `Updated "${target.title}" to ${formatDuration(
              nextDuration
            )} and saved a duration calibration rule so similar tasks get ${formatDuration(
              nextDuration
            )} automatically.`,
            timestampIso: new Date().toISOString(),
            appliedActionSummary: `Learned duration: ${formatDuration(
              nextDuration
            )}`,
          },
        ]);
      }
    }
    showToast(`Updated block to ${formatDuration(nextDuration)}`);
  };

  const handleMoveBlockToNextSlot = (id: string) => {
    const target = blocks.find((b) => b.id === id);
    if (!target) return;
    const others = blocks.filter((b) => b.id !== id);
    const laterBlocks = [
      ...others,
      {
        ...target,
        id: "__cursor_blocker__",
        startMinutes: settings.workdayStartMinutes,
        durationMinutes: Math.max(
          15,
          target.startMinutes + 15 - settings.workdayStartMinutes
        ),
      },
    ];
    let nextStart = findOpenSlot({
      dayOffset: target.dayOffset,
      durationMinutes: target.durationMinutes,
      blocks: laterBlocks,
      rules,
      settings,
    });
    let nextDay = target.dayOffset;

    if (nextStart === null) {
      nextDay = target.dayOffset === 0 ? 1 : 0;
      nextStart = findOpenSlot({
        dayOffset: nextDay,
        durationMinutes: target.durationMinutes,
        blocks: others,
        rules,
        settings,
      });
    }

    if (nextStart !== null) {
      setBlocks(
        others
          .concat({ ...target, dayOffset: nextDay, startMinutes: nextStart })
          .sort((a, b) => a.dayOffset - b.dayOffset || a.startMinutes - b.startMinutes)
      );
      showToast(
        `Moved to ${nextDay === 0 ? "Today" : "Tomorrow"} ${formatMinutesToTime(
          nextStart
        )}`
      );
    } else {
      showToast("No other open slot found with that duration");
    }
  };

  const handleToggleBlockDay = (id: string) => {
    const target = blocks.find((b) => b.id === id);
    if (!target) return;
    const destDay = target.dayOffset === 0 ? 1 : 0;
    const others = blocks.filter((b) => b.id !== id);
    const slot =
      findOpenSlot({
        dayOffset: destDay,
        durationMinutes: target.durationMinutes,
        blocks: others,
        rules,
        settings,
      }) ?? target.startMinutes;

    setBlocks(
      others
        .concat({ ...target, dayOffset: destDay, startMinutes: slot })
        .sort((a, b) => a.dayOffset - b.dayOffset || a.startMinutes - b.startMinutes)
    );
    setViewMode("split");
    showToast(
      `Moved "${target.title}" to ${
        destDay === 0 ? "Today" : "Tomorrow"
      } at ${formatMinutesToTime(slot)}`
    );
  };

  const handleDeleteBlock = (id: string) => {
    setBlocks((prev) =>
      prev.filter((b) => b.id !== id && b.linkedMeetingId !== id)
    );
    showToast("Removed block from schedule");
  };

  // Conversational Feedback & Standing Rules
  const handleSendFeedback = (text: string) => {
    const userMsg: DiscussionMessage = {
      id: `msg-u-${Date.now()}`,
      role: "user",
      text,
      timestampIso: new Date().toISOString(),
    };

    const result = applyNaturalLanguageFeedback({
      text,
      blocks,
      rules,
      settings,
    });

    const assistantMsg: DiscussionMessage = {
      id: `msg-a-${Date.now() + 1}`,
      role: "assistant",
      text: result.assistantReply,
      timestampIso: new Date().toISOString(),
      appliedActionSummary: result.actionSummary,
    };

    setBlocks(result.blocks);
    setRules(result.rules);
    setSettings(result.settings);
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    showToast(result.actionSummary);
  };

  const handleAcceptSuggestion = (promptId: string) => {
    const prompt = suggestedPrompts.find((p) => p.id === promptId);
    if (!prompt) return;

    const newRule: StandingRule = {
      ...prompt.ruleToCreate,
      id: `rule-sug-${Date.now()}`,
      createdFromFeedback: true,
    };
    const nextRules = [newRule, ...rules];
    const nextBlocks = reconcilePrepBlocks(blocks, nextRules, settings);

    setRules(nextRules);
    setBlocks(nextBlocks);
    setSuggestedPrompts((prev) =>
      prev.map((p) => (p.id === promptId ? { ...p, answered: "accepted" } : p))
    );
    setMessages((prev) => [
      ...prev,
      {
        id: `msg-sug-${Date.now()}`,
        role: "assistant",
        text: `Enabled "${newRule.title}" and re-checked your calendar so matching meetings and focus slots follow this rule automatically.`,
        timestampIso: new Date().toISOString(),
        appliedActionSummary: `Added rule: ${newRule.title}`,
      },
    ]);
    showToast(`Enabled rule: ${newRule.title}`);
  };

  const handleDismissSuggestion = (promptId: string) => {
    setSuggestedPrompts((prev) =>
      prev.map((p) =>
        p.id === promptId ? { ...p, answered: "dismissed" } : p
      )
    );
  };

  const handleToggleRule = (ruleId: string, enabled: boolean) => {
    const nextRules = rules.map((r) =>
      r.id === ruleId ? { ...r, enabled } : r
    );
    setRules(nextRules);
    setBlocks(reconcilePrepBlocks(blocks, nextRules, settings));
  };

  const handleDeleteRule = (ruleId: string) => {
    const nextRules = rules.filter((r) => r.id !== ruleId);
    setRules(nextRules);
    setBlocks(reconcilePrepBlocks(blocks, nextRules, settings));
  };

  const handleAddManualPrepRule = (opts: {
    keyword: string;
    prepMinutes: number;
    leadHours: number;
  }) => {
    const leadMins = Math.round(opts.leadHours * 60);
    const newRule: StandingRule = {
      id: `rule-manual-${Date.now()}`,
      title: `${formatDuration(opts.prepMinutes)} prep (≥${formatDuration(
        leadMins
      )} ahead) for "${opts.keyword}"`,
      description: `Reserve ${formatDuration(
        opts.prepMinutes
      )} finishing at least ${formatDuration(
        leadMins
      )} before meetings matching "${opts.keyword}".`,
      category: "prep-time",
      enabled: true,
      triggerPattern: opts.keyword,
      prepDurationMinutes: opts.prepMinutes,
      minLeadMinutesBeforeMeeting: leadMins,
      createdFromFeedback: true,
    };
    const nextRules = [newRule, ...rules];
    setRules(nextRules);
    setBlocks(reconcilePrepBlocks(blocks, nextRules, settings));
    showToast(`Saved prep rule for "${opts.keyword}"`);
  };

  // Nightly Android Batch Sync & Cross-Device Deduplication
  const handleRunNightlyBatchNow = () => {
    setIsRunningNightlyBatch(true);
    setTimeout(() => {
      let workingBlocks = [...blocks];
      const processedCaptures = captures.filter(
        (c) => c.syncState !== "queued-for-tonight"
      );
      const nextCaptures: ScreenshotCapture[] = [];

      let scheduledNew = 0;
      let dedupedCount = 0;

      for (const cap of captures) {
        if (cap.device === "android" && cap.syncState === "queued-for-tonight") {
          const signal =
            cap.extractedSignal ??
            extractHeuristicSignalFromText(cap.ocrPreview, "android");
          const res = scheduleSignalIntoCalendar({
            capture: cap,
            signal,
            currentBlocks: workingBlocks,
            existingCaptures: [...processedCaptures, ...nextCaptures],
            rules,
            settings,
            defaultTargetDayOffset: 1,
          });
          workingBlocks = res.updatedBlocks;
          nextCaptures.push(res.updatedCapture);
          if (res.updatedCapture.syncState === "deduplicated") {
            dedupedCount++;
          } else if (res.createdBlock) {
            scheduledNew++;
          }
        } else {
          nextCaptures.push(cap);
        }
      }

      setBlocks(workingBlocks);
      setCaptures(nextCaptures);
      setIsRunningNightlyBatch(false);
      setViewMode("split");

      const summary = `Added ${scheduledNew} new block${
        scheduledNew === 1 ? "" : "s"
      } onto Tomorrow's calendar and skipped ${dedupedCount} duplicate phone screenshot${
        dedupedCount === 1 ? "" : "s"
      } already captured on your MacBook.`;
      setLastBatchSummary(summary);
      showToast(summary);
    }, 550);
  };

  const handleUploadAndroidScreenshot = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
      const signal = extractHeuristicSignalFromText(baseName, "android");

      const queuedShot: ScreenshotCapture = {
        id: `cap-android-up-${Date.now()}`,
        timestampIso: new Date().toISOString(),
        source: "android-queue",
        device: "android",
        appName: "Android Companion Upload",
        windowTitle: file.name,
        ocrPreview: `Queued mobile screenshot: "${baseName}"`,
        imageDataUrl: dataUrl,
        syncState: "queued-for-tonight",
        extractedSignal: signal,
      };
      setCaptures((prev) => [queuedShot, ...prev]);
      showToast("Added raw phone screenshot to tonight's Mac sync queue");
    };
    reader.readAsDataURL(file);
  };

  // .ics Calendar Export & Import
  const handleExportAllIcs = () => {
    const ics = buildIcsForBlocks(blocks);
    triggerIcsDownload("dayframe-schedule.ics", ics);
    showToast("Downloaded dayframe-schedule.ics — open in Apple Calendar");
  };

  const handleDownloadSingleIcs = (block: CalendarBlock) => {
    const ics = buildIcsForBlocks([block]);
    const slug = block.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 32);
    triggerIcsDownload(`${slug || "solo-invite"}.ics`, ics);
    showToast(`Downloaded solo invite .ics for "${block.title}"`);
  };

  const handleImportIcsFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result ?? "");
      const imported = parseImportedIcs(raw);
      if (imported.length === 0) {
        showToast(
          "No Today/Tomorrow events found in .ics file — kept current calendar"
        );
        return;
      }
      const nonSample = blocks.filter((b) => !b.isSample);
      const merged = reconcilePrepBlocks(
        [...nonSample, ...imported],
        rules,
        settings
      );
      setBlocks(merged);
      showToast(
        `Imported ${imported.length} calendar event${
          imported.length === 1 ? "" : "s"
        } & auto-attached recurring prep rules`
      );
    };
    reader.readAsText(file);
  };

  const handleResetSampleWorkspace = () => {
    localStorage.removeItem(STORAGE_KEY);
    setSettings(DEFAULT_CAPTURE_SETTINGS);
    setBlocks(INITIAL_CALENDAR_BLOCKS);
    setCaptures(INITIAL_CAPTURES);
    setRules(INITIAL_STANDING_RULES);
    setMessages(INITIAL_DISCUSSION_MESSAGES);
    setSuggestedPrompts(INITIAL_SUGGESTED_PROMPTS);
    setSimCursor(0);
    setLastBatchSummary(null);
    showToast("Reset workspace to default sample day");
  };

  const androidCaptures = captures.filter((c) => c.device === "android");
  const queuedAndroidCount = androidCaptures.filter(
    (c) => c.syncState === "queued-for-tonight"
  ).length;
  const hasSampleData = blocks.some((b) => b.isSample);

  return (
    <div className="min-h-screen bg-muted/20 text-foreground">
      <TopMenubar
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        isCapturing={isCapturing}
        isCapturePaused={isCapturePaused}
        onTogglePauseCapture={() => setIsCapturePaused((p) => !p)}
        secondsUntilNext={secondsUntilNext}
        skippedStaticCount={skippedStaticCount}
        onStartLiveCapture={startCapture}
        onStopLiveCapture={stopCapture}
        onSnapNow={() => grabFrameNow(true)}
        onSimulateNextMacCapture={handleSimulateNextMacCapture}
        isProcessingCapture={isProcessingCapture}
        ollamaStatus={ollamaStatus}
        onRecheckOllama={refreshOllamaStatus}
        queuedAndroidCount={queuedAndroidCount}
        onOpenAndroidSync={() => setAndroidSheetOpen(true)}
        onExportIcs={handleExportAllIcs}
        onImportIcsFile={handleImportIcsFile}
        hasSampleData={hasSampleData}
        onResetSampleWorkspace={handleResetSampleWorkspace}
      />

      <main className="mx-auto grid max-w-[1600px] grid-cols-1 gap-4 p-4 lg:grid-cols-12 lg:p-6">
        {/* Left Column: MacBook Screenshot Stream (Mail, Slack, Live Frames) */}
        <div className="order-2 lg:order-1 lg:col-span-3">
          <CaptureStreamPanel
            captures={captures}
            captureError={captureError}
            onDismissCaptureError={clearCaptureError}
            onUploadScreenshotFile={handleUploadScreenshotFile}
            onQuickTextSimulate={handleQuickTextSimulate}
            onSelectBlockId={(id) => setSelectedBlockId(id)}
          />
        </div>

        {/* Center Column: Time-Blocked Calendar (Today + Tomorrow) */}
        <div className="order-1 lg:order-2 lg:col-span-6">
          <CalendarTimeline
            blocks={blocks}
            captures={captures}
            rules={rules}
            settings={settings}
            viewMode={viewMode}
            onChangeViewMode={setViewMode}
            selectedBlockId={selectedBlockId}
            onSelectBlockId={setSelectedBlockId}
            onConfirmBlock={handleConfirmBlock}
            onConfirmAllAutoBlocks={handleConfirmAllAutoBlocks}
            onAdjustBlockDuration={handleAdjustBlockDuration}
            onMoveBlockToNextSlot={handleMoveBlockToNextSlot}
            onToggleBlockDay={handleToggleBlockDay}
            onDeleteBlock={handleDeleteBlock}
            onDownloadSingleIcs={handleDownloadSingleIcs}
          />
        </div>

        {/* Right Column: Feedback Discussion, Standing Rules & Proactive Suggestions */}
        <div className="order-3 lg:col-span-3">
          <OrganizerFeedbackPanel
            messages={messages}
            rules={rules}
            suggestedPrompts={suggestedPrompts}
            onSendFeedback={handleSendFeedback}
            onAcceptSuggestion={handleAcceptSuggestion}
            onDismissSuggestion={handleDismissSuggestion}
            onToggleRule={handleToggleRule}
            onDeleteRule={handleDeleteRule}
            onAddManualPrepRule={handleAddManualPrepRule}
          />
        </div>
      </main>

      {/* Secondary Android Nightly Batch Sync Drawer */}
      <NightlyAndroidSheet
        open={androidSheetOpen}
        onOpenChange={setAndroidSheetOpen}
        androidCaptures={androidCaptures}
        nightlySyncHour={settings.nightlyAndroidSyncHour}
        isRunningBatch={isRunningNightlyBatch}
        lastBatchSummary={lastBatchSummary}
        onRunNightlyBatchNow={handleRunNightlyBatchNow}
        onUploadAndroidScreenshot={handleUploadAndroidScreenshot}
      />

      {/* Non-intrusive Action Feedback Toast */}
      {toastBanner && (
        <div className="fixed right-5 bottom-5 z-40 max-w-sm rounded-xl border bg-foreground px-4 py-2.5 text-xs font-medium text-background shadow-lg">
          {toastBanner}
        </div>
      )}
    </div>
  );
}
