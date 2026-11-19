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
    modalityNote: "Vision + Text + Tool Calling",
  },
  {
    tag: "gemma4:e2b",
    label: "Gemma 4 E2B (Ultra-Fast Edge)",
    sizeNote: "~4.6 GB • 128K ctx",
    modalityNote: "Vision + Text • Lowest RAM",
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
        "Cannot reach local Ollama at http://127.0.0.1:11434. Make sure Ollama is running on your Mac with OLLAMA_ORIGINS=\"*\" ollama serve.",
    };
  }
}

export async function testGemma4Ping(model: string): Promise<{
  ok: boolean;
  latencyMs: number;
  resolvedModel: string;
  message: string;
}> {
  const t0 = performance.now();
  const status = await probeLocalGemma(model);
  if (!status.reachable) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - t0),
      resolvedModel: model,
      message:
        status.errorDetail ??
        "Ollama is not reachable at 127.0.0.1:11434 on this machine.",
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
        messages: [
          {
            role: "user",
            content:
              "Reply in one short sentence confirming Gemma 4 is ready to organize calendar blocks.",
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
        message:
          errText.includes("not found")
            ? `Model "${targetModel}" is not pulled yet. Run: ollama pull ${model}`
            : `Ollama returned HTTP ${res.status}: ${errText.slice(0, 140)}`,
      };
    }

    const body = (await res.json()) as { message?: { content?: string } };
    return {
      ok: true,
      latencyMs,
      resolvedModel: targetModel,
      message:
        body.message?.content?.trim() ||
        `${targetModel} responded cleanly in ${latencyMs}ms.`,
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

  const prompt = `You are Dayframe's local Gemma 4 multimodal calendar organizer running on the user's MacBook.
Today's local date is ${todayDateKey}.
Captured device: ${device} | Active app: "${appName}" | Window title: "${windowTitle}".

Inspect the screenshot image carefully (especially emails in Mail/Gmail, Slack threads, or meeting mentions).
Decide if there is a concrete item that should be placed on the user's calendar:
1. If the screenshot mentions a specific meeting time (even informally in an email or Slack message without an invite), output detectedKind="meeting" and isSoloInvite=true (a personal hold just for the user), with proposedDateKey ("YYYY-MM-DD") and proposedStartMinutes (minutes from midnight, e.g. 14:30 -> 870).
2. If the screenshot shows a concrete task, review, deliverable, or reply the user needs to do, estimate realistic duration in minutes (15, 30, 45, 60, 90, 120) so we can time-block it onto an open calendar slot (detectedKind="deep-work" for >=45m focus work, or "follow-up" for 15-30m replies). Do NOT create vague to-dos.
3. If the screen is just general browsing, code with no new commitment, or already reflected, set hasActionableItem=false.

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
  "fingerprintKey": string
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
        error: `Ollama HTTP ${res.status} — verify "ollama pull ${model}" and OLLAMA_ORIGINS="*" ollama serve.`,
      };
    }

    const body = (await res.json()) as { message?: { content?: string } };
    const parsed = JSON.parse(body.message?.content ?? "{}") as Partial<
      ExtractedCaptureSignal
    >;

    return {
      ok: true,
      modelUsed: model,
      latencyMs,
      signal: {
        hasActionableItem: Boolean(parsed.hasActionableItem),
        title: String(parsed.title || "Captured calendar block").slice(0, 120),
        summary: String(parsed.summary || "Analyzed by Gemma 4").slice(0, 280),
        detectedKind:
          parsed.detectedKind === "meeting" ||
          parsed.detectedKind === "follow-up"
            ? parsed.detectedKind
            : "deep-work",
        estimatedMinutes: Math.max(
          15,
          Math.min(180, Math.round((Number(parsed.estimatedMinutes) || 45) / 15) * 15)
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
          : "Could not reach local Gemma 4 on 127.0.0.1:11434.",
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
  signals: Array<ExtractedCaptureSignal & { sourceEmailId: string; sourceLabel: string }>;
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

  const prompt = `You are Dayframe's local Gemma 4 organizer performing the user's One-Off Initial Inbox Scan.
Today's date is ${todayDateKey}.
Inspect these real inbox emails and extract ONLY items that belong on the user's calendar:
- Informal or unbooked meeting mentions -> detectedKind="meeting", isSoloInvite=true (creates a solo calendar hold just for the user)
- Concrete work/deliverables/replies -> detectedKind="deep-work" or "follow-up" with realistic estimatedMinutes (15..120).
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
      "isSoloInvite": boolean
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
      return {
        sourceEmailId: String(item.sourceEmailId || ""),
        sourceLabel: email ? `Email: ${email.subject}` : "Inbox Scan",
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
          Math.min(180, Math.round((Number(item.estimatedMinutes) || 45) / 15) * 15)
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
