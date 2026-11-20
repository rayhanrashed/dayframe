import {
  CalendarBlock,
  LocalPaperHit,
  ModelEditConstraint,
  RelevantPaperRef,
  ScannedEmailItem,
  ScreenshotCapture,
  StrivingNode,
  TaskEvidenceItem,
  TaskSpecificModel,
  UserModelGraph,
} from "./types";
import { canonicalizeTaskTitle } from "./nl-schedule-parser";

export const DEFAULT_USER_MODEL_GRAPH: UserModelGraph = {
  profile: {
    roleAndAffiliation: "Researcher at University of Michigan",
    activeDomains: "",
    workingStyleNotes:
      "Time-block tasks onto calendar rather than keeping unscheduled lists; prefer 60-90m focus blocks.",
    currentPriorities: "",
  },
  strivings: [],
  taskModels: [],
  constraints: [],
};

const STOP_KEYWORDS = new Set([
  "prep",
  "task",
  "focus",
  "week",
  "wk",
  "session",
  "block",
  "meeting",
  "sync",
  "call",
  "with",
  "for",
  "the",
  "and",
  "from",
  "draft",
  "review",
  "work",
  "plan",
  "scope",
  "final",
  "polish",
  "buffer",
]);

export function extractDistinctiveKeywords(title: string): string[] {
  const clean = title
    .replace(/—\s*Wk\s*\d+.*$/i, "")
    .replace(/\(\d+\/\d+\)/g, "")
    .replace(/^\[(Prep|Task|Focus|Solo Hold)\]\s*/i, "")
    .replace(/^Prep:\s*/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ");

  const tokens = clean
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP_KEYWORDS.has(t));

  return Array.from(new Set(tokens)).slice(0, 6);
}

export function stripSegmentSuffix(title: string): string {
  return canonicalizeTaskTitle(
    title
      .replace(/\s*—\s*(?:Wk\s*\d+|Scope & Plan|Core Draft|Final Polish & Buffer).*$/i, "")
      .replace(/\s*\(\d+\/\d+\)\s*$/g, "")
      .replace(/^Prep:\s*/i, "")
      .trim()
  );
}

export function findMatchingTaskModel(
  title: string,
  taskModels: TaskSpecificModel[]
): TaskSpecificModel | undefined {
  const base = stripSegmentSuffix(title).toLowerCase();
  if (!base) return undefined;

  for (const tm of taskModels) {
    if (tm.canonicalTitle.toLowerCase() === base) return tm;
  }

  const kw = extractDistinctiveKeywords(title);
  if (kw.length === 0) return undefined;

  let best: { model: TaskSpecificModel; score: number } | null = null;
  for (const tm of taskModels) {
    const tmKw = new Set(tm.keywords.map((k) => k.toLowerCase()));
    let hits = 0;
    for (const k of kw) {
      if (tmKw.has(k) || tm.canonicalTitle.toLowerCase().includes(k)) {
        hits++;
      }
    }
    const ratio = hits / Math.min(kw.length, Math.max(1, tmKw.size));
    if (hits >= 1 && ratio >= 0.6 && (!best || hits > best.score)) {
      best = { model: tm, score: hits };
    }
  }
  return best?.model;
}

export function upsertTaskModelFromSchedule(params: {
  graph: UserModelGraph;
  canonicalTitle: string;
  cadenceNote?: string;
  deadlineDateKey?: string;
  typicalSessionMinutes: number;
  matchedEmails?: ScannedEmailItem[];
  matchedPapers?: LocalPaperHit[];
}): { graph: UserModelGraph; taskModel: TaskSpecificModel } {
  const {
    graph,
    canonicalTitle,
    cadenceNote,
    deadlineDateKey,
    typicalSessionMinutes,
    matchedEmails = [],
    matchedPapers = [],
  } = params;

  const existing = findMatchingTaskModel(canonicalTitle, graph.taskModels);
  const nowIso = new Date().toISOString();

  const newEvidence: TaskEvidenceItem[] = [
    ...matchedEmails.map((em) => ({
      id: `ev-${em.id}`,
      source: "mail" as const,
      title: em.subject,
      snippet: `${em.sender}: ${em.snippet.slice(0, 220)}`,
      timestampIso: em.dateIso || nowIso,
    })),
    ...matchedPapers.map((p) => ({
      id: `ev-pdf-${p.filename}`,
      source: "local-pdf" as const,
      title: p.title,
      snippet: p.path,
      timestampIso: p.modifiedIso || nowIso,
      pathOrUrl: p.path,
    })),
  ];

  const newPapers: RelevantPaperRef[] = matchedPapers.map((p) => ({
    id: `paper-${p.filename}`,
    title: p.title,
    pathOrUrl: p.path,
    source: "local-pdf",
  }));

  if (existing) {
    const existingEvIds = new Set(existing.evidence.map((e) => e.id));
    const existingPaperTitles = new Set(
      existing.relevantPapers.map((p) => p.title.toLowerCase())
    );
    const updated: TaskSpecificModel = {
      ...existing,
      // Respect [user-edited] write guard (Tempo §3.2.2)
      canonicalTitle: existing.userEdited
        ? existing.canonicalTitle
        : canonicalTitle,
      cadenceNote: cadenceNote || existing.cadenceNote,
      deadlineDateKey: deadlineDateKey || existing.deadlineDateKey,
      typicalSessionMinutes:
        typicalSessionMinutes || existing.typicalSessionMinutes,
      evidence: [
        ...newEvidence.filter((e) => !existingEvIds.has(e.id)),
        ...existing.evidence,
      ].slice(0, 20),
      relevantPapers: [
        ...existing.relevantPapers,
        ...newPapers.filter(
          (p) => !existingPaperTitles.has(p.title.toLowerCase())
        ),
      ].slice(0, 12),
      updatedAtIso: nowIso,
    };

    return {
      graph: {
        ...graph,
        taskModels: graph.taskModels.map((m) =>
          m.id === existing.id ? updated : m
        ),
      },
      taskModel: updated,
    };
  }

  const created: TaskSpecificModel = {
    id: `tm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    canonicalTitle,
    keywords: extractDistinctiveKeywords(canonicalTitle),
    summary:
      matchedEmails.length > 0
        ? `Connected ${matchedEmails.length} related email(s): "${matchedEmails[0].subject}".`
        : `Ongoing task model for ${canonicalTitle}.`,
    cadenceNote,
    deadlineDateKey,
    typicalSessionMinutes,
    immediateTodos: [],
    relevantPapers: newPapers.slice(0, 8),
    evidence: newEvidence.slice(0, 15),
    updatedAtIso: nowIso,
  };

  return {
    graph: {
      ...graph,
      taskModels: [created, ...graph.taskModels],
    },
    taskModel: created,
  };
}

/**
 * Tempo §3.2 Contestable Editing Operations:
 * Inline Edit, Merge, Reassign, and Remove — each recording a persistent constraint
 * injected into all subsequent Gemma 4 induction cycles.
 */
export function renameTaskModelWithConstraint(
  graph: UserModelGraph,
  taskModelId: string,
  newTitle: string
): UserModelGraph {
  const target = graph.taskModels.find((m) => m.id === taskModelId);
  if (!target || !newTitle.trim()) return graph;
  const clean = newTitle.trim();
  const constraint: ModelEditConstraint = {
    id: `con-${Date.now()}`,
    kind: "rename",
    instruction: `[user-edited] Keep task model "${target.canonicalTitle}" named "${clean}" verbatim.`,
    createdAtIso: new Date().toISOString(),
  };
  return {
    ...graph,
    taskModels: graph.taskModels.map((m) =>
      m.id === taskModelId
        ? {
            ...m,
            canonicalTitle: clean,
            keywords: Array.from(
              new Set([...m.keywords, ...extractDistinctiveKeywords(clean)])
            ),
            userEdited: true,
            updatedAtIso: new Date().toISOString(),
          }
        : m
    ),
    constraints: [constraint, ...graph.constraints.slice(0, 29)],
  };
}

export function mergeTaskModelsWithConstraint(
  graph: UserModelGraph,
  keepId: string,
  absorbId: string
): UserModelGraph {
  if (keepId === absorbId) return graph;
  const keep = graph.taskModels.find((m) => m.id === keepId);
  const absorb = graph.taskModels.find((m) => m.id === absorbId);
  if (!keep || !absorb) return graph;

  const merged: TaskSpecificModel = {
    ...keep,
    keywords: Array.from(new Set([...keep.keywords, ...absorb.keywords])),
    immediateTodos: [...keep.immediateTodos, ...absorb.immediateTodos],
    relevantPapers: [
      ...keep.relevantPapers,
      ...absorb.relevantPapers.filter(
        (p) =>
          !keep.relevantPapers.some(
            (kp) => kp.title.toLowerCase() === p.title.toLowerCase()
          )
      ),
    ],
    evidence: [...keep.evidence, ...absorb.evidence].slice(0, 25),
    userEdited: true,
    updatedAtIso: new Date().toISOString(),
  };

  const constraint: ModelEditConstraint = {
    id: `con-${Date.now()}`,
    kind: "merge",
    instruction: `[user-merged] Always treat "${absorb.canonicalTitle}" as part of "${keep.canonicalTitle}" rather than a separate activity.`,
    createdAtIso: new Date().toISOString(),
  };

  return {
    ...graph,
    taskModels: graph.taskModels
      .filter((m) => m.id !== absorbId)
      .map((m) => (m.id === keepId ? merged : m)),
    constraints: [constraint, ...graph.constraints.slice(0, 29)],
  };
}

export function reassignTaskModelStriving(
  graph: UserModelGraph,
  taskModelId: string,
  strivingId: string | undefined
): UserModelGraph {
  const tm = graph.taskModels.find((m) => m.id === taskModelId);
  const st = graph.strivings.find((s) => s.id === strivingId);
  if (!tm) return graph;

  const constraint: ModelEditConstraint = {
    id: `con-${Date.now()}`,
    kind: "reassign",
    instruction: st
      ? `[user-reassigned] Activity "${tm.canonicalTitle}" serves striving "${st.title}".`
      : `[user-reassigned] Activity "${tm.canonicalTitle}" was detached from its previous striving.`,
    createdAtIso: new Date().toISOString(),
  };

  return {
    ...graph,
    taskModels: graph.taskModels.map((m) =>
      m.id === taskModelId
        ? { ...m, parentStrivingId: strivingId, userReassigned: true }
        : m
    ),
    constraints: [constraint, ...graph.constraints.slice(0, 29)],
  };
}

export function removeModelEntityWithConstraint(
  graph: UserModelGraph,
  kind: "striving" | "taskModel",
  id: string
): UserModelGraph {
  if (kind === "striving") {
    const target = graph.strivings.find((s) => s.id === id);
    if (!target) return graph;
    const constraint: ModelEditConstraint = {
      id: `con-${Date.now()}`,
      kind: "remove",
      instruction: `[user-removed] Do not infer striving "${target.title}".`,
      createdAtIso: new Date().toISOString(),
    };
    return {
      ...graph,
      strivings: graph.strivings.filter((s) => s.id !== id),
      taskModels: graph.taskModels.map((m) =>
        m.parentStrivingId === id ? { ...m, parentStrivingId: undefined } : m
      ),
      constraints: [constraint, ...graph.constraints.slice(0, 29)],
    };
  }

  const target = graph.taskModels.find((m) => m.id === id);
  if (!target) return graph;
  const constraint: ModelEditConstraint = {
    id: `con-${Date.now()}`,
    kind: "remove",
    instruction: `[user-removed] Do not create a task model for "${target.canonicalTitle}".`,
    createdAtIso: new Date().toISOString(),
  };
  return {
    ...graph,
    taskModels: graph.taskModels.filter((m) => m.id !== id),
    constraints: [constraint, ...graph.constraints.slice(0, 29)],
  };
}

export function renameStrivingWithConstraint(
  graph: UserModelGraph,
  strivingId: string,
  newTitle: string
): UserModelGraph {
  const target = graph.strivings.find((s) => s.id === strivingId);
  if (!target || !newTitle.trim()) return graph;
  const clean = newTitle.trim();
  const constraint: ModelEditConstraint = {
    id: `con-${Date.now()}`,
    kind: "rename",
    instruction: `[user-edited] Preserve striving "${clean}" verbatim (was "${target.title}").`,
    createdAtIso: new Date().toISOString(),
  };
  return {
    ...graph,
    strivings: graph.strivings.map((s) =>
      s.id === strivingId ? { ...s, title: clean, userEdited: true } : s
    ),
    constraints: [constraint, ...graph.constraints.slice(0, 29)],
  };
}

export function matchCapturesForKeywords(
  keywords: string[],
  captures: ScreenshotCapture[]
): ScreenshotCapture[] {
  if (keywords.length === 0) return [];
  return captures
    .filter((c) => {
      const blob = `${c.appName} ${c.windowTitle} ${c.summaryText} ${
        c.extractedSignal?.title || ""
      }`.toLowerCase();
      return keywords.some((k) => blob.includes(k));
    })
    .slice(0, 6);
}

export function computeStrivingAllocatedMinutes(
  striving: StrivingNode,
  taskModels: TaskSpecificModel[],
  blocks: CalendarBlock[]
): number {
  const childModelIds = new Set(
    taskModels
      .filter((m) => m.parentStrivingId === striving.id)
      .map((m) => m.id)
  );
  const childKeywords = taskModels
    .filter((m) => m.parentStrivingId === striving.id)
    .flatMap((m) => m.keywords);

  let mins = 0;
  for (const b of blocks) {
    if (b.occupiesTimeOnly) continue;
    if (b.taskModelId && childModelIds.has(b.taskModelId)) {
      mins += b.durationMinutes;
      continue;
    }
    const lower = b.title.toLowerCase();
    if (childKeywords.some((k) => k.length >= 3 && lower.includes(k))) {
      mins += b.durationMinutes;
    }
  }
  return mins;
}
