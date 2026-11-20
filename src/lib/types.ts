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

export interface CalendarBlock {
  id: string;
  title: string;
  kind: CalendarBlockKind;
  status: BlockStatus;
  /** Local date string YYYY-MM-DD */
  dateKey: string;
  /** Minutes from 00:00 local time (e.g. 540 = 9:00 AM) */
  startMinutes: number;
  /** Duration in minutes (15-min increments) */
  durationMinutes: number;
  isRecurring?: boolean;
  /** Personal hold created just for you from an email or Slack mention */
  isSoloHold?: boolean;
  locationOrUrl?: string;
  notes?: string;
  attendeeCount?: number;
  attendeeNames?: string[];
  organizerName?: string;
  hasVideoLink?: boolean;
  calendarTitle?: string;
  calendarImmutable?: boolean;
  isDayframeCreated?: boolean;
  externalEventId?: string;
  syncedToExternalCalendar?: boolean;
  linkedMeetingId?: string;
  sourceCaptureId?: string;
  ruleId?: string;
  sourceLabel: string;
  /** Concrete evidence from Calendar attendees/agenda, Slack, or Email */
  rationale: string;
  contextSources?: string[];
  confidence: number;
  clarifyingQuestion?: string;
  uncertaintyReason?: string;
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
  writableCalendarId: string;
  writableCalendarTitle: string;
  autoWriteToCalendar: boolean;
  intervalMinutes: number;
  skipDuplicateFrames: boolean;
  workdayStartMinutes: number;
  workdayEndMinutes: number;
  minGapBetweenBlocksMinutes: number;
  nightlyAndroidSyncHour: number;
}
