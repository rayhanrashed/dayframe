import { addDaysToDateKey } from "./scheduler";

const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  couple: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const KNOWN_ACRONYMS: Record<string, string> = {
  aiim: "AIIM",
  nsf: "NSF",
  grfp: "GRFP",
  nih: "NIH",
  darpa: "DARPA",
  chi: "CHI",
  uist: "UIST",
  cscw: "CSCW",
  icml: "ICML",
  neurips: "NeurIPS",
  iclr: "ICLR",
  acl: "ACL",
  emnlp: "EMNLP",
  cvpr: "CVPR",
  aaai: "AAAI",
  arxiv: "arXiv",
  umich: "UMich",
  eecs: "EECS",
  cse: "CSE",
  msi: "MSI",
  hci: "HCI",
  ai: "AI",
  ml: "ML",
  nlp: "NLP",
  llm: "LLM",
  llms: "LLMs",
  vlm: "VLM",
  phd: "PhD",
  irb: "IRB",
  cv: "CV",
  sop: "SoP",
  pr: "PR",
  api: "API",
  gpu: "GPU",
  ui: "UI",
  ux: "UX",
  1: "1",
};

const MINOR_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "via",
  "with",
]);

function parseCountToken(raw?: string): number | null {
  if (!raw) return null;
  const clean = raw.trim().toLowerCase();
  if (/^\d+(?:\.\d+)?$/.test(clean)) return Number(clean);
  if (WORD_NUMBERS[clean] !== undefined) return WORD_NUMBERS[clean];
  return null;
}

export function parseDurationPhraseToMinutes(text: string): number | null {
  const lower = text.toLowerCase();

  // "one-hour", "two-hour", "1.5 hour", "2 hours", "90 min"
  const hyphenUnit = lower.match(
    /\b(a|an|one|two|three|four|five|six|\d+(?:\.\d+)?)[-\s]+(hour|hr|h|minute|min|m)s?\b/
  );
  if (hyphenUnit) {
    const qty = parseCountToken(hyphenUnit[1]);
    if (qty !== null) {
      const unit = hyphenUnit[2];
      const mins = unit.startsWith("h") ? qty * 60 : qty;
      return Math.max(15, Math.round(mins / 15) * 15);
    }
  }

  if (/\bhalf\s+(?:an\s+)?hour\b/.test(lower)) return 30;
  return null;
}

/**
 * Produces a clean, standard calendar title from messy natural language input.
 * Example:
 *   "aiim fellowship. 2 hours each week for the next two weeks." -> "AIIM Fellowship"
 *   "draftnsf grfp research plan 3 hours by friday" -> "Draft NSF GRFP Research Plan"
 */
export function canonicalizeTaskTitle(rawInput: string): string {
  let cleaned = rawInput.trim();

  // Strip scheduling/cadence/duration clauses so they never pollute the calendar event name
  const stripPatterns: RegExp[] = [
    /[.,;:-]?\s*\b(?:add|schedule|put|block|create|reserve)\s+(?:a|an|one|two|three|four|five|six|\d+)\s+[-\w\s]*?\b(?:block|blocks|session|sessions|slot|slots)\b.*$/i,
    /[.,;:-]?\s*\b\d+(?:\.\d+)?\s*(?:hour|hr|h|minute|min|m)s?\s+(?:each|every|per|a)\s+week\b.*$/i,
    /[.,;:-]?\s*\b(?:one|two|three|four|five|six)\s*(?:hour|hr|minute|min)s?\s+(?:each|every|per|a)\s+week\b.*$/i,
    /[.,;:-]?\s*\bfor\s+the\s+next\s+(?:a|an|one|two|three|four|five|six|\d+)\s+(?:day|days|week|weeks|month|months)\b.*$/i,
    /[.,;:-]?\s*\b(?:each|every|per)\s+week\s+for\s+(?:the\s+next\s+)?(?:one|two|three|four|five|six|\d+)\s+weeks?\b.*$/i,
    /[.,;:-]?\s*\banytime\s+from\s+today\b.*$/i,
    /[.,;:-]?\s*\b(?:from\s+today\s+)?(?:to\s+)?until\s+(?:the\s+)?meeting(?:\s+time)?\b.*$/i,
    /[.,;:-]?\s*\b(?:due|by|before)\s+\d{4}-\d{2}-\d{2}\b.*$/i,
    /[.,;:-]?\s*\b(?:for|about|around|~)\s*\d+(?:\.\d+)?\s*(?:hour|hr|h|minute|min|m)s?\b.*$/i,
    /^(?:please\s+|can\s+you\s+|i\s+need\s+to\s+|i\s+want\s+to\s+|task:\s*|todo:\s*)/i,
  ];

  for (const pat of stripPatterns) {
    cleaned = cleaned.replace(pat, " ");
  }

  cleaned = cleaned
    .replace(/\s+/g, " ")
    .replace(/^[.,;:\-\s]+|[.,;:\-\s]+$/g, "")
    .trim();

  if (!cleaned) {
    cleaned = rawInput.trim().slice(0, 60);
  }

  const words = cleaned.split(/\s+/);
  return words
    .map((word, idx) => {
      const bare = word.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");
      const lower = bare.toLowerCase();
      if (!bare) return word;

      if (KNOWN_ACRONYMS[lower]) {
        return word.replace(bare, KNOWN_ACRONYMS[lower]);
      }

      // Preserve intentional mixed/ALL-CAPS tokens entered by the user (e.g. "EECS598", "Rackham")
      if (bare !== lower && /[A-Z]/.test(bare)) {
        return word;
      }

      // Short 3-4 letter all-consonant or fellowship-like acronym heuristic before "fellowship/grant/lab/conf"
      if (
        idx === 0 &&
        bare.length >= 3 &&
        bare.length <= 5 &&
        words[1] &&
        /^(fellowship|grant|award|scholarship|lab|workshop|conference|submission|deadline|project)$/i.test(
          words[1].replace(/[^a-zA-Z]/g, "")
        ) &&
        !/^(write|draft|read|send|make|plan|prep|work|call|meet|book|edit|test)$/i.test(
          bare
        )
      ) {
        return word.replace(bare, bare.toUpperCase());
      }

      if (idx > 0 && MINOR_WORDS.has(lower)) {
        return lower;
      }

      return word.replace(
        bare,
        bare.charAt(0).toUpperCase() + bare.slice(1).toLowerCase()
      );
    })
    .join(" ");
}

export interface ParsedNaturalScheduleRequest {
  canonicalTitle: string;
  mode: "single-or-project" | "weekly-cadence" | "explicit-block-count";
  /** Used for single-or-project mode */
  gutMinutes?: number;
  hasExplicitDuration: boolean;
  /** Used for weekly-cadence mode (e.g. "2 hours each week for the next two weeks") */
  weeklyCadence?: {
    minutesPerWeek: number;
    weeksCount: number;
    sessionsPerWeek?: number;
  };
  /** Used for explicit-block-count mode (e.g. "two one-hour blocks") */
  explicitBlocks?: {
    count: number;
    durationMinutesEach: number;
  };
  deadlineDateKey?: string;
}

export function parseNaturalTaskInput(params: {
  rawText: string;
  fallbackGutMinutes: number;
  explicitDeadlineDateKey?: string;
  todayKey: string;
}): ParsedNaturalScheduleRequest {
  const {
    rawText,
    fallbackGutMinutes,
    explicitDeadlineDateKey,
    todayKey,
  } = params;
  const lower = rawText.toLowerCase();
  const canonicalTitle = canonicalizeTaskTitle(rawText);

  // 1. Detect explicit deadline date in text if not picked in date input
  let deadlineDateKey = explicitDeadlineDateKey;
  const isoMatch = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (!deadlineDateKey && isoMatch) {
    deadlineDateKey = isoMatch[1];
  } else if (!deadlineDateKey && /\btomorrow\b/.test(lower)) {
    deadlineDateKey = addDaysToDateKey(todayKey, 1);
  }

  // 2. Detect Weekly Cadence: e.g. "2 hours each week for the next two weeks"
  const weeklyMatch = lower.match(
    /\b(a|an|one|two|three|four|five|six|\d+(?:\.\d+)?)\s*(hour|hr|h|minute|min|m)s?\s+(?:each|every|per|a)\s+week(?:\s+for\s+(?:the\s+next\s+)?(one|two|three|four|five|six|\d+)\s+weeks?)?/i
  );
  if (weeklyMatch) {
    const qty = parseCountToken(weeklyMatch[1]) ?? 2;
    const unit = weeklyMatch[2];
    const minutesPerWeek = Math.max(
      15,
      Math.round((unit.startsWith("h") ? qty * 60 : qty) / 15) * 15
    );
    const weeksCount = Math.max(
      1,
      Math.min(12, Math.round(parseCountToken(weeklyMatch[3]) ?? 2))
    );
    return {
      canonicalTitle,
      mode: "weekly-cadence",
      hasExplicitDuration: true,
      weeklyCadence: {
        minutesPerWeek,
        weeksCount,
      },
      deadlineDateKey,
    };
  }

  // 3. Detect Explicit Block Count: e.g. "two one-hour blocks", "3 45-minute sessions"
  const multiBlockMatch = lower.match(
    /\b(one|two|three|four|five|six|\d+)\s+(a|an|one|two|three|four|\d+(?:\.\d+)?)[-\s]*(hour|hr|h|minute|min|m)s?\s+(?:block|blocks|session|sessions|slot|slots)\b/i
  );
  if (multiBlockMatch) {
    const count = Math.max(
      1,
      Math.min(10, Math.round(parseCountToken(multiBlockMatch[1]) ?? 2))
    );
    const durQty = parseCountToken(multiBlockMatch[2]) ?? 1;
    const unit = multiBlockMatch[3];
    const durationMinutesEach = Math.max(
      15,
      Math.min(
        180,
        Math.round((unit.startsWith("h") ? durQty * 60 : durQty) / 15) * 15
      )
    );
    return {
      canonicalTitle,
      mode: "explicit-block-count",
      hasExplicitDuration: true,
      explicitBlocks: {
        count,
        durationMinutesEach,
      },
      deadlineDateKey,
    };
  }

  // 4. Detect single explicit duration in text: e.g. "review paper 90m" or "fellowship draft 6 hours"
  const parsedDur = parseDurationPhraseToMinutes(rawText);
  return {
    canonicalTitle,
    mode: "single-or-project",
    gutMinutes: parsedDur ?? fallbackGutMinutes,
    hasExplicitDuration: parsedDur !== null,
    deadlineDateKey,
  };
}

export type EventChatIntent =
  | {
      kind: "schedule-blocks-for-event";
      count: number;
      durationMinutesEach: number;
      beforeEventTime: boolean;
      customLabel?: string;
    }
  | {
      kind: "pull-context-and-papers";
      focusQuery?: string;
    }
  | {
      kind: "add-subtask";
      todoText: string;
    }
  | {
      kind: "add-reminder";
      reminderText: string;
      leadMinutes?: number;
    }
  | {
      kind: "add-paper";
      paperTitle: string;
      url?: string;
    }
  | {
      kind: "rename-event";
      newTitle: string;
    }
  | {
      kind: "resize-event";
      durationMinutes: number;
    }
  | {
      kind: "move-event-days";
      deltaDays: number;
    }
  | {
      kind: "ask-event-copilot";
      prompt: string;
    };

/**
 * Parses direct conversational instructions sent inside an individual Calendar Event's chat!
 * Example:
 *   "add two one-hour block to prepare for this anytime from today to until the meeting time"
 *   -> { kind: "schedule-blocks-for-event", count: 2, durationMinutesEach: 60, beforeEventTime: true }
 */
export function parseEventChatCommand(rawText: string): EventChatIntent {
  const trimmed = rawText.trim();
  const lower = trimmed.toLowerCase();

  // 1. Add N prep / work blocks before or around this event
  // Matches: "add two one-hour block to prepare for this...", "schedule 3 45m sessions before this", "add 1 hour prep"
  const multiPrepMatch = lower.match(
    /\b(?:add|schedule|put|block|create|reserve)\s+(?:(a|an|one|two|couple|three|four|five|six|\d+)\s+)?(?:(a|an|one|two|three|four|\d+(?:\.\d+)?)[-\s]*(hour|hr|h|minute|min|m)s?)\s*(?:block|blocks|session|sessions|slot|slots|of\s+prep|prep)?/i
  );
  if (
    multiPrepMatch &&
    (lower.includes("prep") ||
      lower.includes("block") ||
      lower.includes("session") ||
      lower.includes("slot") ||
      lower.includes("until") ||
      lower.includes("before"))
  ) {
    const count = Math.max(
      1,
      Math.min(8, Math.round(parseCountToken(multiPrepMatch[1]) ?? 1))
    );
    const durQty = parseCountToken(multiPrepMatch[2]) ?? 1;
    const unit = multiPrepMatch[3] || "h";
    const durationMinutesEach = Math.max(
      15,
      Math.min(
        180,
        Math.round((unit.startsWith("h") ? durQty * 60 : durQty) / 15) * 15
      )
    );
    const beforeEventTime =
      !lower.includes("after") ||
      lower.includes("until") ||
      lower.includes("before") ||
      lower.includes("prepare") ||
      lower.includes("prep");

    return {
      kind: "schedule-blocks-for-event",
      count,
      durationMinutesEach,
      beforeEventTime,
    };
  }

  // 2. Pull context from email / Slack / papers
  if (
    /\b(read|pull|fetch|find|search|check|sync|gather|attach)\b.*\b(context|email|emails|mail|slack|chat|messages|paper|papers|pdf|pdfs|details)\b/i.test(
      lower
    ) ||
    /\brelevant\s+(papers?|emails?|context|messages?)\b/i.test(lower)
  ) {
    return {
      kind: "pull-context-and-papers",
    };
  }

  // 3. Explicit paper addition ("paper: Title" or URL to arxiv/openreview/doi)
  const urlMatch = trimmed.match(/https?:\/\/\S+/i);
  if (
    /^add\s+paper[:\s]+/i.test(trimmed) ||
    /^paper[:\s]+/i.test(trimmed) ||
    (urlMatch && /arxiv\.org|openreview\.net|acm\.org|semanticscholar/i.test(urlMatch[0]))
  ) {
    const cleanPaper = trimmed
      .replace(/^(?:add\s+)?paper[:\s]+/i, "")
      .replace(/https?:\/\/\S+/i, "")
      .trim();
    return {
      kind: "add-paper",
      paperTitle: cleanPaper || urlMatch?.[0] || "Referenced paper",
      url: urlMatch?.[0],
    };
  }

  // 4. Add todo / checklist item
  const todoMatch = trimmed.match(
    /^(?:add\s+)?(?:todo|to-do|task|check|next\s+step|action)[:\s-]+(.+)$/i
  );
  if (todoMatch) {
    return {
      kind: "add-subtask",
      todoText: todoMatch[1].trim(),
    };
  }

  // 5. Add reminder
  if (/^(?:remind\s+me|add\s+reminder|reminder)[:\s-]*/i.test(trimmed)) {
    const leadMatch = lower.match(/(\d+)\s*(min|minute|m|hr|hour|h)s?\s*before/);
    const leadMinutes = leadMatch
      ? leadMatch[2].startsWith("h")
        ? Number(leadMatch[1]) * 60
        : Number(leadMatch[1])
      : undefined;
    const reminderText = trimmed
      .replace(/^(?:remind\s+me(?:\s+to)?|add\s+reminder|reminder)[:\s-]*/i, "")
      .trim();
    return {
      kind: "add-reminder",
      reminderText: reminderText || trimmed,
      leadMinutes,
    };
  }

  // 6. Rename title
  const renameMatch = trimmed.match(
    /^(?:rename(?:\s+this)?\s+to|call\s+this|title:)[:\s]*(.+)$/i
  );
  if (renameMatch) {
    return {
      kind: "rename-event",
      newTitle: canonicalizeTaskTitle(renameMatch[1]),
    };
  }

  // 7. Resize duration ("make this 90 minutes" / "change duration to 1h")
  if (/^(?:make\s+this|resize\s+to|set\s+duration\s+to)\b/i.test(lower)) {
    const dur = parseDurationPhraseToMinutes(trimmed);
    if (dur) {
      return { kind: "resize-event", durationMinutes: dur };
    }
  }

  // 8. Move tomorrow / next day
  if (/\bmove\s+(?:this\s+)?to\s+tomorrow\b/i.test(lower)) {
    return { kind: "move-event-days", deltaDays: 1 };
  }

  return {
    kind: "ask-event-copilot",
    prompt: trimmed,
  };
}
