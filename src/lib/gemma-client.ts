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

export async function analyzeScreenshotWithGemma4(params: {
  imageDataUrl: string;
  model: string;
  appName: string;
  windowTitle: string;
  todayDateKey: string;
  existingBlocks?: CalendarBlock[];
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

  const prompt = `You are Dayframe's Gemma 4 multimodal executive assistant running offline on the user's MacBook.
Today's local date is ${todayDateKey}.
Source window: "${appName}" — "${windowTitle}" (${device}).${stage1Context}${calContext}

Read the visible text in this screenshot carefully (especially Slack DMs/channels, email threads in Gmail/Mail/Outlook, or project trackers).
Cross-reference what you see on screen with the user's Upcoming Calendar above!

STRICT INTELLIGENCE RULES:
1. NEVER propose blocks for personal chores, household tasks, workouts, meals, casual banter, general reading, coding with no external commitment, or events ALREADY on the user's calendar above! If there is no real work/scheduling action for the user, set "hasActionableItem": false.
2. If a Slack message or email asks the user to do a concrete deliverable, review, deck, code change, or reply (especially tied to an upcoming meeting in the calendar above — set "linkedMeetingId" if it prepares for that meeting!), set "hasActionableItem": true, estimate a realistic duration (15, 30, 45, 60, 90, 120), and cite the exact Slack channel/sender or email subject in "contextEvidence".
3. If a Slack message or email informally proposes a meeting time not yet on the calendar (e.g. "free tomorrow at 3pm?"), set detectedKind="meeting", isSoloInvite=true, proposedDateKey, and proposedStartMinutes.
4. Set "needsUserConfirmation": true whenever ownership, exact timing, or duration benefits from a quick Yes/No check, and make "clarifyingQuestion" cite the specific Slack/email context (NEVER generic!).

Standing Rules:
${rulesList}

Return ONLY valid JSON:
{
  "hasActionableItem": boolean,
  "title": string,
  "summary": string,
  "contextEvidence": string,
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

YOUR JOB — APPLY HIGH INTELLIGENCE & COMMON SENSE (ZERO BABYSITTING / ZERO SPAM):
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
