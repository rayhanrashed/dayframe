export type CalendarSourceMode = "none" | "macos-bridge" | "google-api";

export type CaptureEngineMode = "macos-native" | "browser-screen";

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
  calendarTitle?: string;
  externalEventId?: string;
  syncedToExternalCalendar?: boolean;
  linkedMeetingId?: string;
  sourceCaptureId?: string;
  ruleId?: string;
  sourceLabel: string;
  rationale: string;
  confidence: number;
}

export type RuleCategory =
  | "prep-time"
  | "duration-calibration"
  | "availability"
  | "solo-invite";

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
  detectedKind: CalendarBlockKind;
  estimatedMinutes: number;
  proposedDateKey?: string;
  proposedStartMinutes?: number;
  isRecurringMention?: boolean;
  isSoloInvite?: boolean;
  locationOrUrl?: string;
  fingerprintKey?: string;
}

export interface ScreenshotCapture {
  id: string;
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
  source: "apple-mail" | "gmail";
}

export interface PipelineLogEntry {
  id: string;
  timestampIso: string;
  stage:
    | "setup"
    | "scan"
    | "capture"
    | "valen-gate"
    | "gemma4"
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
  gemmaModel: string;
  valenEnabled: boolean;
  valenModelId: string;
  valenPort: number;
  valenSignalThreshold: number;
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
