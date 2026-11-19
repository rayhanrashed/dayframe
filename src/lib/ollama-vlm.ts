import { ExtractedCaptureSignal, StandingRule } from "./types";

const OLLAMA_LOOPBACK_BASE = "http://127.0.0.1:11434";

export interface LocalOllamaStatus {
  connected: boolean;
  models: string[];
  visionModels: string[];
  recommendedModel: string;
  errorHint?: string;
}

const KNOWN_VISION_MODEL_HINTS = [
  "vision",
  "vl",
  "llava",
  "gemma3",
  "minicpm",
  "moondream",
  "pixtral",
  "bakllava",
];

export async function probeLocalOllama(): Promise<LocalOllamaStatus> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);

    const res = await fetch(`${OLLAMA_LOOPBACK_BASE}/api/tags`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        connected: false,
        models: [],
        visionModels: [],
        recommendedModel: "llama3.2-vision",
        errorHint: `Local Ollama responded with HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const models = (data.models ?? [])
      .map((m) => m.name ?? "")
      .filter((n) => n.length > 0);

    const visionModels = models.filter((name) =>
      KNOWN_VISION_MODEL_HINTS.some((hint) => name.toLowerCase().includes(hint))
    );

    const recommendedModel =
      visionModels[0] ?? models[0] ?? "llama3.2-vision";

    return {
      connected: true,
      models,
      visionModels,
      recommendedModel,
    };
  } catch {
    return {
      connected: false,
      models: [],
      visionModels: [],
      recommendedModel: "llama3.2-vision",
      errorHint:
        "Local Ollama not detected on 127.0.0.1:11434 — using built-in on-device heuristic extractor.",
    };
  }
}

export async function analyzeScreenshotWithLocalOllama(params: {
  imageDataUrl: string;
  model: string;
  rules: StandingRule[];
  hintText?: string;
  device: "macbook" | "android";
}): Promise<{ signal: ExtractedCaptureSignal; usedLocalVlm: boolean }> {
  const { imageDataUrl, model, rules, hintText = "", device } = params;

  const base64Payload = imageDataUrl.includes(",")
    ? imageDataUrl.split(",")[1]
    : "";

  const activeRulesSummary = rules
    .filter((r) => r.enabled)
    .map((r) => `- ${r.title}: ${r.description}`)
    .join("\n");

  const systemPrompt = `You are Dayframe, a privacy-first local AI calendar organizer running on a MacBook.
Inspect this ${device} screenshot (often Apple Mail, Gmail, Slack, or a browser) and decide whether it contains:
1) A meeting mention or informal meeting invite (even without a calendar invite) -> create a solo calendar hold ("meeting", isSoloInvite: true)
2) A concrete task/request/deliverable -> estimate realistic minutes needed so we can time-block it onto an open calendar slot ("deep-work" for >=45m focus work, "follow-up" for 15-30m replies)
3) Nothing actionable -> hasActionableItem: false

User's Standing Rules:
${activeRulesSummary || "- Reserve at least 2 hours prep runway before recurring meetings."}

Respond ONLY in valid JSON with keys:
{
  "hasActionableItem": boolean,
  "title": string,
  "summary": string,
  "detectedKind": "meeting" | "deep-work" | "follow-up",
  "estimatedMinutes": number,
  "proposedStartMinutes": number | null,
  "proposedDayOffset": 0 | 1,
  "isRecurringMention": boolean,
  "isSoloInvite": boolean,
  "locationOrUrl": string | null,
  "fingerprintKey": string
}`;

  if (
    base64Payload &&
    (imageDataUrl.startsWith("data:image/png") ||
      imageDataUrl.startsWith("data:image/jpeg") ||
      imageDataUrl.startsWith("data:image/webp"))
  ) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);

      const response = await fetch(`${OLLAMA_LOOPBACK_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: model || "llama3.2-vision",
          stream: false,
          format: "json",
          messages: [
            {
              role: "user",
              content: hintText
                ? `${systemPrompt}\nAdditional context: ${hintText}`
                : systemPrompt,
              images: [base64Payload],
            },
          ],
        }),
      });
      clearTimeout(timer);

      if (response.ok) {
        const payload = (await response.json()) as {
          message?: { content?: string };
        };
        const raw = payload.message?.content ?? "";
        const parsed = JSON.parse(raw) as Partial<ExtractedCaptureSignal>;
        if (typeof parsed.hasActionableItem === "boolean") {
          return {
            usedLocalVlm: true,
            signal: {
              hasActionableItem: parsed.hasActionableItem,
              title: parsed.title || "Screen-captured work block",
              summary: parsed.summary || "Extracted by local Ollama vision model",
              detectedKind:
                parsed.detectedKind === "meeting" ||
                parsed.detectedKind === "follow-up"
                  ? parsed.detectedKind
                  : "deep-work",
              estimatedMinutes: Math.max(
                15,
                Math.min(180, Number(parsed.estimatedMinutes) || 45)
              ),
              proposedStartMinutes:
                typeof parsed.proposedStartMinutes === "number"
                  ? parsed.proposedStartMinutes
                  : undefined,
              proposedDayOffset: parsed.proposedDayOffset === 1 ? 1 : 0,
              isRecurringMention: Boolean(parsed.isRecurringMention),
              isSoloInvite: Boolean(parsed.isSoloInvite),
              locationOrUrl: parsed.locationOrUrl ?? undefined,
              fingerprintKey: parsed.fingerprintKey,
            },
          };
        }
      }
    } catch {
      // Fall back to deterministic on-device heuristic below when Ollama is unreachable
    }
  }

  return {
    usedLocalVlm: false,
    signal: extractHeuristicSignalFromText(hintText, device),
  };
}

export function extractHeuristicSignalFromText(
  rawText: string,
  device: "macbook" | "android"
): ExtractedCaptureSignal {
  const clean = rawText.trim();
  if (!clean) {
    return {
      hasActionableItem: true,
      title:
        device === "android"
          ? "Review mobile screenshot follow-up"
          : "Review captured workspace item",
      summary: "Captured screen frame queued for calendar time-blocking",
      detectedKind: "follow-up",
      estimatedMinutes: 30,
      proposedDayOffset: device === "android" ? 1 : 0,
    };
  }

  const lower = clean.toLowerCase();
  const timeMatch = clean.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  let proposedStartMinutes: number | undefined;
  if (timeMatch) {
    let hr = Number(timeMatch[1]);
    const mn = Number(timeMatch[2] ?? "0");
    const mer = timeMatch[3].toLowerCase();
    if (mer === "pm" && hr < 12) hr += 12;
    if (mer === "am" && hr === 12) hr = 0;
    proposedStartMinutes = hr * 60 + mn;
  }

  const isTomorrow = lower.includes("tomorrow") || device === "android";
  const isRecurring =
    lower.includes("weekly") ||
    lower.includes("recurring") ||
    lower.includes("every ");
  const isMeetingLike =
    proposedStartMinutes !== undefined &&
    (lower.includes("zoom") ||
      lower.includes("meet") ||
      lower.includes("call") ||
      lower.includes("sync") ||
      lower.includes("chat") ||
      lower.includes("invite") ||
      lower.includes("coffee"));

  if (isMeetingLike && proposedStartMinutes !== undefined) {
    return {
      hasActionableItem: true,
      title: clean.length > 56 ? `${clean.slice(0, 53)}...` : clean,
      summary: `Meeting mention detected (${clean})`,
      detectedKind: "meeting",
      estimatedMinutes: lower.includes("15") ? 15 : lower.includes("hour") ? 60 : 30,
      proposedStartMinutes,
      proposedDayOffset: isTomorrow ? 1 : 0,
      isRecurringMention: isRecurring,
      isSoloInvite: true,
      locationOrUrl: lower.includes("zoom") ? "Zoom (solo hold)" : undefined,
    };
  }

  const isShortReply =
    lower.includes("reply") ||
    lower.includes("respond") ||
    lower.includes("confirm") ||
    lower.includes("ping");

  return {
    hasActionableItem: true,
    title: clean.length > 56 ? `${clean.slice(0, 53)}...` : clean,
    summary: clean,
    detectedKind: isShortReply ? "follow-up" : "deep-work",
    estimatedMinutes: isShortReply ? 30 : 60,
    proposedDayOffset: isTomorrow ? 1 : 0,
  };
}

/**
 * Downsamples a video/canvas frame to an 8x8 grayscale signature so static MacBook screens
 * are skipped automatically during 1-minute / 5-minute capture loops.
 */
export function computeCanvasLuminanceSignature(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): number[] {
  const sampleGrid = 8;
  const stepX = Math.max(1, Math.floor(width / sampleGrid));
  const stepY = Math.max(1, Math.floor(height / sampleGrid));
  const sig: number[] = [];

  for (let gy = 0; gy < sampleGrid; gy++) {
    for (let gx = 0; gx < sampleGrid; gx++) {
      const pixel = ctx.getImageData(gx * stepX, gy * stepY, 1, 1).data;
      const lum = Math.round(0.299 * pixel[0] + 0.587 * pixel[1] + 0.114 * pixel[2]);
      sig.push(lum);
    }
  }
  return sig;
}

export function signatureSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let totalDiff = 0;
  for (let i = 0; i < a.length; i++) {
    totalDiff += Math.abs(a[i] - b[i]);
  }
  const avgDiff = totalDiff / a.length;
  return Math.max(0, 1 - avgDiff / 255);
}
