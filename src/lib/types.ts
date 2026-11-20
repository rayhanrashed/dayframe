export type CalendarSourceMode = "none" | "macos-bridge";

export type CaptureEngineMode = "macos-native" | "browser-screen";

export type BatchExecutionMode = "scheduled-batches" | "instant-per-capture";

export type ConfirmationPolicy =
  | "ask-often"
  | "always-ask"
  | "auto-high-confidence";

export type CalendarBlockKind =
  | "meeting"
  | "prep"
  | "deep-work"
  | "follow-up";

export type BlockStatus = "confirmed" | "proposed" | "auto-scheduled";

export interface BusyDateRange {
  id: string;
  label: string;
  startDateKey: string;
  endDateKey: string;
}

export interface CalibrationSample {
  id: string;
  title: string;
  gutMinutes: number;
  scheduledMinutes: number;
  actualMinutes: number;
  completedAtIso: string;
}

export interface EventSubtask {
  id: string;
  text: string;
  done: boolean;
  source?: string;
}

export interface EventReminderItem {
  id: string;
  text: string;
  leadMinutes?: number;
}

export interface RelevantPaperRef {
  id: string;
  title: string;
  authorsOrVenue?: string;
  pathOrUrl?: string;
  source: "local-pdf" | "mail-or-slack" | "screen" | "manual";
}

export interface EventChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestampIso: string;
  actionBadge?: string;
}

export interface StagedCandidateAddition {
  id: string;
  kind: "paper" | "subtask" | "context-note" | "solo-prep-slot";
  title: string;
  detail?: string;
  reason?: string;
  pathOrUrl?: string;
  authorsOrVenue?: string;
  leadMinutes?: number;
  proposedSlot?: {
    sessionTitle: string;
    dateKey: string;
    startMinutes: number;
    durationMinutes: number;
  };
}

/**
 * Private Dayframe-only overlay augmenting a Calendar event without ever mutating
 * shared/multi-person invites in Calendar.app (stored locally in ~/.dayframe/event-augmentations.json).
 */
export interface EventAugmentation {
  eventKey: string;
  customDisplayTitle?: string;
  privateNotes: string;
  subtasks: EventSubtask[];
  approvedPapers: RelevantPaperRef[];
  privateReminders: EventReminderItem[];
  stagedCandidates: StagedCandidateAddition[];
  eventChat: EventChatMessage[];
  updatedAtIso: string;
}

export interface CalendarBlock {
  id: string;
  title: string;
  userEditedTitle?: boolean;
  kind: CalendarBlockKind;
  status: BlockStatus;
  /** Local date string YYYY-MM-DD */
  dateKey: string;
  /** Minutes from 00:00 local time (e.g. 540 = 9:00 AM) */
  startMinutes: number;
  /** Duration in minutes (15-min increments) */
  durationMinutes: number;
  /** Original uncalibrated gut estimate in minutes */
  gutMinutes?: number;
  /** Optional hard deadline YYYY-MM-DD */
  deadlineDateKey?: string;
  /** Shared ID linking segments of a decomposed project */
  projectGroupId?: string;
  /** Connected Task-Specific Model ID in the user's knowledge graph */
  taskModelId?: string;
  isRecurring?: boolean;
  /** Personal hold created just for you from an email or Slack mention */
  isSoloHold?: boolean;
  locationOrUrl?: string;
  notes?: string;
  subtasks?: EventSubtask[];
  reminders?: EventReminderItem[];
  relevantPapers?: RelevantPaperRef[];
  stagedCandidates?: StagedCandidateAddition[];
  eventChat?: EventChatMessage[];
  attendeeCount?: number;
  attendeeNames?: string[];
  organizerName?: string;
  hasVideoLink?: boolean;
  calendarId?: string;
  calendarTitle?: string;
  calendarSourceTitle?: string;
  /** Event on another selected read-calendar: blocks busy time, never gets prep or writes */
  occupiesTimeOnly?: boolean;
  done?: boolean;
  completedAtIso?: string;
  actualMinutesTaken?: number;
  calendarImmutable?: boolean;
  isDayframeCreated?: boolean;
  externalEventId?: string;
  syncedToExternalCalendar?: boolean;
  linkedMeetingId?: string;
  sourceCaptureId?: string;
  ruleId?: string;
  sourceLabel: string;
  rationale: string;
  contextSources?: string[];
  confidence: number;
  clarifyingQuestion?: string;
  uncertaintyReason?: string;
}

/**
 * Hierarchical User & Task-Specific Model Graph
 * Inspired by Activity Theory & Tempo (StanfordHCI/striving-cocreation):
 * Observations -> Cross-App Actions -> Task-Specific Models (Activities) -> Personal Strivings,
 * with contestable [user-edited], merge, reassign, and remove constraints.
 */
export interface UserProfileModel {
  roleAndAffiliation: string;
  activeDomains: string;
  workingStyleNotes: string;
  currentPriorities: string;
}

export interface TaskEvidenceItem {
  id: string;
  source: "mail" | "slack" | "screen" | "calendar" | "local-pdf" | "user";
  title: string;
  snippet: string;
  timestampIso: string;
  pathOrUrl?: string;
}

export interface TaskSpecificModel {
  id: string;
  canonicalTitle: string;
  keywords: string[];
  parentStrivingId?: string;
  summary: string;
  cadenceNote?: string;
  deadlineDateKey?: string;
  typicalSessionMinutes: number;
  immediateTodos: EventSubtask[];
  relevantPapers: RelevantPaperRef[];
  evidence: TaskEvidenceItem[];
  userEdited?: boolean;
  userReassigned?: boolean;
  updatedAtIso: string;
}

export interface StrivingNode {
  id: string;
  title: string;
  domain:
    | "research"
    | "funding-career"
    | "collaboration"
    | "teaching-service"
    | "personal-grounding";
  description: string;
  confidence: number;
  userEdited?: boolean;
}

export interface ModelEditConstraint {
  id: string;
  kind: "rename" | "merge" | "reassign" | "remove";
  instruction: string;
  createdAtIso: string;
}

export interface UserModelGraph {
  profile: UserProfileModel;
  strivings: StrivingNode[];
  taskModels: TaskSpecificModel[];
  constraints: ModelEditConstraint[];
}

export interface LocalPaperHit {
  title: string;
  filename: string;
  path: string;
  modifiedIso: string;
}

export interface CapturedContextWindow {
  windowId: number;
  ownerName: string;
  windowTitle: string;
  kind: "slack" | "email" | "messaging" | "work-context" | string;
  imageDataUrl: string;
}

export type RuleCategory =
  | "prep-time"
  | "duration-calibration"
  | "availability"
  | "solo-invite"
  | "auto-confirm"
  | "ignore-pattern";

export interface StandingRule {
  id: string;
  title: string;
  description: string;
  category: RuleCategory;
  enabled: boolean;
  triggerPattern?: string;
  appliesToRecurring?: boolean;
  prepDurationMinutes?: number;
  minLeadMinutesBeforeMeeting?: number;
  fixedMinutesOverride?: number;
  protectedWindow?: { startMinutes: number; endMinutes: number; label: string };
  createdFromFeedback?: boolean;
}

export interface ExtractedCaptureSignal {
  hasActionableItem: boolean;
  title: string;
  summary: string;
  contextEvidence?: string;
  detectedKind: CalendarBlockKind;
  estimatedMinutes: number;
  deadlineDateKey?: string;
  proposedDateKey?: string;
  proposedStartMinutes?: number;
  linkedMeetingId?: string;
  isRecurringMention?: boolean;
  isSoloInvite?: boolean;
  locationOrUrl?: string;
  fingerprintKey?: string;
  confidence?: number;
  needsUserConfirmation?: boolean;
  clarifyingQuestion?: string;
  uncertaintyReason?: string;
}

export interface ScreenshotCapture {
  id: string;
  diskQueueId?: string;
  timestampIso: string;
  device: "macbook" | "android";
  appName: string;
  windowTitle: string;
  summaryText: string;
  imageDataUrl: string;
  modelUsed: string;
  inferenceMs?: number;
  valenGate?: {
    signalProbability: number;
    intentChoice: string;
    urgencyScore: number;
    latencyMs: number;
    bboxCropped?: boolean;
  };
  syncState:
    | "queued-for-batch"
    | "awaiting-confirmation"
    | "scheduled"
    | "queued-for-tonight"
    | "deduplicated"
    | "no-action"
    | "filtered-by-valen"
    | "needs-gemma";
  extractedSignal?: ExtractedCaptureSignal;
  createdBlockId?: string;
}

export interface GatekeeperStats {
  totalScreened: number;
  filteredNoiseCount: number;
  privacyDroppedCount: number;
  routedToGemmaCount: number;
}

export interface ModelLifecycleState {
  allModelsSleeping: boolean;
  valenRunning: boolean;
  ollamaDaemonRunning: boolean;
  loadedOllamaModels: string[];
  residentAiRamMb: number;
  activePhase:
    | "sleeping"
    | "waking-valen"
    | "screening-valen"
    | "waking-gemma"
    | "reasoning-gemma"
    | "unloading";
  lastBatchCompletedIso?: string;
}

export interface MacCalendarDescriptor {
  id: string;
  title: string;
  sourceTitle: string;
  allowsModify: boolean;
  isDefault: boolean;
}

export interface ScannedEmailItem {
  id: string;
  subject: string;
  sender: string;
  dateIso: string;
  snippet: string;
  source: "apple-mail";
}

export interface PipelineLogEntry {
  id: string;
  timestampIso: string;
  stage:
    | "setup"
    | "scan"
    | "capture"
    | "lifecycle"
    | "valen-gate"
    | "gemma4"
    | "ask-user"
    | "calendar-write"
    | "feedback";
  title: string;
  detail: string;
  modelUsed?: string;
  latencyMs?: number;
}

export interface DiscussionMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestampIso: string;
  appliedActionSummary?: string;
}

export interface SuggestedPreferencePrompt {
  id: string;
  question: string;
  whyItMatters: string;
  acceptLabel: string;
  ruleToCreate: Omit<StandingRule, "id">;
  answered?: "accepted" | "dismissed";
}

export interface OrganizerSettings {
  setupCompleted: boolean;
  lastInitialScanIso?: string;
  lastBatchRunIso?: string;
  gemmaModel: string;
  valenEnabled: boolean;
  valenModelId: string;
  valenPort: number;
  valenSignalThreshold: number;
  batchExecutionMode: BatchExecutionMode;
  batchWindowMinutes: number[];
  unloadModelsAfterBatch: boolean;
  confirmationPolicy: ConfirmationPolicy;
  calendarSource: CalendarSourceMode;
  captureEngine: CaptureEngineMode;
  readCalendarIds: string[];
  readCalendarScopeInitialized: boolean;
  writableCalendarId: string;
  writableCalendarTitle: string;
  writableCalendarSource: string;
  pinnedWriteCalendar: boolean;
  calibrationMultiplier: number;
  dailyBufferMinutes: number;
  protectWeekends: boolean;
  notAMorningPersonUntilMinutes: number;
  busyDateRanges: BusyDateRange[];
  timelineHorizonDays: 2 | 7;
  autoWriteToCalendar: boolean;
  intervalMinutes: number;
  skipDuplicateFrames: boolean;
  workdayStartMinutes: number;
  workdayEndMinutes: number;
  minGapBetweenBlocksMinutes: number;
  nightlyAndroidSyncHour: number;
}
