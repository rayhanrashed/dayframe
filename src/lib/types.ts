export type CaptureSource =
  | "mac-mail"
  | "mac-slack"
  | "mac-screen"
  | "mac-calendar"
  | "android-queue"
  | "uploaded";

export type CalendarBlockKind =
  | "meeting"
  | "prep"
  | "deep-work"
  | "follow-up"
  | "buffer";

export type BlockStatus = "confirmed" | "auto-scheduled" | "needs-slot";

export interface CalendarBlock {
  id: string;
  title: string;
  kind: CalendarBlockKind;
  status: BlockStatus;
  /** 0 = Today, 1 = Tomorrow */
  dayOffset: number;
  /** Minutes from 00:00 (e.g. 540 = 9:00 AM) */
  startMinutes: number;
  /** Duration in minutes (15-min increments) */
  durationMinutes: number;
  sourceCaptureId?: string;
  linkedMeetingId?: string;
  ruleId?: string;
  isRecurring?: boolean;
  /** True when created from an email/Slack mention as a personal calendar hold ("just for me") */
  isSoloHold?: boolean;
  locationOrUrl?: string;
  sourceLabel?: string;
  rationale: string;
  confidence: number;
  userFeedbackNote?: string;
  isSample?: boolean;
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
  /** Regex or keyword list matched against meeting/task titles */
  triggerPattern?: string;
  /** Applies to all recurring meetings when true */
  appliesToRecurring?: boolean;
  /** Minutes of prep work to schedule */
  prepDurationMinutes?: number;
  /** Minimum minutes before the meeting that prep must start/finish (e.g. 120 = 2 hours before) */
  minLeadMinutesBeforeMeeting?: number;
  /** Duration adjustment factor or fixed override for matching tasks */
  durationMultiplier?: number;
  fixedMinutesOverride?: number;
  /** Protected window in minutes from midnight (for availability rules) */
  protectedWindow?: { startMinutes: number; endMinutes: number; label: string };
  createdFromFeedback?: boolean;
}

export interface ExtractedCaptureSignal {
  hasActionableItem: boolean;
  summary: string;
  title: string;
  detectedKind: CalendarBlockKind;
  estimatedMinutes: number;
  /** Specific time if mentioned in an email/Slack invite (minutes from midnight) */
  proposedStartMinutes?: number;
  proposedDayOffset?: number;
  isRecurringMention?: boolean;
  isSoloInvite?: boolean;
  locationOrUrl?: string;
  deduplicatedWithCaptureId?: string;
  fingerprintKey?: string;
}

export interface ScreenshotCapture {
  id: string;
  timestampIso: string;
  source: CaptureSource;
  device: "macbook" | "android";
  appName: string;
  windowTitle: string;
  ocrPreview: string;
  imageDataUrl: string;
  syncState: "scheduled" | "queued-for-tonight" | "deduplicated" | "no-action";
  extractedSignal?: ExtractedCaptureSignal;
  createdBlockId?: string;
  isSample?: boolean;
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

export interface CaptureSettings {
  intervalMinutes: number;
  skipDuplicateFrames: boolean;
  pauseOnPrivateApps: boolean;
  autoScheduleHighConfidence: boolean;
  workdayStartMinutes: number;
  workdayEndMinutes: number;
  minGapBetweenBlocksMinutes: number;
  nightlyAndroidSyncHour: number; // e.g. 23 = 11:00 PM
  ollamaModel: string;
}
