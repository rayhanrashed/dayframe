import {
  ExtractedCaptureSignal,
  ScannedEmailItem,
  StandingRule,
} from "./types";

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
        "Ollama is currently sleeping (0 MB RAM) — Dayframe wakes it automatically only when a batch sweep runs.",
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
        "Ollama is currently stopped (0 MB RAM). Click 'Wake & Test' or run ./dayframe on your MacBook.",
    };
  }

  const targetModel = status.selectedModelInstalled
    ? status.installedModels.find(
        (m) =>
          m.toLowerCase() === model.toLowerCase() ||
          (model === "gemma4:e4b" && m.toLowerCase() === "gemma4:latest")
      ) ?? model
    : status.installedGemma4Models[0] ?? model;

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

export async function analyzeScreenshotWithGemma4(params: {
  imageDataUrl: string;
  model: string;
  appName: string;
  windowTitle: string;
  todayDateKey: string;
  rules: StandingRule[];
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
    rules,
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

  const stage1Context = valenHint
    ? `\nStage-1 Valen-Decision Gatekeeper pre-screening: p(actionable)=${valenHint.signalProbability.toFixed(
        2
      )}, intent="${valenHint.intentChoice}", urgency=${valenHint.urgencyScore.toFixed(
        1
      )}/3${
        valenHint.bboxCropped
          ? " (image cropped to Valen's grounded bbox region)"
          : ""
      }.`
    : "";

  const prompt = `You are Dayframe's Stage-2 Gemma 4 multimodal calendar planner running 100% offline on the user's MacBook.
Today's local date is ${todayDateKey}.
Captured device: ${device} | Active app: "${appName}" | Window title: "${windowTitle}".${stage1Context}

Inspect the screenshot carefully (emails, Slack messages, or meeting mentions).
IMPORTANT: When you are even slightly unsure whether an item belongs on the user's calendar, whether it is assigned to the user vs FYI, whether a meeting time is tentative, or how much focus time it needs, set "needsUserConfirmation": true and write a clear, conversational "clarifyingQuestion" asking the user! We prefer asking the user OFTEN rather than silently guessing.

Rules for extraction:
1. Informal or unconfirmed meeting mention in email/Slack -> detectedKind="meeting", isSoloInvite=true, needsUserConfirmation=true, clarifyingQuestion="Put a solo hold for '<title>' on your calendar, or wait until confirmed?".
2. Concrete task, review, deliverable, or reply -> detectedKind="deep-work" (>=45m) or "follow-up" (15-30m) with realistic estimatedMinutes (15, 30, 45, 60, 90, 120). If ownership or duration isn't 100% certain, set needsUserConfirmation=true and ask in clarifyingQuestion.
3. General browsing, reading code with no commitment, or noise -> set hasActionableItem=false.

User's Standing Rules:
${rulesList || "- Reserve prep time at least 2 hours before recurring meetings."}

Return ONLY valid JSON matching this schema:
{
  "hasActionableItem": boolean,
  "title": string,
  "summary": string,
  "detectedKind": "meeting" | "deep-work" | "follow-up",
  "estimatedMinutes": number,
  "proposedDateKey": string | null,
  "proposedStartMinutes": number | null,
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
    const timer = setTimeout(() => controller.abort(), 35000);

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
        error: `Local Ollama HTTP ${res.status} — queued for next batch sweep.`,
      };
    }

    const body = (await res.json()) as { message?: { content?: string } };
    const parsed = JSON.parse(body.message?.content ?? "{}") as Partial<
      ExtractedCaptureSignal
    >;

    const rawConf = Number(parsed.confidence);
    const confidence = Number.isFinite(rawConf)
      ? Math.max(0.1, Math.min(0.99, rawConf))
      : 0.74;

    return {
      ok: true,
      modelUsed: model,
      latencyMs,
      signal: {
        hasActionableItem: Boolean(parsed.hasActionableItem),
        title: String(parsed.title || "Captured calendar block").slice(0, 120),
        summary: String(parsed.summary || "Analyzed offline by Gemma 4").slice(
          0,
          280
        ),
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
          ? String(parsed.clarifyingQuestion).slice(0, 220)
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

export async function analyzeInboxEmailsWithGemma4(params: {
  emails: ScannedEmailItem[];
  model: string;
  todayDateKey: string;
  rules: StandingRule[];
}): Promise<{
  ok: boolean;
  signals: Array<
    ExtractedCaptureSignal & { sourceEmailId: string; sourceLabel: string }
  >;
  latencyMs: number;
  error?: string;
}> {
  const { emails, model, todayDateKey, rules } = params;
  const t0 = performance.now();
  if (emails.length === 0) {
    return { ok: true, signals: [], latencyMs: 0 };
  }

  const compactEmails = emails.slice(0, 12).map((e) => ({
    id: e.id,
    subject: e.subject,
    sender: e.sender,
    dateIso: e.dateIso,
    snippet: e.snippet,
  }));

  const rulesText = rules
    .filter((r) => r.enabled)
    .map((r) => `- ${r.title}`)
    .join("\n");

  const prompt = `You are Dayframe's offline local Gemma 4 organizer scanning the user's Apple Mail inbox.
Today's date is ${todayDateKey}.
Extract items that may belong on the user's calendar:
- Informal or unbooked meeting mentions -> detectedKind="meeting", isSoloInvite=true, needsUserConfirmation=true
- Concrete work/deliverables/replies -> detectedKind="deep-work" or "follow-up" with realistic estimatedMinutes (15..120).
Whenever you are not 100% sure whether the user wants an email placed on their calendar or how long it takes, set "needsUserConfirmation": true and write a helpful "clarifyingQuestion" asking the user directly!
Ignore newsletters, receipts, automated notifications, and spam.

Standing Rules:
${rulesText}

Emails JSON:
${JSON.stringify(compactEmails)}

Return ONLY valid JSON with shape:
{
  "items": [
    {
      "sourceEmailId": string,
      "title": string,
      "summary": string,
      "detectedKind": "meeting" | "deep-work" | "follow-up",
      "estimatedMinutes": number,
      "proposedDateKey": string | null,
      "proposedStartMinutes": number | null,
      "isRecurringMention": boolean,
      "isSoloInvite": boolean,
      "confidence": number,
      "needsUserConfirmation": boolean,
      "clarifyingQuestion": string,
      "uncertaintyReason": string
    }
  ]
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
        signals: [],
        latencyMs,
        error: `Gemma 4 inbox scan returned HTTP ${res.status}.`,
      };
    }

    const body = (await res.json()) as { message?: { content?: string } };
    const parsed = JSON.parse(body.message?.content ?? "{}") as {
      items?: Array<Record<string, unknown>>;
    };

    const signals = (parsed.items ?? []).map((item) => {
      const email = emails.find((e) => e.id === item.sourceEmailId);
      const rawConf = Number(item.confidence);
      const confidence = Number.isFinite(rawConf)
        ? Math.max(0.1, Math.min(0.99, rawConf))
        : 0.72;
      return {
        sourceEmailId: String(item.sourceEmailId || ""),
        sourceLabel: email ? `Mail: ${email.subject}` : "Mail Scan",
        hasActionableItem: true,
        title: String(item.title || email?.subject || "Email follow-up").slice(
          0,
          120
        ),
        summary: String(item.summary || "").slice(0, 260),
        detectedKind:
          item.detectedKind === "meeting" || item.detectedKind === "follow-up"
            ? (item.detectedKind as "meeting" | "follow-up")
            : ("deep-work" as const),
        estimatedMinutes: Math.max(
          15,
          Math.min(
            180,
            Math.round((Number(item.estimatedMinutes) || 45) / 15) * 15
          )
        ),
        proposedDateKey:
          typeof item.proposedDateKey === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(item.proposedDateKey)
            ? item.proposedDateKey
            : undefined,
        proposedStartMinutes:
          typeof item.proposedStartMinutes === "number"
            ? item.proposedStartMinutes
            : undefined,
        isRecurringMention: Boolean(item.isRecurringMention),
        isSoloInvite: Boolean(item.isSoloInvite),
        fingerprintKey: `email-${String(item.sourceEmailId || item.title)}`,
        confidence,
        needsUserConfirmation:
          item.needsUserConfirmation !== undefined
            ? Boolean(item.needsUserConfirmation)
            : true,
        clarifyingQuestion: item.clarifyingQuestion
          ? String(item.clarifyingQuestion).slice(0, 220)
          : undefined,
        uncertaintyReason: item.uncertaintyReason
          ? String(item.uncertaintyReason).slice(0, 100)
          : undefined,
      };
    });

    return { ok: true, signals, latencyMs };
  } catch (err) {
    return {
      ok: false,
      signals: [],
      latencyMs: Math.round(performance.now() - t0),
      error:
        err instanceof Error ? err.message : "Failed calling local Gemma 4.",
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
