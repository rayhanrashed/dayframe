import {
  CalendarBlock,
  LocalPaperHit,
  ScannedEmailItem,
  TaskSpecificModel,
} from "./types";

const MAC_BRIDGE_BASE = "http://127.0.0.1:43822";

export interface ValenModelSpec {
  id: string;
  repo: string;
  ggufFile: string;
  label: string;
  totalFootprintNote: string;
  recommendedMacRam: string;
}

export const VALEN_MODEL_CATALOG: ValenModelSpec[] = [
  {
    id: "valen-9b",
    repo: "Valen-Team/Valen-Decision-1.5-9B-GGUF",
    ggufFile: "Valen-Decision-1.5-9B-Q8_0.gguf",
    label: "Valen-Decision-1.5-9B (Q8_0 • Highest Vision Accuracy)",
    totalFootprintNote: "7.91 GiB text + 1.70 GiB vision (~9.6 GiB)",
    recommendedMacRam: "24GB+ Unified Memory alongside Gemma 4",
  },
  {
    id: "valen-4b",
    repo: "Valen-Team/Valen-Decision-1.5-4B-GGUF",
    ggufFile: "Valen-Decision-1.5-4B-Q8_0.gguf",
    label: "Valen-Decision-1.5-4B (Q8_0 • Balanced)",
    totalFootprintNote: "4.20 GiB text + 1.24 GiB vision (~5.4 GiB)",
    recommendedMacRam: "16GB–24GB Unified Memory",
  },
  {
    id: "valen-2b",
    repo: "Valen-Team/Valen-Decision-1.5-2B-GGUF",
    ggufFile: "Valen-Decision-1.5-2B-Q8_0.gguf",
    label: "Valen-Decision-1.5-2B (Q8_0 • Fast Always-On Gate)",
    totalFootprintNote: "1.90 GiB text + 1.23 GiB vision (~3.1 GiB)",
    recommendedMacRam: "16GB Unified Memory",
  },
  {
    id: "valen-0.8b",
    repo: "Valen-Team/Valen-Decision-1.5-0.8B-GGUF",
    ggufFile: "Valen-Decision-1.5-0.8B-Q8_0.gguf",
    label: "Valen-Decision-1.5-0.8B (Q8_0 • Featherweight Edge)",
    totalFootprintNote: "0.77 GiB text + 0.37 GiB vision (~1.1 GiB)",
    recommendedMacRam: "8GB+ Unified Memory",
  },
];

export interface ValenRuntimeStatus {
  reachable: boolean;
  reportedModel?: string;
  pingMs?: number;
  port: number;
  errorDetail?: string;
}

export interface ValenScreenshotDecision {
  usedValen: boolean;
  latencyMs: number;
  isSensitiveScreen: boolean;
  sensitiveProbability: number;
  hasCalendarSignal: boolean;
  signalProbability: number;
  intentChoice:
    | "solo_meeting_invite"
    | "deep_focus_task"
    | "quick_followup"
    | "noise";
  intentConfidence: number;
  urgencyScore: number; // 0..3 weighted score
  bbox?: [number, number, number, number];
  bboxConfidence?: number;
}

interface RawValenAnswer {
  type: "predicate" | "choice" | "score" | "bbox";
  name: string;
  probability?: number;
  choice?: string;
  confidence?: number;
  score?: number;
  bbox?: [number, number, number, number];
}

interface RawValenResponse {
  model?: string;
  answers?: RawValenAnswer[];
  timing?: { total_ms?: number };
}

async function postValenDecisions(params: {
  port: number;
  macPairingToken?: string;
  payload: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<{ ok: boolean; data?: RawValenResponse; latencyMs: number; error?: string }> {
  const { port, macPairingToken, payload, timeoutMs = 12000 } = params;
  const allowedPorts = [43823, 8080, 8000, 30000];
  const safePort = allowedPorts.includes(port) ? port : 43823;
  const t0 = performance.now();

  // 1. Prefer authenticated Mac Bridge loopback relay when paired (avoids browser CORS issues on raw llama-server)
  if (macPairingToken?.trim()) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const bridgeRes = await fetch(`${MAC_BRIDGE_BASE}/api/valen/decisions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${macPairingToken.trim()}`,
        },
        signal: ctrl.signal,
        body: JSON.stringify({ port: safePort, payload }),
      });
      clearTimeout(timer);
      if (bridgeRes.ok) {
        const wrapped = (await bridgeRes.json()) as {
          ok?: boolean;
          data?: RawValenResponse;
          error?: string;
        };
        if (wrapped.ok && wrapped.data) {
          return {
            ok: true,
            data: wrapped.data,
            latencyMs: Math.round(performance.now() - t0),
          };
        }
      }
    } catch {
      // Fall through to direct loopback attempt
    }
  }

  // 2. Direct loopback request to local Valen GGUF / SGLang / vLLM server
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const directRes = await fetch(
      `http://127.0.0.1:${safePort}/v1/decisions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify(payload),
      }
    );
    clearTimeout(timer);

    const latencyMs = Math.round(performance.now() - t0);
    if (!directRes.ok) {
      return {
        ok: false,
        latencyMs,
        error: `Valen server on 127.0.0.1:${safePort} returned HTTP ${directRes.status}.`,
      };
    }

    const data = (await directRes.json()) as RawValenResponse;
    return { ok: true, data, latencyMs };
  } catch {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - t0),
      error: `Valen GGUF runtime not detected on 127.0.0.1:${safePort} (standby — routing directly to Gemma 4).`,
    };
  }
}

export async function probeValenRuntime(params: {
  port: number;
  modelId: string;
  macPairingToken?: string;
}): Promise<ValenRuntimeStatus> {
  const res = await postValenDecisions({
    port: params.port,
    macPairingToken: params.macPairingToken,
    timeoutMs: 2500,
    payload: {
      model: params.modelId || "valen",
      input: "Let's meet tomorrow at 2:00 PM on Zoom to review the architecture doc.",
      questions: [
        {
          name: "ready_check",
          type: "predicate",
          instructions: "The message proposes a meeting time.",
        },
      ],
    },
  });

  if (!res.ok || !res.data) {
    return {
      reachable: false,
      port: params.port,
      errorDetail: res.error,
    };
  }

  return {
    reachable: true,
    reportedModel: res.data.model || params.modelId,
    pingMs: res.latencyMs,
    port: params.port,
  };
}

/**
 * System-1 Multimodal Gatekeeper:
 * Evaluates privacy sensitivity, actionability, intent choice, urgency score, and UI bounding box
 * in ONE single forward pass (0 autoregressive output tokens!) before waking Gemma 4.
 */
export async function runValenScreenshotGate(params: {
  imageDataUrl: string;
  appName: string;
  windowTitle: string;
  modelId: string;
  port: number;
  signalThreshold: number;
  macPairingToken?: string;
}): Promise<ValenScreenshotDecision | null> {
  const {
    imageDataUrl,
    appName,
    windowTitle,
    modelId,
    port,
    signalThreshold,
    macPairingToken,
  } = params;

  const res = await postValenDecisions({
    port,
    macPairingToken,
    timeoutMs: 14000,
    payload: {
      model: modelId || "valen",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Mac window context — App: "${appName}", Title: "${windowTitle}". Evaluate this screenshot for calendar scheduling.`,
            },
            {
              type: "input_image",
              image_url: imageDataUrl,
            },
          ],
        },
      ],
      questions: [
        {
          name: "is_sensitive",
          type: "predicate",
          instructions:
            "The visible screen displays passwords, secret API keys, credit card/banking credentials, or private medical records that must not be stored.",
        },
        {
          name: "has_calendar_signal",
          type: "predicate",
          instructions:
            "The visible screen contains a specific meeting proposal, informal invite, deadline, deliverable request, or email/Slack message requiring dedicated time on the user's calendar.",
        },
        {
          name: "intent_kind",
          type: "choice",
          instructions:
            "Classify the primary calendar action visible in this screenshot.",
          choices: [
            {
              value: "solo_meeting_invite",
              description:
                "A meeting time, call, sync, or coffee chat mention that needs a calendar hold",
            },
            {
              value: "deep_focus_task",
              description:
                "A substantive engineering, writing, review, or preparation task needing >=45m focus",
            },
            {
              value: "quick_followup",
              description:
                "A short reply, confirmation, or quick check needing 15-30m",
            },
            {
              value: "noise",
              description:
                "General coding, reading documentation, browsing, or no actionable commitment",
            },
          ],
        },
        {
          name: "urgency_score",
          type: "score",
          instructions: "Rate how time-sensitive the visible request or meeting is.",
          levels: [
            { label: "0", description: "Not actionable" },
            { label: "1", description: "Flexible this week" },
            { label: "2", description: "Should be scheduled today or tomorrow" },
            { label: "3", description: "Fixed time or urgent today" },
          ],
        },
        {
          name: "focus_region",
          type: "bbox",
          instructions:
            "The email message body, Slack conversation pane, or meeting details card containing the actionable request.",
        },
      ],
    },
  });

  if (!res.ok || !res.data?.answers) {
    return null;
  }

  const byName = new Map<string, RawValenAnswer>();
  for (const ans of res.data.answers) {
    byName.set(ans.name, ans);
  }

  const sensitiveProb = byName.get("is_sensitive")?.probability ?? 0;
  const signalProb = byName.get("has_calendar_signal")?.probability ?? 0;
  const rawChoice = byName.get("intent_kind")?.choice;
  const intentChoice: ValenScreenshotDecision["intentChoice"] =
    rawChoice === "solo_meeting_invite" ||
    rawChoice === "deep_focus_task" ||
    rawChoice === "quick_followup"
      ? rawChoice
      : "noise";

  const focusBoxAns = byName.get("focus_region");

  return {
    usedValen: true,
    latencyMs: res.latencyMs,
    isSensitiveScreen: sensitiveProb >= 0.55,
    sensitiveProbability: sensitiveProb,
    hasCalendarSignal:
      signalProb >= signalThreshold && intentChoice !== "noise",
    signalProbability: signalProb,
    intentChoice,
    intentConfidence: byName.get("intent_kind")?.confidence ?? signalProb,
    urgencyScore: byName.get("urgency_score")?.score ?? 1,
    bbox: focusBoxAns?.bbox,
    bboxConfidence: focusBoxAns?.confidence,
  };
}

/**
 * Crops a cluttered multi-window MacBook screenshot down to Valen's grounded [x1, y1, x2, y2] bbox
 * (with 6% margin) so Gemma 4 focuses strictly on the relevant Slack thread or email body.
 */
export function cropImageToValenBbox(
  imageDataUrl: string,
  bbox?: [number, number, number, number],
  minConfidence = 0.45,
  bboxConfidence = 0
): Promise<string> {
  if (!bbox || bboxConfidence < minConfidence) {
    return Promise.resolve(imageDataUrl);
  }
  const [x1, y1, x2, y2] = bbox;
  if (x2 - x1 < 0.12 || y2 - y1 < 0.1) {
    return Promise.resolve(imageDataUrl);
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const pad = 0.06;
      const nx1 = Math.max(0, x1 - pad);
      const ny1 = Math.max(0, y1 - pad);
      const nx2 = Math.min(1, x2 + pad);
      const ny2 = Math.min(1, y2 + pad);

      const sx = Math.round(nx1 * img.width);
      const sy = Math.round(ny1 * img.height);
      const sw = Math.max(160, Math.round((nx2 - nx1) * img.width));
      const sh = Math.max(120, Math.round((ny2 - ny1) * img.height));

      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(imageDataUrl);
        return;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => resolve(imageDataUrl);
    img.src = imageDataUrl;
  });
}

/**
 * Screens scanned inbox emails via Valen-Decision-1.5 before sending only actionable ones to Gemma 4,
 * filtering out newsletters, automated receipts, and FYI notifications in single forward passes.
 */
export async function filterInboxEmailsWithValen(params: {
  emails: ScannedEmailItem[];
  modelId: string;
  port: number;
  threshold: number;
  macPairingToken?: string;
}): Promise<{
  usedValen: boolean;
  keptEmails: ScannedEmailItem[];
  droppedCount: number;
  totalLatencyMs: number;
}> {
  const { emails, modelId, port, threshold, macPairingToken } = params;
  if (emails.length === 0) {
    return { usedValen: false, keptEmails: [], droppedCount: 0, totalLatencyMs: 0 };
  }

  const kept: ScannedEmailItem[] = [];
  let totalLatencyMs = 0;
  let anySucceeded = false;

  for (const email of emails) {
    const res = await postValenDecisions({
      port,
      macPairingToken,
      timeoutMs: 5000,
      payload: {
        model: modelId || "valen",
        input: `From: ${email.sender}\nSubject: ${email.subject}\nSnippet: ${email.snippet}`,
        questions: [
          {
            name: "actionable_email",
            type: "predicate",
            instructions:
              "This email proposes a meeting/call time or asks the recipient to complete a concrete task, review, or personal reply (not a newsletter, receipt, or automated alert).",
          },
        ],
      },
    });

    if (!res.ok || !res.data?.answers?.[0]) {
      if (!anySucceeded) {
        return {
          usedValen: false,
          keptEmails: emails,
          droppedCount: 0,
          totalLatencyMs,
        };
      }
      kept.push(email);
      continue;
    }

    anySucceeded = true;
    totalLatencyMs += res.latencyMs;
    const prob = res.data.answers[0].probability ?? 0;
    if (prob >= threshold) {
      kept.push(email);
    }
  }

  return {
    usedValen: anySucceeded,
    keptEmails: kept,
    droppedCount: emails.length - kept.length,
    totalLatencyMs,
  };
}

/**
 * Evaluates whether a non-recurring calendar meeting also requires advance preparation
 * (e.g. "Q4 Architecture Review", "Customer Escalation", "Board Sync" vs "Coffee Chat").
 */
export async function evaluateMeetingPrepNeedWithValen(params: {
  meetingTitle: string;
  durationMinutes: number;
  modelId: string;
  port: number;
  macPairingToken?: string;
}): Promise<{
  needsPrep: boolean;
  probability: number;
  recommendedPrepMinutes: number;
} | null> {
  const res = await postValenDecisions({
    port: params.port,
    macPairingToken: params.macPairingToken,
    timeoutMs: 4000,
    payload: {
      model: params.modelId || "valen",
      input: `Calendar meeting: "${params.meetingTitle}" (${params.durationMinutes} minutes).`,
      questions: [
        {
          name: "needs_prep",
          type: "predicate",
          instructions:
            "This meeting involves a presentation, architecture/design review, interview, client/board discussion, or decision-making that benefits from dedicated preparation beforehand.",
        },
        {
          name: "prep_bucket",
          type: "choice",
          instructions: "How much advance preparation time is appropriate?",
          choices: [
            { value: "30", description: "Quick 30-minute review" },
            { value: "60", description: "Standard 60-minute preparation" },
            { value: "90", description: "Deep 90-minute preparation" },
          ],
        },
      ],
    },
  });

  if (!res.ok || !res.data?.answers) return null;
  const prepAns = res.data.answers.find((a) => a.name === "needs_prep");
  const bucketAns = res.data.answers.find((a) => a.name === "prep_bucket");
  const prob = prepAns?.probability ?? 0;

  return {
    needsPrep: prob >= 0.65,
    probability: prob,
    recommendedPrepMinutes: Number(bucketAns?.choice) || 60,
  };
}

export interface ValenUtteranceRoute {
  intent:
    | "schedule_single_block"
    | "schedule_multi_or_cadence"
    | "pull_external_context"
    | "modify_event_artifacts"
    | "update_global_rule"
    | "copilot_question";
  intentConfidence: number;
  needsGemmaCompiler: boolean;
  needsContextSearch: boolean;
  latencyMs: number;
}

/**
 * System-1 NL Router: Routes any natural-language user input in 1 forward pass (0 output tokens),
 * deciding intent category, whether Gemma 4's structured compiler is needed, and whether to pull Mail/PDF context.
 */
export async function routeUserUtteranceWithValen(params: {
  text: string;
  surface: "composer" | "event-chat" | "coach";
  eventContextTitle?: string;
  modelId: string;
  port: number;
  macPairingToken?: string;
}): Promise<ValenUtteranceRoute | null> {
  const contextLine = params.eventContextTitle
    ? `Surface: ${params.surface} (inside event "${params.eventContextTitle}")\nUser input: "${params.text}"`
    : `Surface: ${params.surface}\nUser input: "${params.text}"`;

  const res = await postValenDecisions({
    port: params.port,
    macPairingToken: params.macPairingToken,
    timeoutMs: 3500,
    payload: {
      model: params.modelId || "valen",
      input: contextLine,
      questions: [
        {
          name: "intent",
          type: "choice",
          instructions: "Classify what the user wants Dayframe to do.",
          choices: [
            {
              value: "schedule_single_block",
              description: "Schedule one simple standalone task or time block",
            },
            {
              value: "schedule_multi_or_cadence",
              description:
                "Schedule multiple blocks, a weekly cadence, prep sessions before a meeting, or a multi-part deadline",
            },
            {
              value: "pull_external_context",
              description:
                "Search or attach context from emails, Slack messages, or relevant papers/PDFs",
            },
            {
              value: "modify_event_artifacts",
              description:
                "Add a checklist todo, reminder alert, paper, note, rename, resize, or move an existing event",
            },
            {
              value: "update_global_rule",
              description:
                "Change a standing scheduling rule, duration habit, buffer, or working hours preference",
            },
            {
              value: "copilot_question",
              description:
                "Ask an open question, brainstorm, or summarize status",
            },
          ],
        },
        {
          name: "needs_gemma_compiler",
          type: "predicate",
          instructions:
            "The user input contains natural phrasing, temporal constraints, multiple steps, or implicit naming that benefits from full LLM structured parsing rather than a literal title string.",
        },
        {
          name: "needs_context_search",
          type: "predicate",
          instructions:
            "Fulfilling this request benefits from checking related emails, Slack messages, or local PDF papers.",
        },
      ],
    },
  });

  if (!res.ok || !res.data?.answers) return null;
  const byName = new Map(res.data.answers.map((a) => [a.name, a]));
  const rawIntent = byName.get("intent")?.choice;
  const validIntents = new Set([
    "schedule_single_block",
    "schedule_multi_or_cadence",
    "pull_external_context",
    "modify_event_artifacts",
    "update_global_rule",
    "copilot_question",
  ]);
  const intent = validIntents.has(String(rawIntent))
    ? (rawIntent as ValenUtteranceRoute["intent"])
    : "schedule_multi_or_cadence";

  return {
    intent,
    intentConfidence: byName.get("intent")?.confidence ?? 0.7,
    needsGemmaCompiler:
      (byName.get("needs_gemma_compiler")?.probability ?? 1) >= 0.35,
    needsContextSearch:
      (byName.get("needs_context_search")?.probability ?? 0.5) >= 0.45,
    latencyMs: res.latencyMs,
  };
}

/**
 * Semantic Event-Role Classifier: Replaces relying only on static chore word lists
 * when Valen is active — classifies each calendar entry semantically in 1 forward pass.
 */
export async function classifyCalendarEventsWithValen(params: {
  blocks: CalendarBlock[];
  modelId: string;
  port: number;
  macPairingToken?: string;
}): Promise<
  Map<
    string,
    {
      role:
        | "substantive_meeting_needing_prep"
        | "routine_meeting_no_prep"
        | "personal_chore_or_life_routine"
        | "solo_work_block";
      prepUrgency: number;
    }
  > | null
> {
  const out = new Map<
    string,
    {
      role:
        | "substantive_meeting_needing_prep"
        | "routine_meeting_no_prep"
        | "personal_chore_or_life_routine"
        | "solo_work_block";
      prepUrgency: number;
    }
  >();

  let anyOk = false;
  for (const blk of params.blocks.slice(0, 24)) {
    if (blk.isDayframeCreated || blk.occupiesTimeOnly) continue;
    const desc = `Title: "${blk.title}" | Duration: ${blk.durationMinutes}m | Attendees: ${
      blk.attendeeCount ?? 0
    } | Video call: ${Boolean(blk.hasVideoLink)} | Calendar: "${
      blk.calendarTitle || ""
    }" | Notes: "${(blk.notes || "").slice(0, 180)}"`;

    const res = await postValenDecisions({
      port: params.port,
      macPairingToken: params.macPairingToken,
      timeoutMs: 3500,
      payload: {
        model: params.modelId || "valen",
        input: desc,
        questions: [
          {
            name: "role",
            type: "choice",
            instructions: "Classify what kind of calendar entry this is.",
            choices: [
              {
                value: "substantive_meeting_needing_prep",
                description:
                  "A multi-person meeting, advisor/committee/client review, talk, or interview that warrants advance preparation",
              },
              {
                value: "routine_meeting_no_prep",
                description:
                  "A casual sync, daily standup, social coffee, or passive seminar needing no dedicated prep block",
              },
              {
                value: "personal_chore_or_life_routine",
                description:
                  "A household chore, cleaning, meal, workout, commute, medical errand, or personal reminder",
              },
              {
                value: "solo_work_block",
                description: "Already a solo focus/task block on the user's calendar",
              },
            ],
          },
          {
            name: "prep_urgency",
            type: "score",
            instructions: "How strongly does this entry warrant advance prep?",
            levels: [
              { label: "0", description: "None (chore, solo block, or casual)" },
              { label: "1", description: "Optional light skim" },
              { label: "2", description: "Recommended 30-45m prep" },
              { label: "3", description: "High-stakes 60-90m prep" },
            ],
          },
        ],
      },
    });

    if (!res.ok || !res.data?.answers) {
      if (!anyOk) return null;
      continue;
    }
    anyOk = true;
    const roleAns = res.data.answers.find((a) => a.name === "role")?.choice;
    const scoreAns =
      res.data.answers.find((a) => a.name === "prep_urgency")?.score ?? 0;
    const validRoles = new Set([
      "substantive_meeting_needing_prep",
      "routine_meeting_no_prep",
      "personal_chore_or_life_routine",
      "solo_work_block",
    ]);
    out.set(blk.id, {
      role: validRoles.has(String(roleAns))
        ? (roleAns as
            | "substantive_meeting_needing_prep"
            | "routine_meeting_no_prep"
            | "personal_chore_or_life_routine"
            | "solo_work_block")
        : "routine_meeting_no_prep",
      prepUrgency: scoreAns,
    });
  }

  return anyOk ? out : null;
}

/**
 * Semantic Entity Resolution (Tempo propose-and-reconcile):
 * Matches a new task, email, or paper to an existing TaskSpecificModel even when surface words differ
 * (e.g., "UMich AI in Medicine Scholars" <-> "AIIM Fellowship").
 */
export async function matchTaskModelWithValen(params: {
  candidateTitle: string;
  candidateContext?: string;
  taskModels: TaskSpecificModel[];
  modelId: string;
  port: number;
  macPairingToken?: string;
}): Promise<{ matchedModelId: string | null; confidence: number } | null> {
  const { candidateTitle, candidateContext, taskModels } = params;
  if (taskModels.length === 0) return null;

  const choices = [
    ...taskModels.slice(0, 10).map((m) => ({
      value: m.id,
      description: `${m.canonicalTitle} — ${m.summary.slice(0, 100)}`,
    })),
    {
      value: "__NEW__",
      description: "Distinct new project or task not covered by any existing model above",
    },
  ];

  const res = await postValenDecisions({
    port: params.port,
    macPairingToken: params.macPairingToken,
    timeoutMs: 3500,
    payload: {
      model: params.modelId || "valen",
      input: `Candidate item: "${candidateTitle}"${
        candidateContext ? `\nContext: ${candidateContext.slice(0, 240)}` : ""
      }`,
      questions: [
        {
          name: "best_model",
          type: "choice",
          instructions:
            "Select which existing Task-Specific Model this item belongs to, or __NEW__ if none.",
          choices,
        },
        {
          name: "same_activity",
          type: "predicate",
          instructions:
            "This item is genuinely part of one of the listed ongoing projects rather than a separate topic.",
        },
      ],
    },
  });

  if (!res.ok || !res.data?.answers) return null;
  const choiceAns = res.data.answers.find((a) => a.name === "best_model");
  const sameProb =
    res.data.answers.find((a) => a.name === "same_activity")?.probability ?? 0;

  if (
    !choiceAns?.choice ||
    choiceAns.choice === "__NEW__" ||
    sameProb < 0.5
  ) {
    return { matchedModelId: null, confidence: 1 - sameProb };
  }

  return {
    matchedModelId: choiceAns.choice,
    confidence: Math.max(choiceAns.confidence ?? 0, sameProb),
  };
}

/**
 * Semantic Context Reranker: Filters candidate Spotlight PDFs and Mail messages
 * via Valen predicate scoring so noisy keyword collisions don't attach to an event.
 */
export async function rerankContextItemsWithValen(params: {
  eventTitle: string;
  eventNotes?: string;
  emails: ScannedEmailItem[];
  papers: LocalPaperHit[];
  modelId: string;
  port: number;
  macPairingToken?: string;
}): Promise<{
  usedValen: boolean;
  emails: ScannedEmailItem[];
  papers: LocalPaperHit[];
} | null> {
  const { eventTitle, eventNotes, emails, papers, modelId, port, macPairingToken } =
    params;
  if (emails.length === 0 && papers.length === 0) {
    return { usedValen: false, emails: [], papers: [] };
  }

  const keptEmails: ScannedEmailItem[] = [];
  const keptPapers: LocalPaperHit[] = [];
  let anyOk = false;

  for (const em of emails) {
    const res = await postValenDecisions({
      port,
      macPairingToken,
      timeoutMs: 3000,
      payload: {
        model: modelId || "valen",
        input: `Target Event: "${eventTitle}" (${(eventNotes || "").slice(0, 120)})\nCandidate Email: From ${em.sender} | Subject: "${em.subject}" | Snippet: ${em.snippet.slice(0, 220)}`,
        questions: [
          {
            name: "relevant",
            type: "predicate",
            instructions:
              "This email contains context, instructions, links, or background directly relevant to the target event.",
          },
        ],
      },
    });
    if (!res.ok || !res.data?.answers?.[0]) {
      if (!anyOk) return null;
      keptEmails.push(em);
      continue;
    }
    anyOk = true;
    if ((res.data.answers[0].probability ?? 0) >= 0.45) {
      keptEmails.push(em);
    }
  }

  for (const pap of papers) {
    const res = await postValenDecisions({
      port,
      macPairingToken,
      timeoutMs: 3000,
      payload: {
        model: modelId || "valen",
        input: `Target Event: "${eventTitle}" (${(eventNotes || "").slice(0, 120)})\nCandidate PDF File: "${pap.title}" (${pap.filename})`,
        questions: [
          {
            name: "relevant_pdf",
            type: "predicate",
            instructions:
              "This PDF paper or document is topically relevant to preparing for or working on the target event.",
          },
        ],
      },
    });
    if (!res.ok || !res.data?.answers?.[0]) {
      if (!anyOk) return null;
      keptPapers.push(pap);
      continue;
    }
    anyOk = true;
    if ((res.data.answers[0].probability ?? 0) >= 0.45) {
      keptPapers.push(pap);
    }
  }

  return { usedValen: anyOk, emails: keptEmails, papers: keptPapers };
}

