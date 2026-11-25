import {
  CalendarBlock,
  ExtractedCaptureSignal,
  LocalPaperHit,
  OrganizerSettings,
  ScannedEmailItem,
  StandingRule,
  StrivingNode,
  UserModelGraph,
} from "./types";
import {
  addDaysToDateKey,
  formatDuration,
  formatMinutesToTime,
  isEligibleRealMeetingForPrep,
  summarizeOpenWindowsForDay,
} from "./scheduler";

const OLLAMA_BASE = "http://127.0.0.1:11434";

export interface GemmaModelOption {
  tag: string;
  label: string;
  sizeNote: string;
  modalityNote: string;
}

export const GEMMA4_MODEL_CATALOG: GemmaModelOption[] = [
  {
    tag: "gemma4:e4b",
    label: "Gemma 4 E4B (Default • Recommended for MacBook)",
    sizeNote: "~6.6 GB • 128K ctx",
    modalityNote: "Vision + Text • Loaded only during batch",
  },
  {
    tag: "gemma4:e2b",
    label: "Gemma 4 E2B (Ultra-Fast Edge)",
    sizeNote: "~4.6 GB • 128K ctx",
    modalityNote: "Vision + Text • Lowest Peak RAM",
  },
  {
    tag: "gemma4:12b",
    label: "Gemma 4 12B (High Accuracy Dense)",
    sizeNote: "~7.7 GB • 256K ctx",
    modalityNote: "Vision + Text • 16GB+ Unified Memory",
  },
  {
    tag: "gemma4:26b",
    label: "Gemma 4 26B-A4B (Mixture-of-Experts)",
    sizeNote: "~16 GB • 256K ctx (3.8B active)",
    modalityNote: "Vision + Text • Fast Pro MacBook",
  },
  {
    tag: "gemma4:31b",
    label: "Gemma 4 31B (Max Reasoning Dense)",
    sizeNote: "~19 GB • 256K ctx",
    modalityNote: "Vision + Text • 32GB+ Unified Memory",
  },
];

export interface LocalGemmaStatus {
  reachable: boolean;
  installedModels: string[];
  installedGemma4Models: string[];
  selectedModelInstalled: boolean;
  pingMs?: number;
  errorDetail?: string;
}

export function resolveInstalledGemmaTag(
  preferredModel: string,
  status: LocalGemmaStatus
): string {
  if (status.selectedModelInstalled) {
    return (
      status.installedModels.find(
        (m) =>
          m.toLowerCase() === preferredModel.toLowerCase() ||
          (preferredModel === "gemma4:e4b" &&
            (m.toLowerCase() === "gemma4:latest" ||
              m.toLowerCase() === "gemma4"))
      ) ?? preferredModel
    );
  }
  return status.installedGemma4Models[0] ?? preferredModel;
}

export async function probeLocalGemma(
  preferredModel: string
): Promise<LocalGemmaStatus> {
  const t0 = performance.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2200);
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        reachable: false,
        installedModels: [],
        installedGemma4Models: [],
        selectedModelInstalled: false,
        errorDetail: `Ollama on 127.0.0.1:11434 returned HTTP ${res.status}.`,
      };
    }

    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const installedModels = (data.models ?? [])
      .map((m) => m.name ?? "")
      .filter(Boolean);

    const installedGemma4Models = installedModels.filter((m) =>
      m.toLowerCase().startsWith("gemma4")
    );

    const normPreferred = preferredModel.toLowerCase();
    const selectedModelInstalled = installedModels.some((m) => {
      const lower = m.toLowerCase();
      if (lower === normPreferred) return true;
      if (
        normPreferred === "gemma4:e4b" &&
        (lower === "gemma4:latest" || lower === "gemma4")
      ) {
        return true;
      }
      return false;
    });

    return {
      reachable: true,
      installedModels,
      installedGemma4Models,
      selectedModelInstalled,
      pingMs: Math.round(performance.now() - t0),
    };
  } catch {
    return {
      reachable: false,
      installedModels: [],
      installedGemma4Models: [],
      selectedModelInstalled: false,
      errorDetail:
        "Ollama is currently sleeping (0 MB RAM) — Dayframe wakes it automatically during scans and batch sweeps.",
    };
  }
}

export async function unloadGemmaModelImmediately(
  model: string
): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model, keep_alive: 0 }),
    });
    clearTimeout(timer);
  } catch {
    // Already unloaded or daemon stopped
  }
}

export async function testGemma4Ping(params: {
  model: string;
  unloadImmediately?: boolean;
}): Promise<{
  ok: boolean;
  latencyMs: number;
  resolvedModel: string;
  message: string;
}> {
  const { model, unloadImmediately = true } = params;
  const t0 = performance.now();
  const status = await probeLocalGemma(model);
  if (!status.reachable) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - t0),
      resolvedModel: model,
      message:
        "Ollama is currently stopped (0 MB RAM). Click 'Wake, Test & Sleep' or run ./dayframe on your MacBook.",
    };
  }

  const targetModel = resolveInstalledGemmaTag(model, status);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: targetModel,
        stream: false,
        keep_alive: unloadImmediately ? 0 : "90s",
        messages: [
          {
            role: "user",
            content:
              "Reply in one short sentence confirming Gemma 4 works offline and will unload to 0 MB RAM right after.",
          },
        ],
      }),
    });
    clearTimeout(timer);

    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        ok: false,
        latencyMs,
        resolvedModel: targetModel,
        message: errText.includes("not found")
          ? `Model "${targetModel}" is not downloaded yet. Run "./dayframe" once while online to cache it.`
          : `Ollama returned HTTP ${res.status}: ${errText.slice(0, 140)}`,
      };
    }

    const body = (await res.json()) as { message?: { content?: string } };
    return {
      ok: true,
      latencyMs,
      resolvedModel: targetModel,
      message:
        (body.message?.content?.trim() ||
          `${targetModel} responded cleanly in ${latencyMs}ms.`) +
        (unloadImmediately ? " (Unloaded back to 0 MB RAM)" : ""),
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - t0),
      resolvedModel: targetModel,
      message:
        err instanceof Error
          ? err.message
          : "Timed out waiting for local Gemma 4 response.",
    };
  }
}

export function buildCompactCalendarContextText(
  blocks: CalendarBlock[],
  todayDateKey: string,
  rules: StandingRule[],
  settings: OrganizerSettings
): string {
  const lines: string[] = [];
  for (let d = 0; d < 5; d++) {
    const dk = addDaysToDateKey(todayDateKey, d);
    const dayEvents = blocks
      .filter((b) => b.dateKey === dk)
      .sort((a, b) => a.startMinutes - b.startMinutes);
    const evStr =
      dayEvents.length === 0
        ? "No events"
        : dayEvents
            .map(
              (e) =>
                `[id=${e.id}] ${formatMinutesToTime(
                  e.startMinutes
                )} (${formatDuration(e.durationMinutes)}) "${e.title}"${
                  (e.attendeeCount ?? 0) > 0
                    ? ` [${e.attendeeCount} attendees]`
                    : ""
                }`
            )
            .join("; ");
    const freeStr = summarizeOpenWindowsForDay({
      dateKey: dk,
      blocks,
      rules,
      settings,
    });
    lines.push(`${dk}: Events=[${evStr}] | OpenSlots=[${freeStr}]`);
  }
  return lines.join("\n");
}

export function buildPriorUnderstandingPromptBlock(
  userGraph?: UserModelGraph,
  blocks: CalendarBlock[] = []
): string {
  if (!userGraph) return "";
  const projectsSummary = userGraph.taskModels.slice(0, 12).map((tm) => {
    const upcomingMins = blocks
      .filter((b) => !b.done && b.taskModelId === tm.id)
      .reduce((s, b) => s + b.durationMinutes, 0);
    const doneMins = blocks
      .filter((b) => b.done && b.taskModelId === tm.id)
      .reduce((s, b) => s + (b.actualMinutesTaken ?? b.durationMinutes), 0);
    return {
      projectId: tm.id,
      projectTitle: tm.canonicalTitle,
      summary: tm.summary,
      doneMinutesSoFar: doneMins,
      alreadyScheduledUpcomingMinutes: upcomingMins,
      openTodos: tm.immediateTodos.filter((t) => !t.done).map((t) => t.text),
    };
  });

  const constraints = userGraph.constraints
    .slice(0, 15)
    .map((c) => `- ${c.instruction}`)
    .join("\n");

  return `\nPRIOR USER & PROJECT UNDERSTANDING (TRIANGULATE AGAINST THIS!):
- User Profile: ${userGraph.profile.roleAndAffiliation} | Domains: ${
    userGraph.profile.activeDomains || "Not set"
  } | Priorities: ${userGraph.profile.currentPriorities || "Not set"}
- Active Strivings: ${
    userGraph.strivings.map((s) => s.title).join("; ") || "(None yet)"
  }
- Active Projects (Task Models & Current Calendar Allocation):
${
  projectsSummary.length > 0
    ? JSON.stringify(projectsSummary, null, 2)
    : "(No projects tracked yet)"
}
${constraints ? `- Hard User Edit Constraints:\n${constraints}` : ""}`;
}

export async function analyzeScreenshotWithGemma4(params: {
  imageDataUrl: string;
  model: string;
  appName: string;
  windowTitle: string;
  todayDateKey: string;
  existingBlocks?: CalendarBlock[];
  userGraph?: UserModelGraph;
  rules: StandingRule[];
  settings?: OrganizerSettings;
  device: "macbook" | "android";
  valenHint?: {
    intentChoice: string;
    urgencyScore: number;
    signalProbability: number;
    bboxCropped: boolean;
  };
}): Promise<{
  ok: boolean;
  signal?: ExtractedCaptureSignal;
  rawObservation?: string;
  modelUsed: string;
  latencyMs: number;
  error?: string;
}> {
  const {
    imageDataUrl,
    model,
    appName,
    windowTitle,
    todayDateKey,
    existingBlocks = [],
    userGraph,
    rules,
    settings,
    device,
    valenHint,
  } = params;
  const t0 = performance.now();

  const base64Image = imageDataUrl.includes(",")
    ? imageDataUrl.split(",")[1]
    : "";
  if (!base64Image) {
    return {
      ok: false,
      modelUsed: model,
      latencyMs: 0,
      error: "Empty screenshot image payload.",
    };
  }

  const rulesList = rules
    .filter((r) => r.enabled)
    .map((r) => `- ${r.title}: ${r.description}`)
    .join("\n");

  const calContext =
    existingBlocks.length > 0 && settings
      ? `\nUser's Upcoming Calendar & Free Slots:\n${buildCompactCalendarContextText(
          existingBlocks,
          todayDateKey,
          rules,
          settings
        )}`
      : "";

  const stage1Context = valenHint
    ? `\nStage-1 Valen Gatekeeper: p(actionable)=${valenHint.signalProbability.toFixed(
        2
      )}, intent="${valenHint.intentChoice}", urgency=${valenHint.urgencyScore.toFixed(
        1
      )}/3.`
    : "";

  const priorUnderstanding = buildPriorUnderstandingPromptBlock(
    userGraph,
    existingBlocks
  );

  const prompt = `You are Dayframe's Gemma 4 multimodal executive assistant running offline on the user's MacBook.
Today's local date is ${todayDateKey}.
Source window: "${appName}" — "${windowTitle}" (${device}).${stage1Context}${calContext}${priorUnderstanding}

Read the visible text in this screenshot carefully and TRIANGULATE it against both the user's Upcoming Calendar AND their Active Projects / Prior Understanding above!

STRICT TRIANGULATION & ANTI-NOISE RULES:
1. DO NOT generate random one-off tasks from fleeting browsing, reading docs/code, casual chat, or chores!
2. Check if what's on screen belongs to one of the user's Active Projects above ("matchedTaskModelId"). If that Project ALREADY has sufficient "alreadyScheduledUpcomingMinutes" on the calendar and no brand-new deadline or separate deliverable is requested, set "hasActionableItem": false (just summarize what progress/evidence was observed in "summary" so the project log updates without duplicating calendar blocks!).
3. Set "hasActionableItem": true ONLY when there is a concrete unscheduled deliverable, review, reply, deadline, or informal meeting mention corroborated by Slack/email/project context. Populate "matchedTaskModelId" (if matching an Active Project) and list the connected signals in "triangulationSources" (e.g. ["Project: AIIM Fellowship", "Slack #funding"]).
4. Set "needsUserConfirmation": true whenever timing, duration, or whether to add a new block benefits from confirmation.

Standing Rules:
${rulesList}

Return ONLY valid JSON:
{
  "hasActionableItem": boolean,
  "title": string,
  "summary": string,
  "contextEvidence": string,
  "matchedTaskModelId": string | null,
  "triangulationSources": string[],
  "detectedKind": "meeting" | "deep-work" | "follow-up",
  "estimatedMinutes": number,
  "proposedDateKey": string | null,
  "proposedStartMinutes": number | null,
  "linkedMeetingId": string | null,
  "isRecurringMention": boolean,
  "isSoloInvite": boolean,
  "locationOrUrl": string | null,
  "fingerprintKey": string,
  "confidence": number,
  "needsUserConfirmation": boolean,
  "clarifyingQuestion": string,
  "uncertaintyReason": string
}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);

    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: "90s",
        format: "json",
        messages: [
          {
            role: "user",
            images: [base64Image],
            content: prompt,
          },
        ],
      }),
    });
    clearTimeout(timer);

    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) {
      return {
        ok: false,
        modelUsed: model,
        latencyMs,
        error: `Local Ollama HTTP ${res.status}`,
      };
    }

    const body = (await res.json()) as { message?: { content?: string } };
    const parsed = JSON.parse(body.message?.content ?? "{}") as Partial<
      ExtractedCaptureSignal
    >;

    const rawConf = Number(parsed.confidence);
    const confidence = Number.isFinite(rawConf)
      ? Math.max(0.1, Math.min(0.99, rawConf))
      : 0.78;

    const evidence = parsed.contextEvidence
      ? String(parsed.contextEvidence).slice(0, 260)
      : undefined;

    return {
      ok: true,
      modelUsed: model,
      latencyMs,
      rawObservation: evidence || String(parsed.summary || ""),
      signal: {
        hasActionableItem: Boolean(parsed.hasActionableItem),
        title: String(parsed.title || "Captured calendar block").slice(0, 120),
        summary: String(parsed.summary || "Analyzed offline by Gemma 4").slice(
          0,
          280
        ),
        contextEvidence: evidence,
        detectedKind:
          parsed.detectedKind === "meeting" ||
          parsed.detectedKind === "follow-up"
            ? parsed.detectedKind
            : "deep-work",
        estimatedMinutes: Math.max(
          15,
          Math.min(
            180,
            Math.round((Number(parsed.estimatedMinutes) || 45) / 15) * 15
          )
        ),
        proposedDateKey:
          typeof parsed.proposedDateKey === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(parsed.proposedDateKey)
            ? parsed.proposedDateKey
            : undefined,
        proposedStartMinutes:
          typeof parsed.proposedStartMinutes === "number"
            ? parsed.proposedStartMinutes
            : undefined,
        linkedMeetingId:
          typeof parsed.linkedMeetingId === "string" && parsed.linkedMeetingId
            ? parsed.linkedMeetingId
            : undefined,
        matchedTaskModelId:
          typeof parsed.matchedTaskModelId === "string" &&
          parsed.matchedTaskModelId
            ? parsed.matchedTaskModelId
            : undefined,
        triangulationSources: Array.isArray(parsed.triangulationSources)
          ? parsed.triangulationSources.map((s) => String(s)).slice(0, 4)
          : undefined,
        isRecurringMention: Boolean(parsed.isRecurringMention),
        isSoloInvite: Boolean(parsed.isSoloInvite),
        locationOrUrl: parsed.locationOrUrl
          ? String(parsed.locationOrUrl)
          : undefined,
        fingerprintKey: parsed.fingerprintKey
          ? String(parsed.fingerprintKey)
          : undefined,
        confidence,
        needsUserConfirmation:
          parsed.needsUserConfirmation !== undefined
            ? Boolean(parsed.needsUserConfirmation)
            : confidence < 0.88,
        clarifyingQuestion: parsed.clarifyingQuestion
          ? String(parsed.clarifyingQuestion).slice(0, 240)
          : undefined,
        uncertaintyReason: parsed.uncertaintyReason
          ? String(parsed.uncertaintyReason).slice(0, 100)
          : undefined,
      },
    };
  } catch (err) {
    return {
      ok: false,
      modelUsed: model,
      latencyMs: Math.round(performance.now() - t0),
      error:
        err instanceof Error
          ? err.message
          : "Local Gemma 4 is currently sleeping — queued for next batch.",
    };
  }
}

export interface HolisticPrepProposal {
  meetingId: string;
  prepTitle: string;
  prepMinutes: number;
  contextEvidence: string;
  contextSources: string[];
  confidence: number;
  askUser: boolean;
  clarifyingQuestion: string;
}

export interface HolisticActionProposal {
  signal: ExtractedCaptureSignal;
  sourceLabel: string;
  contextSources: string[];
}

/**
 * Holistic System-2 Planner: Reasons jointly across the user's 7-day Calendar
 * (attendees, organizer, video links, agenda notes, open gaps), live Slack/Window
 * observations, and Apple Mail messages.
 *
 * NEVER proposes prep for personal chores, 0-attendee reminders, workouts, meals,
 * or trivial check-ins. Every output block must be grounded in specific context.
 */
export async function planHolisticCalendarWithGemma4(params: {
  model: string;
  todayDateKey: string;
  allCalendarBlocks: CalendarBlock[];
  userGraph?: UserModelGraph;
  emails: ScannedEmailItem[];
  windowObservations: Array<{
    source: string;
    detail: string;
  }>;
  rules: StandingRule[];
  settings: OrganizerSettings;
}): Promise<{
  ok: boolean;
  prepProposals: HolisticPrepProposal[];
  actionProposals: HolisticActionProposal[];
  latencyMs: number;
  error?: string;
}> {
  const {
    model,
    todayDateKey,
    allCalendarBlocks,
    userGraph,
    emails,
    windowObservations,
    rules,
    settings,
  } = params;
  const t0 = performance.now();

  const eligibleMeetings = allCalendarBlocks.filter(
    isEligibleRealMeetingForPrep
  );

  if (
    eligibleMeetings.length === 0 &&
    emails.length === 0 &&
    windowObservations.length === 0
  ) {
    return {
      ok: true,
      prepProposals: [],
      actionProposals: [],
      latencyMs: 0,
    };
  }

  const compactMeetings = eligibleMeetings.slice(0, 25).map((m) => ({
    meetingId: m.id,
    title: m.title,
    date: m.dateKey,
    startTime: formatMinutesToTime(m.startMinutes),
    durationMinutes: m.durationMinutes,
    isRecurring: Boolean(m.isRecurring),
    attendeeCount: m.attendeeCount ?? 0,
    attendees: (m.attendeeNames ?? []).slice(0, 6),
    organizer: m.organizerName || undefined,
    hasVideoLink: Boolean(m.hasVideoLink),
    calendar: m.calendarTitle,
    agendaOrNotes: m.notes ? m.notes.slice(0, 350) : "",
  }));

  const compactEmails = emails.slice(0, 12).map((e) => ({
    id: e.id,
    from: e.sender,
    subject: e.subject,
    snippet: e.snippet.slice(0, 350),
  }));

  const rulesSummary = rules
    .filter((r) => r.enabled)
    .map((r) => `- [${r.category}] ${r.title}: ${r.description}`)
    .join("\n");

  const scheduleOverview = buildCompactCalendarContextText(
    allCalendarBlocks,
    todayDateKey,
    rules,
    settings
  );

  const prompt = `You are Dayframe's local Gemma 4 executive calendar strategist.
Today's date is ${todayDateKey}.

You have the user's FULL context across:
1. Eligible Interpersonal Meetings on their Calendar (already pre-filtered, but you MUST still apply strict common sense!):
${JSON.stringify(compactMeetings, null, 2)}

2. Full 5-Day Schedule & Open Free Slots:
${scheduleOverview}

3. Recent Slack & Open Window Observations on their MacBook:
${
  windowObservations.length > 0
    ? JSON.stringify(windowObservations, null, 2)
    : "(No open Slack/Mail windows captured in this pass)"
}

4. Apple Mail Inbox Messages:
${compactEmails.length > 0 ? JSON.stringify(compactEmails, null, 2) : "(None)"}

5. User's Standing Rules & Past Preferences:
${rulesSummary}
${buildPriorUnderstandingPromptBlock(userGraph, allCalendarBlocks)}

YOUR JOB — TRIANGULATE ACROSS PRIOR PROJECTS, CALENDAR, SLACK & MAIL (ZERO RANDOM SPAM):
A. "prepProposals": Inspect each meeting in (1) alongside Slack (3) and Mail (4).
   - ONLY propose prep for meetings where a thoughtful professional/researcher ACTUALLY needs advance preparation (e.g., presenting, interviewing, board/advisor/committee/client review, 1:1 with agenda/deliverables, design/architecture critique, or a meeting referenced in Slack/Mail).
   - DO NOT propose prep for casual coffee chats, daily standups, social events, passive all-hands, workouts, chores, errands, or any event where prep would be silly or unnecessary! When in doubt whether prep is genuinely useful, SKIP IT rather than spamming dumb prep blocks.
   - Make "prepTitle" specific to the meeting's topic/agenda (e.g., "Review Q4 latency metrics for Eng Sync", NOT generic "Prep: Meeting"), size "prepMinutes" realistically (15, 30, 45, 60, or 90), and explain the concrete reason in "contextEvidence" (citing attendees, agenda notes, or Slack/Mail context).

B. "actionProposals": Inspect Slack observations (3) and Mail messages (4).
   - Extract ONLY real, concrete tasks/reviews/deliverables directed at the user OR informal meeting mentions not yet on the calendar (isSoloInvite=true).
   - Ignore newsletters, automated receipts, GitHub/CI spam, marketing emails, and casual Slack chatter.
   - Cite the exact Slack channel/person or email sender/subject in "sourceLabel" and "contextEvidence".

Return ONLY valid JSON with this exact structure:
{
  "prepProposals": [
    {
      "meetingId": string,
      "prepTitle": string,
      "prepMinutes": number,
      "contextEvidence": string,
      "contextSources": string[],
      "confidence": number,
      "askUser": boolean,
      "clarifyingQuestion": string
    }
  ],
  "actionProposals": [
    {
      "title": string,
      "summary": string,
      "contextEvidence": string,
      "sourceLabel": string,
      "detectedKind": "meeting" | "deep-work" | "follow-up",
      "estimatedMinutes": number,
      "proposedDateKey": string | null,
      "proposedStartMinutes": number | null,
      "linkedMeetingId": string | null,
      "isSoloInvite": boolean,
      "confidence": number,
      "askUser": boolean,
      "clarifyingQuestion": string
    }
  ]
}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 50000);
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: "90s",
        format: "json",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    clearTimeout(timer);

    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) {
      return {
        ok: false,
        prepProposals: [],
        actionProposals: [],
        latencyMs,
        error: `Local Gemma 4 planner returned HTTP ${res.status}.`,
      };
    }

    const body = (await res.json()) as { message?: { content?: string } };
    const parsed = JSON.parse(body.message?.content ?? "{}") as {
      prepProposals?: Array<Record<string, unknown>>;
      actionProposals?: Array<Record<string, unknown>>;
    };

    const validMeetingIds = new Set(eligibleMeetings.map((m) => m.id));

    const prepProposals: HolisticPrepProposal[] = (parsed.prepProposals ?? [])
      .filter(
        (p) =>
          typeof p.meetingId === "string" &&
          validMeetingIds.has(p.meetingId) &&
          Number(p.prepMinutes || 0) >= 15
      )
      .map((p) => {
        const rawConf = Number(p.confidence);
        return {
          meetingId: String(p.meetingId),
          prepTitle: String(p.prepTitle || "Meeting prep").slice(0, 120),
          prepMinutes: Math.max(
            15,
            Math.min(
              120,
              Math.round((Number(p.prepMinutes) || 30) / 15) * 15
            )
          ),
          contextEvidence: String(
            p.contextEvidence || "Identified by Gemma 4 from meeting context."
          ).slice(0, 280),
          contextSources: Array.isArray(p.contextSources)
            ? p.contextSources.map((s) => String(s)).slice(0, 4)
            : ["Calendar + Gemma 4"],
          confidence: Number.isFinite(rawConf)
            ? Math.max(0.2, Math.min(0.99, rawConf))
            : 0.8,
          askUser: p.askUser !== undefined ? Boolean(p.askUser) : true,
          clarifyingQuestion: String(p.clarifyingQuestion || "").slice(0, 240),
        };
      });

    const actionProposals: HolisticActionProposal[] = (
      parsed.actionProposals ?? []
    )
      .filter((a) => typeof a.title === "string" && a.title.trim().length > 2)
      .map((a) => {
        const rawConf = Number(a.confidence);
        const conf = Number.isFinite(rawConf)
          ? Math.max(0.2, Math.min(0.99, rawConf))
          : 0.78;
        const src = String(a.sourceLabel || "Slack / Mail Scan").slice(0, 90);
        const evidence = String(a.contextEvidence || a.summary || "").slice(
          0,
          260
        );
        return {
          sourceLabel: src,
          contextSources: [src],
          signal: {
            hasActionableItem: true,
            title: String(a.title).slice(0, 120),
            summary: String(a.summary || evidence).slice(0, 260),
            contextEvidence: evidence,
            detectedKind:
              a.detectedKind === "meeting" || a.detectedKind === "follow-up"
                ? (a.detectedKind as "meeting" | "follow-up")
                : ("deep-work" as const),
            estimatedMinutes: Math.max(
              15,
              Math.min(
                180,
                Math.round((Number(a.estimatedMinutes) || 45) / 15) * 15
              )
            ),
            proposedDateKey:
              typeof a.proposedDateKey === "string" &&
              /^\d{4}-\d{2}-\d{2}$/.test(a.proposedDateKey)
                ? a.proposedDateKey
                : undefined,
            proposedStartMinutes:
              typeof a.proposedStartMinutes === "number"
                ? a.proposedStartMinutes
                : undefined,
            linkedMeetingId:
              typeof a.linkedMeetingId === "string" && a.linkedMeetingId
                ? a.linkedMeetingId
                : undefined,
            isSoloInvite: Boolean(a.isSoloInvite),
            fingerprintKey: `holistic-${String(a.title).toLowerCase().slice(0, 40)}`,
            confidence: conf,
            needsUserConfirmation:
              a.askUser !== undefined ? Boolean(a.askUser) : true,
            clarifyingQuestion: a.clarifyingQuestion
              ? String(a.clarifyingQuestion).slice(0, 240)
              : undefined,
            uncertaintyReason: src,
          },
        };
      });

    return {
      ok: true,
      prepProposals,
      actionProposals,
      latencyMs,
    };
  } catch (err) {
    return {
      ok: false,
      prepProposals: [],
      actionProposals: [],
      latencyMs: Math.round(performance.now() - t0),
      error:
        err instanceof Error
          ? err.message
          : "Failed calling local Gemma 4 holistic planner.",
    };
  }
}

export async function decomposeGoalWithGemma4(params: {
  model: string;
  goalTitle: string;
  segmentCount: number;
  deadlineDateKey?: string;
}): Promise<{ ok: boolean; milestones: string[]; latencyMs: number }> {
  const { model, goalTitle, segmentCount, deadlineDateKey } = params;
  const t0 = performance.now();
  if (segmentCount <= 1) {
    return { ok: true, milestones: [goalTitle], latencyMs: 0 };
  }

  const prompt = `You are Dayframe's offline local Gemma 4 time-blocking strategist.
Break this longstanding project/goal into exactly ${segmentCount} concrete, sequential 60-90 minute calendar session titles${
    deadlineDateKey ? ` (backtracked before deadline ${deadlineDateKey})` : ""
  }:
Goal: "${goalTitle}"

Rules:
- Session 1 MUST be a concrete scoping/planning/outline block ("Scope & outline requirements").
- Middle sessions must be specific execution steps (no vague filler).
- Final session must be review, polish, and buffer before submission.
- Keep each label concise (3 to 7 words, without numbering prefixes).

Return ONLY valid JSON:
{
  "milestones": string[]
}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: 0,
        format: "json",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) return { ok: false, milestones: [], latencyMs };
    const body = (await res.json()) as { message?: { content?: string } };
    const parsed = JSON.parse(body.message?.content ?? "{}") as {
      milestones?: unknown[];
    };
    const milestones = Array.isArray(parsed.milestones)
      ? parsed.milestones
          .map((m) => String(m || "").trim().slice(0, 70))
          .filter(Boolean)
          .slice(0, segmentCount)
      : [];
    return { ok: milestones.length > 0, milestones, latencyMs };
  } catch {
    return {
      ok: false,
      milestones: [],
      latencyMs: Math.round(performance.now() - t0),
    };
  }
}

export async function chatAndEnrichEventWithGemma4(params: {
  model: string;
  event: CalendarBlock;
  userPrompt: string;
  matchedEmails: ScannedEmailItem[];
  matchedCaptures: Array<{ app: string; title: string; summary: string }>;
  localPapers: LocalPaperHit[];
  userGraph: UserModelGraph;
}): Promise<{
  ok: boolean;
  reply: string;
  contextDigest?: string;
  immediateTodos: string[];
  suggestedPapers: Array<{ title: string; authorsOrVenue?: string }>;
  latencyMs: number;
}> {
  const {
    model,
    event,
    userPrompt,
    matchedEmails,
    matchedCaptures,
    localPapers,
    userGraph,
  } = params;
  const t0 = performance.now();

  const prompt = `You are Dayframe's offline Gemma 4 co-pilot embedded inside a specific calendar event on the user's MacBook.

User Profile:
- Role: ${userGraph.profile.roleAndAffiliation}
- Domains: ${userGraph.profile.activeDomains || "Research & engineering"}
- Priorities: ${userGraph.profile.currentPriorities || "Not specified"}

Target Calendar Event:
- Title: "${event.title}"
- Date & Time: ${event.dateKey} at ${formatMinutesToTime(event.startMinutes)} (${formatDuration(event.durationMinutes)})
- Attendees: ${(event.attendeeNames ?? []).join(", ") || "Solo / None"}
- Existing Notes: ${event.notes || event.rationale || "(None)"}
- Existing Checklist: ${(event.subtasks ?? []).map((t) => t.text).join("; ") || "(None)"}

Matched Local Emails:
${matchedEmails.length > 0 ? JSON.stringify(matchedEmails.map((m) => ({ from: m.sender, subject: m.subject, snippet: m.snippet.slice(0, 320) })), null, 2) : "(No matching Apple Mail messages found)"}

Matched Slack / App Captures:
${matchedCaptures.length > 0 ? JSON.stringify(matchedCaptures, null, 2) : "(None)"}

Matched Local PDFs on Mac:
${localPapers.length > 0 ? JSON.stringify(localPapers.map((p) => ({ title: p.title, filename: p.filename })), null, 2) : "(None)"}

User's Request in Event Chat:
"${userPrompt}"

Respond directly and concretely (no filler). Extract concrete immediate action items ("immediateTodos") grounded in the emails/captures/request, summarize any useful background context ("contextDigest"), and suggest relevant academic papers or documents ("suggestedPapers") when helpful or requested.

Return ONLY valid JSON:
{
  "reply": string,
  "contextDigest": string,
  "immediateTodos": string[],
  "suggestedPapers": [{ "title": string, "authorsOrVenue": string }]
}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: 0,
        format: "json",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) {
      return {
        ok: false,
        reply: `Local Gemma 4 returned HTTP ${res.status}.`,
        immediateTodos: [],
        suggestedPapers: [],
        latencyMs,
      };
    }

    const body = (await res.json()) as { message?: { content?: string } };
    const parsed = JSON.parse(body.message?.content ?? "{}") as {
      reply?: string;
      contextDigest?: string;
      immediateTodos?: unknown[];
      suggestedPapers?: Array<{ title?: string; authorsOrVenue?: string }>;
    };

    return {
      ok: true,
      reply: String(parsed.reply || "Updated event context.").slice(0, 600),
      contextDigest: parsed.contextDigest
        ? String(parsed.contextDigest).slice(0, 500)
        : undefined,
      immediateTodos: Array.isArray(parsed.immediateTodos)
        ? parsed.immediateTodos
            .map((t) => String(t || "").trim().slice(0, 120))
            .filter(Boolean)
            .slice(0, 6)
        : [],
      suggestedPapers: Array.isArray(parsed.suggestedPapers)
        ? parsed.suggestedPapers
            .filter((p) => p && typeof p.title === "string" && p.title.trim())
            .map((p) => ({
              title: String(p.title).trim().slice(0, 140),
              authorsOrVenue: p.authorsOrVenue
                ? String(p.authorsOrVenue).trim().slice(0, 90)
                : undefined,
            }))
            .slice(0, 5)
        : [],
      latencyMs,
    };
  } catch (err) {
    return {
      ok: false,
      reply:
        err instanceof Error
          ? err.message
          : "Could not reach local Gemma 4 on 127.0.0.1:11434.",
      immediateTodos: [],
      suggestedPapers: [],
      latencyMs: Math.round(performance.now() - t0),
    };
  }
}

/**
 * Tempo-inspired Hierarchical Induction (StanfordHCI/striving-cocreation):
 * Synthesizes observed calendar blocks, Slack/app captures, and emails into
 * Task-Specific Models (Activities) and Personal Strivings, strictly respecting
 * [user-edited], [user-merged], [user-reassigned], and [user-removed] constraints.
 */
export async function induceUserAndTaskModelsWithGemma4(params: {
  model: string;
  currentGraph: UserModelGraph;
  blocks: CalendarBlock[];
  captures: Array<{ app: string; title: string; summary: string }>;
  emails: ScannedEmailItem[];
}): Promise<{
  ok: boolean;
  strivings: Array<{
    title: string;
    domain: StrivingNode["domain"];
    description: string;
    confidence: number;
  }>;
  taskModels: Array<{
    canonicalTitle: string;
    keywords: string[];
    parentStrivingTitle: string;
    summary: string;
    typicalSessionMinutes: number;
    immediateTodos: string[];
  }>;
  latencyMs: number;
}> {
  const { model, currentGraph, blocks, captures, emails } = params;
  const t0 = performance.now();

  const constraintText =
    currentGraph.constraints.length > 0
      ? currentGraph.constraints.map((c) => `- ${c.instruction}`).join("\n")
      : "(No user edit constraints yet)";

  const lockedStrivings = currentGraph.strivings
    .filter((s) => s.userEdited)
    .map((s) => s.title);
  const lockedTaskModels = currentGraph.taskModels
    .filter((m) => m.userEdited)
    .map((m) => m.canonicalTitle);

  const calendarSample = blocks
    .filter((b) => !b.occupiesTimeOnly)
    .slice(0, 30)
    .map((b) => ({
      title: b.title,
      kind: b.kind,
      duration: b.durationMinutes,
      attendees: b.attendeeCount ?? 0,
      notes: b.notes ? b.notes.slice(0, 140) : undefined,
    }));

  const prompt = `You are Dayframe's hierarchical user & task modeler, grounded in Activity Theory and Emmons' personal strivings framework (following Tempo / striving co-creation).

User Self-Context:
- Role: ${currentGraph.profile.roleAndAffiliation}
- Domains: ${currentGraph.profile.activeDomains}
- Working Style: ${currentGraph.profile.workingStyleNotes}
- Current Priorities: ${currentGraph.profile.currentPriorities}

HARD USER CONSTRAINTS (NEVER VIOLATE):
${constraintText}
Locked [user-edited] Strivings (keep verbatim): ${JSON.stringify(lockedStrivings)}
Locked [user-edited] Task Models (keep verbatim): ${JSON.stringify(lockedTaskModels)}

Observed Evidence Across Applications:
1. Calendar Events & Scheduled Blocks:
${JSON.stringify(calendarSample)}

2. Slack & Screen Captures:
${JSON.stringify(captures.slice(0, 15))}

3. Recent Emails:
${JSON.stringify(emails.slice(0, 10).map((e) => ({ subject: e.subject, from: e.sender, snippet: e.snippet.slice(0, 180) })))}

Construct a two-tier abstraction connecting cross-app evidence:
1. "strivings" (2 to 5 ongoing personal/professional pursuits that explain WHY the user is doing these activities — neither vague platitudes nor one-off tasks).
2. "taskModels" (specific ongoing projects, fellowships, papers, collaborations, or courses — with clean standard names like "AIIM Fellowship" or "UIST Submission", 2-5 lowercase matching keywords, which striving they serve, a concise status summary synthesized across apps, typical focus block length in minutes, and 1-3 concrete immediate next steps).

Return ONLY valid JSON:
{
  "strivings": [
    {
      "title": string,
      "domain": "research" | "funding-career" | "collaboration" | "teaching-service" | "personal-grounding",
      "description": string,
      "confidence": number
    }
  ],
  "taskModels": [
    {
      "canonicalTitle": string,
      "keywords": string[],
      "parentStrivingTitle": string,
      "summary": string,
      "typicalSessionMinutes": number,
      "immediateTodos": string[]
    }
  ]
}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: 0,
        format: "json",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) {
      return { ok: false, strivings: [], taskModels: [], latencyMs };
    }

    const body = (await res.json()) as { message?: { content?: string } };
    const parsed = JSON.parse(body.message?.content ?? "{}") as {
      strivings?: Array<Record<string, unknown>>;
      taskModels?: Array<Record<string, unknown>>;
    };

    const allowedDomains = new Set([
      "research",
      "funding-career",
      "collaboration",
      "teaching-service",
      "personal-grounding",
    ]);

    const strivings = (parsed.strivings ?? [])
      .filter((s) => typeof s.title === "string" && s.title.trim())
      .slice(0, 5)
      .map((s) => ({
        title: String(s.title).trim().slice(0, 140),
        domain: allowedDomains.has(String(s.domain))
          ? (String(s.domain) as StrivingNode["domain"])
          : ("research" as const),
        description: String(s.description || "").trim().slice(0, 240),
        confidence: Math.max(0.3, Math.min(0.99, Number(s.confidence) || 0.8)),
      }));

    const taskModels = (parsed.taskModels ?? [])
      .filter(
        (m) => typeof m.canonicalTitle === "string" && m.canonicalTitle.trim()
      )
      .slice(0, 12)
      .map((m) => ({
        canonicalTitle: String(m.canonicalTitle).trim().slice(0, 90),
        keywords: Array.isArray(m.keywords)
          ? m.keywords
              .map((k) => String(k || "").toLowerCase().trim())
              .filter((k) => k.length >= 2)
              .slice(0, 6)
          : [],
        parentStrivingTitle: String(m.parentStrivingTitle || "").trim(),
        summary: String(m.summary || "").trim().slice(0, 260),
        typicalSessionMinutes: Math.max(
          30,
          Math.min(
            120,
            Math.round((Number(m.typicalSessionMinutes) || 60) / 15) * 15
          )
        ),
        immediateTodos: Array.isArray(m.immediateTodos)
          ? m.immediateTodos
              .map((t) => String(t || "").trim().slice(0, 120))
              .filter(Boolean)
              .slice(0, 4)
          : [],
      }));

    return { ok: true, strivings, taskModels, latencyMs };
  } catch {
    return {
      ok: false,
      strivings: [],
      taskModels: [],
      latencyMs: Math.round(performance.now() - t0),
    };
  }
}

function buildUpcomingDateReference(todayDateKey: string, days = 21): string {
  const entries: string[] = [];
  for (let d = 0; d < days; d++) {
    const dk = addDaysToDateKey(todayDateKey, d);
    const [y, m, day] = dk.split("-").map(Number);
    const dt = new Date(y, (m || 1) - 1, day || 1, 12, 0, 0, 0);
    const dow = dt.toLocaleDateString("en-US", { weekday: "short" });
    entries.push(`${dk}(${dow})`);
  }
  return entries.join(", ");
}

/**
 * Model-First NL Schedule Compiler:
 * Compiles open-ended natural-language scheduling requests (e.g., "aiim fellowship. 2 hours each week
 * for the next two weeks", "1h Tuesday morning and 90m Thursday afternoon on CHI rebuttal",
 * "prepare fellowship statement by Dec 5") into canonical naming + exact window-bounded sessions,
 * without relying on enumerating brittle regexes.
 */
export async function compileNaturalScheduleWithGemma4(params: {
  model: string;
  rawInput: string;
  fallbackGutMinutes: number;
  applyMultiplier: boolean;
  calibrationMultiplier: number;
  explicitDeadlineDateKey?: string;
  todayDateKey: string;
  userGraph: UserModelGraph;
  matchedEmails: ScannedEmailItem[];
  localPapers: LocalPaperHit[];
  valenIntentHint?: string;
}): Promise<{
  ok: boolean;
  canonicalTitle: string;
  matchedTaskModelId: string | null;
  cadenceNote?: string;
  deadlineDateKey?: string;
  immediateSubtasks: string[];
  sessions: Array<{
    sessionTitle: string;
    durationMinutes: number;
    earliestDateKey: string;
    latestDateKey: string;
    preferredTimeOfDay: "morning" | "afternoon" | "any";
  }>;
  latencyMs: number;
}> {
  const {
    model,
    rawInput,
    fallbackGutMinutes,
    applyMultiplier,
    calibrationMultiplier,
    explicitDeadlineDateKey,
    todayDateKey,
    userGraph,
    matchedEmails,
    localPapers,
    valenIntentHint,
  } = params;
  const t0 = performance.now();

  const dateMap = buildUpcomingDateReference(todayDateKey, 28);
  const existingModels = userGraph.taskModels.slice(0, 12).map((m) => ({
    id: m.id,
    canonicalTitle: m.canonicalTitle,
    userEdited: Boolean(m.userEdited),
    summary: m.summary,
  }));

  const prompt = `You are Dayframe's structured natural-language calendar compiler running locally on macOS.
Today is ${todayDateKey}. Upcoming calendar reference:
${dateMap}

User Profile: ${userGraph.profile.roleAndAffiliation} | ${userGraph.profile.activeDomains}
Existing Task-Specific Models (reuse exact canonicalTitle and id if this request belongs to one!):
${JSON.stringify(existingModels)}
${valenIntentHint ? `Stage-1 Valen Router Hint: ${valenIntentHint}` : ""}

Matched Local Emails:
${JSON.stringify(matchedEmails.slice(0, 3).map((e) => ({ subject: e.subject, from: e.sender, snippet: e.snippet.slice(0, 220) })))}
Matched Local PDFs:
${JSON.stringify(localPapers.slice(0, 4).map((p) => p.title))}

User's Raw Input:
"${rawInput}"
Fallback duration if user did NOT state any duration in text: ${fallbackGutMinutes} minutes.
Explicit deadline picker (if set): ${explicitDeadlineDateKey || "none"}.
Calibration multiplier (apply ONLY when user gives a rough total estimate rather than explicit block sizes like "two 1-hour blocks" or "2 hours each week"): ×${applyMultiplier ? calibrationMultiplier : 1}.

Compile the user's request into a clean canonical project/task name and concrete 30-90 minute calendar sessions:
1. "canonicalTitle": Standard, concise title stripped of scheduling phrasing (e.g., "aiim fellowship. 2 hours each week for the next two weeks." -> "AIIM Fellowship", preserving acronyms like AIIM, NSF, CHI, UIST, ICML, NeurIPS, PhD, UMich). NEVER copy scheduling instructions into the title!
2. "sessions":
   - If the user asks for weekly cadence (e.g., "2 hours each week for the next 2 weeks"), emit sessions in Week 1 [today..today+6] and Week 2 [today+7..today+13] (splitting >90m/week into 60-90m blocks, e.g., "AIIM Fellowship — Wk 1 (1/2)").
   - If the user names specific days/times of day (e.g., "Tuesday morning and Thursday afternoon"), set earliestDateKey=latestDateKey to those exact YYYY-MM-DD dates from the calendar reference above!
   - If it is a multi-hour deadline project (>=3h total), start Session 1 as scoping/planning and backtrack before the deadline.
   - If it is a single task, emit 1 session with [todayDateKey .. latestDateKey].
3. "immediateSubtasks": Extract 1-3 concrete immediate action items if matched emails/input reveal next steps (otherwise []).

Return ONLY valid JSON:
{
  "canonicalTitle": string,
  "matchedTaskModelId": string | null,
  "cadenceNote": string | null,
  "deadlineDateKey": string | null,
  "immediateSubtasks": string[],
  "sessions": [
    {
      "sessionTitle": string,
      "durationMinutes": number,
      "earliestDateKey": string,
      "latestDateKey": string,
      "preferredTimeOfDay": "morning" | "afternoon" | "any"
    }
  ]
}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: 0,
        format: "json",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) {
      return {
        ok: false,
        canonicalTitle: "",
        matchedTaskModelId: null,
        immediateSubtasks: [],
        sessions: [],
        latencyMs,
      };
    }

    const body = (await res.json()) as { message?: { content?: string } };
    const parsed = JSON.parse(body.message?.content ?? "{}") as {
      canonicalTitle?: string;
      matchedTaskModelId?: string | null;
      cadenceNote?: string | null;
      deadlineDateKey?: string | null;
      immediateSubtasks?: unknown[];
      sessions?: Array<Record<string, unknown>>;
    };

    const canonicalTitle = String(parsed.canonicalTitle || "").trim();
    const sessions = (parsed.sessions ?? [])
      .filter((s) => Number(s.durationMinutes || 0) >= 15)
      .slice(0, 24)
      .map((s) => ({
        sessionTitle:
          String(s.sessionTitle || canonicalTitle || "Focus Session")
            .trim()
            .slice(0, 110),
        durationMinutes: Math.max(
          15,
          Math.min(
            180,
            Math.round((Number(s.durationMinutes) || 60) / 15) * 15
          )
        ),
        earliestDateKey:
          typeof s.earliestDateKey === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(s.earliestDateKey)
            ? s.earliestDateKey
            : todayDateKey,
        latestDateKey:
          typeof s.latestDateKey === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(s.latestDateKey)
            ? s.latestDateKey
            : explicitDeadlineDateKey || addDaysToDateKey(todayDateKey, 14),
        preferredTimeOfDay:
          s.preferredTimeOfDay === "morning" ||
          s.preferredTimeOfDay === "afternoon"
            ? (s.preferredTimeOfDay as "morning" | "afternoon")
            : ("any" as const),
      }));

    if (!canonicalTitle || sessions.length === 0) {
      return {
        ok: false,
        canonicalTitle: "",
        matchedTaskModelId: null,
        immediateSubtasks: [],
        sessions: [],
        latencyMs,
      };
    }

    return {
      ok: true,
      canonicalTitle,
      matchedTaskModelId:
        typeof parsed.matchedTaskModelId === "string" &&
        parsed.matchedTaskModelId
          ? parsed.matchedTaskModelId
          : null,
      cadenceNote: parsed.cadenceNote
        ? String(parsed.cadenceNote).slice(0, 90)
        : undefined,
      deadlineDateKey:
        typeof parsed.deadlineDateKey === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(parsed.deadlineDateKey)
          ? parsed.deadlineDateKey
          : explicitDeadlineDateKey,
      immediateSubtasks: Array.isArray(parsed.immediateSubtasks)
        ? parsed.immediateSubtasks
            .map((t) => String(t || "").trim().slice(0, 120))
            .filter(Boolean)
            .slice(0, 5)
        : [],
      sessions,
      latencyMs,
    };
  } catch {
    return {
      ok: false,
      canonicalTitle: "",
      matchedTaskModelId: null,
      immediateSubtasks: [],
      sessions: [],
      latencyMs: Math.round(performance.now() - t0),
    };
  }
}

/**
 * Unified Multi-Action Per-Event Co-Pilot Compiler:
 * Interprets arbitrary natural-language instructions inside a Calendar Event's chat
 * (e.g., "add two 1-hour blocks to prepare for this from today until the meeting, pull email context,
 * and remind me 30m before") into structured actions executed in a single pass.
 */
export async function executeEventChatTurnWithGemma4(params: {
  model: string;
  event: CalendarBlock;
  userMessage: string;
  todayDateKey: string;
  valenIntentHint?: string;
  matchedEmails: ScannedEmailItem[];
  matchedCaptures: Array<{ app: string; title: string; summary: string }>;
  localPapers: LocalPaperHit[];
  userGraph: UserModelGraph;
}): Promise<{
  ok: boolean;
  reply: string;
  renameTitleTo?: string;
  resizeMinutesTo?: number;
  moveToDateKey?: string;
  sessionsToSchedule: Array<{
    sessionTitle: string;
    durationMinutes: number;
    earliestDateKey: string;
    latestDateKey: string;
    mustFinishBeforeMinutes?: number;
    preferredTimeOfDay: "morning" | "afternoon" | "any";
    kind: "prep" | "deep-work" | "follow-up";
  }>;
  subtasksToAdd: string[];
  remindersToAdd: Array<{ text: string; leadMinutes: number }>;
  papersToAttach: Array<{
    title: string;
    authorsOrVenue?: string;
    pathOrUrl?: string;
  }>;
  notesDigestToAppend?: string;
  latencyMs: number;
}> {
  const {
    model,
    event,
    userMessage,
    todayDateKey,
    valenIntentHint,
    matchedEmails,
    matchedCaptures,
    localPapers,
    userGraph,
  } = params;
  const t0 = performance.now();
  const dateMap = buildUpcomingDateReference(todayDateKey, 21);

  const prompt = `You are Dayframe's structured Event Co-Pilot embedded inside a specific macOS calendar event.
Today is ${todayDateKey}. Upcoming dates: ${dateMap}
${valenIntentHint ? `Stage-1 Valen Intent Router: ${valenIntentHint}` : ""}

Target Calendar Event:
- Title: "${event.title}"
- Scheduled: ${event.dateKey} at ${formatMinutesToTime(event.startMinutes)} (startMinutes=${event.startMinutes}, duration=${event.durationMinutes}m)
- Attendees: ${(event.attendeeNames ?? []).join(", ") || "Solo"}
- Current Notes: ${event.notes || event.rationale || "(None)"}
- Current Todos: ${(event.subtasks ?? []).map((t) => t.text).join("; ") || "(None)"}

Matched Local Emails:
${JSON.stringify(matchedEmails.slice(0, 4).map((m) => ({ from: m.sender, subject: m.subject, snippet: m.snippet.slice(0, 280) })))}
Matched Slack / Screen Captures:
${JSON.stringify(matchedCaptures.slice(0, 5))}
Matched Local PDFs on Mac:
${JSON.stringify(localPapers.slice(0, 5).map((p) => ({ title: p.title, path: p.path })))}
User Profile: ${userGraph.profile.roleAndAffiliation} | ${userGraph.profile.activeDomains}

User's Message in Event Chat:
"${userMessage}"

Translate the user's message into concrete structured actions on or around this event:
- If the user asks to schedule prep or work blocks (e.g. "add two one-hour blocks to prepare for this anytime from today until the meeting time"), populate "sessionsToSchedule" with exact count, durationMinutes, [earliestDateKey .. latestDateKey] (set latestDateKey="${event.dateKey}" and mustFinishBeforeMinutes=${Math.max(480, event.startMinutes - 15)} when before the meeting!), and clean titles like "Prep: ${event.title} (1/2)".
- If the user asks to read context / emails / Slack / papers, synthesize key details in "notesDigestToAppend", extract concrete next actions in "subtasksToAdd", and include relevant local PDFs (preserving their exact "path" in pathOrUrl!) or scholarly papers in "papersToAttach".
- Populate "renameTitleTo", "resizeMinutesTo", "moveToDateKey", or "remindersToAdd" ONLY if requested.
- Write a direct, factual "reply" summarizing what you did or answering the user's question.

Return ONLY valid JSON:
{
  "reply": string,
  "renameTitleTo": string | null,
  "resizeMinutesTo": number | null,
  "moveToDateKey": string | null,
  "sessionsToSchedule": [
    {
      "sessionTitle": string,
      "durationMinutes": number,
      "earliestDateKey": string,
      "latestDateKey": string,
      "mustFinishBeforeMinutes": number | null,
      "preferredTimeOfDay": "morning" | "afternoon" | "any",
      "kind": "prep" | "deep-work" | "follow-up"
    }
  ],
  "subtasksToAdd": string[],
  "remindersToAdd": [{ "text": string, "leadMinutes": number }],
  "papersToAttach": [{ "title": string, "authorsOrVenue": string | null, "pathOrUrl": string | null }],
  "notesDigestToAppend": string | null
}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: 0,
        format: "json",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) {
      return {
        ok: false,
        reply: "",
        sessionsToSchedule: [],
        subtasksToAdd: [],
        remindersToAdd: [],
        papersToAttach: [],
        latencyMs,
      };
    }

    const body = (await res.json()) as { message?: { content?: string } };
    const parsed = JSON.parse(body.message?.content ?? "{}") as Record<
      string,
      unknown
    >;

    const sessionsRaw = Array.isArray(parsed.sessionsToSchedule)
      ? (parsed.sessionsToSchedule as Array<Record<string, unknown>>)
      : [];

    const sessionsToSchedule = sessionsRaw
      .filter((s) => Number(s.durationMinutes || 0) >= 15)
      .slice(0, 12)
      .map((s) => ({
        sessionTitle: String(s.sessionTitle || `Prep: ${event.title}`)
          .trim()
          .slice(0, 110),
        durationMinutes: Math.max(
          15,
          Math.min(
            180,
            Math.round((Number(s.durationMinutes) || 60) / 15) * 15
          )
        ),
        earliestDateKey:
          typeof s.earliestDateKey === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(s.earliestDateKey)
            ? s.earliestDateKey
            : todayDateKey,
        latestDateKey:
          typeof s.latestDateKey === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(s.latestDateKey)
            ? s.latestDateKey
            : event.dateKey >= todayDateKey
              ? event.dateKey
              : addDaysToDateKey(todayDateKey, 7),
        mustFinishBeforeMinutes:
          typeof s.mustFinishBeforeMinutes === "number"
            ? s.mustFinishBeforeMinutes
            : undefined,
        preferredTimeOfDay:
          s.preferredTimeOfDay === "morning" ||
          s.preferredTimeOfDay === "afternoon"
            ? (s.preferredTimeOfDay as "morning" | "afternoon")
            : ("any" as const),
        kind:
          s.kind === "deep-work" || s.kind === "follow-up"
            ? (s.kind as "deep-work" | "follow-up")
            : ("prep" as const),
      }));

    return {
      ok: true,
      reply: String(parsed.reply || "Done.").slice(0, 700),
      renameTitleTo:
        typeof parsed.renameTitleTo === "string" && parsed.renameTitleTo.trim()
          ? parsed.renameTitleTo.trim().slice(0, 120)
          : undefined,
      resizeMinutesTo:
        typeof parsed.resizeMinutesTo === "number" &&
        parsed.resizeMinutesTo >= 15
          ? Math.min(240, Math.round(parsed.resizeMinutesTo / 15) * 15)
          : undefined,
      moveToDateKey:
        typeof parsed.moveToDateKey === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(parsed.moveToDateKey)
          ? parsed.moveToDateKey
          : undefined,
      sessionsToSchedule,
      subtasksToAdd: Array.isArray(parsed.subtasksToAdd)
        ? parsed.subtasksToAdd
            .map((t) => String(t || "").trim().slice(0, 120))
            .filter(Boolean)
            .slice(0, 6)
        : [],
      remindersToAdd: Array.isArray(parsed.remindersToAdd)
        ? (parsed.remindersToAdd as Array<Record<string, unknown>>)
            .filter((r) => typeof r.text === "string" && r.text.trim())
            .map((r) => ({
              text: String(r.text).trim().slice(0, 120),
              leadMinutes: Math.max(
                5,
                Math.min(1440, Number(r.leadMinutes) || 30)
              ),
            }))
            .slice(0, 4)
        : [],
      papersToAttach: Array.isArray(parsed.papersToAttach)
        ? (parsed.papersToAttach as Array<Record<string, unknown>>)
            .filter((p) => typeof p.title === "string" && p.title.trim())
            .map((p) => ({
              title: String(p.title).trim().slice(0, 140),
              authorsOrVenue:
                typeof p.authorsOrVenue === "string" && p.authorsOrVenue.trim()
                  ? p.authorsOrVenue.trim().slice(0, 90)
                  : undefined,
              pathOrUrl:
                typeof p.pathOrUrl === "string" && p.pathOrUrl.trim()
                  ? p.pathOrUrl.trim()
                  : undefined,
            }))
            .slice(0, 6)
        : [],
      notesDigestToAppend:
        typeof parsed.notesDigestToAppend === "string" &&
        parsed.notesDigestToAppend.trim()
          ? parsed.notesDigestToAppend.trim().slice(0, 600)
          : undefined,
      latencyMs,
    };
  } catch {
    return {
      ok: false,
      reply: "",
      sessionsToSchedule: [],
      subtasksToAdd: [],
      remindersToAdd: [],
      papersToAttach: [],
      latencyMs: Math.round(performance.now() - t0),
    };
  }
}

/**
 * Structured Standing-Rule & Preference Compiler for the Coach chat:
 * Replaces brittle keyword regexes when local Gemma 4 is reachable.
 */
export async function compileFeedbackRuleWithGemma4(params: {
  model: string;
  userText: string;
  currentSettings: OrganizerSettings;
}): Promise<{
  ok: boolean;
  reply: string;
  actionSummary: string;
  settingsPatch?: Partial<OrganizerSettings>;
  newRule?: Omit<StandingRule, "id">;
} | null> {
  const prompt = `You are Dayframe's preference & rule compiler.
Current settings: workday=${params.currentSettings.workdayStartMinutes}..${params.currentSettings.workdayEndMinutes} mins from midnight, dailyBufferMinutes=${params.currentSettings.dailyBufferMinutes}, calibrationMultiplier=${params.currentSettings.calibrationMultiplier}, protectWeekends=${params.currentSettings.protectWeekends}, notAMorningPersonUntilMinutes=${params.currentSettings.notAMorningPersonUntilMinutes}.

User preference statement: "${params.userText}"

Convert this into structured settingsPatch and/or a StandingRule:
- Protected window times are minutes from midnight (e.g. 9:00 AM = 540, 12:00 PM = 720, 4:00 PM = 960, 5:30 PM = 1050).
- Rule categories: "prep-time" | "duration-calibration" | "availability" | "ignore-pattern" | "auto-confirm".

Return ONLY valid JSON:
{
  "reply": string,
  "actionSummary": string,
  "settingsPatch": {
    "calibrationMultiplier": number | null,
    "dailyBufferMinutes": number | null,
    "protectWeekends": boolean | null,
    "notAMorningPersonUntilMinutes": number | null,
    "intervalMinutes": number | null
  },
  "newRule": {
    "title": string,
    "description": string,
    "category": "prep-time" | "duration-calibration" | "availability" | "ignore-pattern" | "auto-confirm",
    "triggerPattern": string | null,
    "prepDurationMinutes": number | null,
    "minLeadMinutesBeforeMeeting": number | null,
    "fixedMinutesOverride": number | null,
    "protectedWindow": { "startMinutes": number, "endMinutes": number, "label": string } | null
  } | null
}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: params.model,
        stream: false,
        keep_alive: 0,
        format: "json",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const body = (await res.json()) as { message?: { content?: string } };
    const parsed = JSON.parse(body.message?.content ?? "{}") as Record<
      string,
      unknown
    >;

    const sp = (parsed.settingsPatch ?? {}) as Record<string, unknown>;
    const settingsPatch: Partial<OrganizerSettings> = {};
    if (typeof sp.calibrationMultiplier === "number" && sp.calibrationMultiplier >= 0.75) {
      settingsPatch.calibrationMultiplier = sp.calibrationMultiplier;
    }
    if (typeof sp.dailyBufferMinutes === "number" && sp.dailyBufferMinutes >= 0) {
      settingsPatch.dailyBufferMinutes = sp.dailyBufferMinutes;
    }
    if (typeof sp.protectWeekends === "boolean") {
      settingsPatch.protectWeekends = sp.protectWeekends;
    }
    if (typeof sp.notAMorningPersonUntilMinutes === "number") {
      settingsPatch.notAMorningPersonUntilMinutes = sp.notAMorningPersonUntilMinutes;
    }
    if (typeof sp.intervalMinutes === "number" && sp.intervalMinutes >= 1) {
      settingsPatch.intervalMinutes = Math.min(30, sp.intervalMinutes);
    }

    let newRule: Omit<StandingRule, "id"> | undefined;
    if (parsed.newRule && typeof parsed.newRule === "object") {
      const nr = parsed.newRule as Record<string, unknown>;
      if (typeof nr.title === "string" && nr.title.trim()) {
        const pw =
          nr.protectedWindow && typeof nr.protectedWindow === "object"
            ? (nr.protectedWindow as Record<string, unknown>)
            : null;
        newRule = {
          title: nr.title.trim().slice(0, 90),
          description: String(nr.description || nr.title).slice(0, 200),
          category:
            nr.category === "prep-time" ||
            nr.category === "duration-calibration" ||
            nr.category === "ignore-pattern" ||
            nr.category === "auto-confirm"
              ? nr.category
              : "availability",
          enabled: true,
          triggerPattern:
            typeof nr.triggerPattern === "string" && nr.triggerPattern.trim()
              ? nr.triggerPattern.trim()
              : undefined,
          prepDurationMinutes:
            typeof nr.prepDurationMinutes === "number"
              ? nr.prepDurationMinutes
              : undefined,
          minLeadMinutesBeforeMeeting:
            typeof nr.minLeadMinutesBeforeMeeting === "number"
              ? nr.minLeadMinutesBeforeMeeting
              : undefined,
          fixedMinutesOverride:
            typeof nr.fixedMinutesOverride === "number"
              ? nr.fixedMinutesOverride
              : undefined,
          protectedWindow:
            pw &&
            typeof pw.startMinutes === "number" &&
            typeof pw.endMinutes === "number"
              ? {
                  startMinutes: pw.startMinutes,
                  endMinutes: pw.endMinutes,
                  label: String(pw.label || "Protected"),
                }
              : undefined,
          createdFromFeedback: true,
        };
      }
    }

    return {
      ok: true,
      reply: String(parsed.reply || "Saved your preference.").slice(0, 400),
      actionSummary: String(parsed.actionSummary || "Updated rule").slice(0, 90),
      settingsPatch:
        Object.keys(settingsPatch).length > 0 ? settingsPatch : undefined,
      newRule,
    };
  } catch {
    return null;
  }
}

export function computeCanvasLuminanceSignature(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): number[] {
  const grid = 8;
  const stepX = Math.max(1, Math.floor(width / grid));
  const stepY = Math.max(1, Math.floor(height / grid));
  const sig: number[] = [];
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const px = ctx.getImageData(x * stepX, y * stepY, 1, 1).data;
      sig.push(Math.round(0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]));
    }
  }
  return sig;
}

export function signatureSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
  return Math.max(0, 1 - diff / a.length / 255);
}
