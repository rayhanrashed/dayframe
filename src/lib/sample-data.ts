import {
  CalendarBlock,
  CaptureSettings,
  DiscussionMessage,
  ScreenshotCapture,
  StandingRule,
  SuggestedPreferencePrompt,
} from "./types";

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function renderMacScreenshotSvg(opts: {
  app: "mail" | "slack";
  headerTitle: string;
  sender: string;
  senderMeta: string;
  line1: string;
  line2: string;
  highlightPill: string;
}): string {
  const accent = opts.app === "mail" ? "#2563eb" : "#7c3aed";
  const badgeBg = opts.app === "mail" ? "#dbeafe" : "#ede9fe";
  const badgeFg = opts.app === "mail" ? "#1d4ed8" : "#5b21b6";

  const escapeXml = (str: string) =>
    str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  return svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0f172a"/>
        <stop offset="100%" stop-color="#1e293b"/>
      </linearGradient>
    </defs>
    <rect width="640" height="360" fill="url(#bg)" rx="16"/>
    <rect x="28" y="24" width="584" height="312" rx="12" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5"/>
    <rect x="28" y="24" width="584" height="38" rx="12" fill="#f8fafc"/>
    <rect x="28" y="50" width="584" height="12" fill="#f8fafc"/>
    <line x1="28" y1="62" x2="612" y2="62" stroke="#e2e8f0" stroke-width="1"/>
    <circle cx="48" cy="43" r="5.5" fill="#ef4444"/>
    <circle cx="66" cy="43" r="5.5" fill="#f59e0b"/>
    <circle cx="84" cy="43" r="5.5" fill="#10b981"/>
    <text x="110" y="47" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="12" font-weight="600" fill="#334155">${escapeXml(
      opts.headerTitle
    )}</text>
    <circle cx="66" cy="102" r="18" fill="${accent}"/>
    <text x="66" y="107" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="13" font-weight="700" fill="#ffffff">${escapeXml(
      opts.sender.slice(0, 2).toUpperCase()
    )}</text>
    <text x="96" y="98" font-family="-apple-system, sans-serif" font-size="14" font-weight="700" fill="#0f172a">${escapeXml(
      opts.sender
    )}</text>
    <text x="96" y="116" font-family="-apple-system, sans-serif" font-size="11.5" fill="#64748b">${escapeXml(
      opts.senderMeta
    )}</text>
    <rect x="52" y="140" width="536" height="114" rx="10" fill="#f8fafc" stroke="#e2e8f0"/>
    <text x="70" y="172" font-family="-apple-system, sans-serif" font-size="13.5" fill="#1e293b">${escapeXml(
      opts.line1
    )}</text>
    <text x="70" y="198" font-family="-apple-system, sans-serif" font-size="13.5" fill="#1e293b">${escapeXml(
      opts.line2
    )}</text>
    <rect x="70" y="218" width="460" height="24" rx="6" fill="${badgeBg}"/>
    <text x="82" y="234" font-family="-apple-system, sans-serif" font-size="11.5" font-weight="600" fill="${badgeFg}">AI Signal: ${escapeXml(
      opts.highlightPill
    )}</text>
    <text x="52" y="294" font-family="-apple-system, monospace" font-size="11" fill="#94a3b8">Local VLM OCR • Processed on MacBook (127.0.0.1)</text>
  </svg>`);
}

export function renderAndroidScreenshotSvg(opts: {
  appLabel: string;
  timeLabel: string;
  sender: string;
  messageLine1: string;
  messageLine2: string;
  footerBadge: string;
}): string {
  const escapeXml = (str: string) =>
    str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  return svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">
    <rect width="640" height="360" fill="#090d16" rx="16"/>
    <rect x="170" y="14" width="300" height="332" rx="24" fill="#111827" stroke="#334155" stroke-width="2"/>
    <circle cx="320" cy="28" r="4" fill="#030712"/>
    <text x="194" y="34" font-family="sans-serif" font-size="10.5" font-weight="600" fill="#cbd5e1">${escapeXml(
      opts.timeLabel
    )}</text>
    <text x="418" y="34" font-family="sans-serif" font-size="10" fill="#34d399">5G 84%</text>
    <rect x="186" y="48" width="268" height="34" rx="8" fill="#1f2937"/>
    <text x="200" y="69" font-family="sans-serif" font-size="12" font-weight="700" fill="#f8fafc">${escapeXml(
      opts.appLabel
    )}</text>
    <rect x="186" y="94" width="268" height="176" rx="12" fill="#1e293b" stroke="#334155"/>
    <text x="202" y="120" font-family="sans-serif" font-size="12.5" font-weight="700" fill="#e2e8f0">${escapeXml(
      opts.sender
    )}</text>
    <text x="202" y="148" font-family="sans-serif" font-size="12" fill="#cbd5e1">${escapeXml(
      opts.messageLine1
    )}</text>
    <text x="202" y="170" font-family="sans-serif" font-size="12" fill="#cbd5e1">${escapeXml(
      opts.messageLine2
    )}</text>
    <rect x="200" y="218" width="240" height="34" rx="8" fill="#064e3b"/>
    <text x="212" y="239" font-family="sans-serif" font-size="10.5" font-weight="600" fill="#6ee7b7">${escapeXml(
      opts.footerBadge
    )}</text>
    <rect x="285" y="334" width="70" height="4" rx="2" fill="#64748b"/>
  </svg>`);
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  intervalMinutes: 5,
  skipDuplicateFrames: true,
  pauseOnPrivateApps: true,
  autoScheduleHighConfidence: true,
  workdayStartMinutes: 8 * 60 + 30, // 8:30 AM
  workdayEndMinutes: 18 * 60, // 6:00 PM
  minGapBetweenBlocksMinutes: 15,
  nightlyAndroidSyncHour: 23, // 11:00 PM
  ollamaModel: "llama3.2-vision",
};

export const INITIAL_STANDING_RULES: StandingRule[] = [
  {
    id: "rule-recurring-2h-prep",
    title: "≥2h runway before recurring meetings",
    description:
      "Automatically schedule 90m of preparation finishing at least 2 hours before any recurring meeting (or the afternoon prior if the meeting starts early in the morning).",
    category: "prep-time",
    enabled: true,
    appliesToRecurring: true,
    prepDurationMinutes: 90,
    minLeadMinutesBeforeMeeting: 120,
  },
  {
    id: "rule-solo-email-invites",
    title: "Create solo calendar holds from email & Slack mentions",
    description:
      "When an email or Slack screenshot mentions a meeting time without a calendar invite, place a personal hold on your calendar just for you.",
    category: "solo-invite",
    enabled: true,
  },
  {
    id: "rule-protected-lunch",
    title: "Protect 12:00 PM – 12:45 PM midday break",
    description:
      "Keep a 45-minute midday window clear when slotting flexible focus work from screenshots.",
    category: "availability",
    enabled: true,
    protectedWindow: {
      startMinutes: 12 * 60,
      endMinutes: 12 * 60 + 45,
      label: "Protected Lunch",
    },
  },
  {
    id: "rule-pr-calibration",
    title: "Size PR & architecture reviews to 45m",
    description:
      "Calibrated from past feedback: code & architecture PR reviews take ~45m of uninterrupted focus.",
    category: "duration-calibration",
    enabled: true,
    triggerPattern: "PR|token rotation|code review",
    fixedMinutesOverride: 45,
    createdFromFeedback: true,
  },
];

export const INITIAL_CAPTURES: ScreenshotCapture[] = [
  {
    id: "cap-mac-1",
    timestampIso: "2026-11-19T14:10:00Z",
    source: "mac-mail",
    device: "macbook",
    appName: "Apple Mail",
    windowTitle: "Re: Q4 Partner API Walkthrough — Sarah Chen",
    ocrPreview:
      "Hi! Could we jump on Zoom today at 4:00 PM for 30 mins to walk through the Q4 Partner API rollout? Haven't sent an invite yet.",
    imageDataUrl: renderMacScreenshotSvg({
      app: "mail",
      headerTitle: "Apple Mail — Inbox (Re: Q4 Partner API Walkthrough)",
      sender: "Sarah Chen",
      senderMeta: "sarah.chen@acme.io • Today, 9:10 AM",
      line1: "Could we jump on Zoom today at 4:00 PM for 30 mins to walk",
      line2: "through the Q4 Partner API rollout? Haven't sent an invite yet.",
      highlightPill: "Solo Meeting Hold → Today 4:00 PM (30m, just for you)",
    }),
    syncState: "scheduled",
    extractedSignal: {
      hasActionableItem: true,
      title: "Q4 Partner API Walkthrough w/ Sarah Chen",
      summary: "Email mentions 4:00 PM Zoom today without a formal calendar invite",
      detectedKind: "meeting",
      estimatedMinutes: 30,
      proposedStartMinutes: 16 * 60,
      proposedDayOffset: 0,
      isSoloInvite: true,
      locationOrUrl: "Zoom (solo hold from email)",
      fingerprintKey: "sarah-q4-partner-api-4pm",
    },
    createdBlockId: "blk-solo-sarah",
    isSample: true,
  },
  {
    id: "cap-mac-2",
    timestampIso: "2026-11-19T14:15:00Z",
    source: "mac-slack",
    device: "macbook",
    appName: "Slack — #eng-platform",
    windowTitle: "Slack • #eng-platform",
    ocrPreview:
      "@you Can you review the auth token rotation PR and leave latency notes before tomorrow morning's freeze?",
    imageDataUrl: renderMacScreenshotSvg({
      app: "slack",
      headerTitle: "Slack — #eng-platform",
      sender: "Marcus Vance",
      senderMeta: "#eng-platform • Today, 9:15 AM",
      line1: "@you Can you review the auth token rotation PR and leave",
      line2: "latency benchmark notes before tomorrow morning's freeze?",
      highlightPill: "Deep Work Block → 45m slotted into open 1:00 PM window",
    }),
    syncState: "scheduled",
    extractedSignal: {
      hasActionableItem: true,
      title: "Review auth token rotation PR & latency notes",
      summary: "Slack #eng-platform request from Marcus Vance",
      detectedKind: "deep-work",
      estimatedMinutes: 45,
      proposedDayOffset: 0,
      fingerprintKey: "auth-token-rotation-pr-review",
    },
    createdBlockId: "blk-slack-pr",
    isSample: true,
  },
  // Queued Android companion screenshots (zero processing on phone; waiting for nightly Mac sync)
  {
    id: "cap-android-1",
    timestampIso: "2026-11-19T22:40:00Z",
    source: "android-queue",
    device: "android",
    appName: "Android Gmail (Raw Screenshot)",
    windowTitle: "Gmail • Investor Coffee Catch-Up",
    ocrPreview:
      "Let's meet tomorrow at 11:30 AM at Blue Bottle SOMA for a 45m product roadmap catch-up.",
    imageDataUrl: renderAndroidScreenshotSvg({
      appLabel: "Gmail • Pixel Companion",
      timeLabel: "5:40 PM",
      sender: "Elena Rostova",
      messageLine1: "Let's meet tomorrow at 11:30 AM at Blue",
      messageLine2: "Bottle for a 45m roadmap catch-up!",
      footerBadge: "Raw capture • Queued for tonight's Mac VLM run",
    }),
    syncState: "queued-for-tonight",
    extractedSignal: {
      hasActionableItem: true,
      title: "Roadmap Coffee Catch-Up w/ Elena",
      summary: "Mobile Gmail screenshot mentions 11:30 AM meeting tomorrow",
      detectedKind: "meeting",
      estimatedMinutes: 45,
      proposedStartMinutes: 11 * 60 + 30,
      proposedDayOffset: 1,
      isSoloInvite: true,
      locationOrUrl: "Blue Bottle (solo hold from Android Gmail)",
      fingerprintKey: "elena-roadmap-coffee-1130",
    },
    isSample: true,
  },
  {
    id: "cap-android-2",
    timestampIso: "2026-11-19T23:05:00Z",
    source: "android-queue",
    device: "android",
    appName: "Android Slack (Raw Screenshot)",
    windowTitle: "Slack Mobile • #eng-platform",
    ocrPreview:
      "@you Can you review the auth token rotation PR and leave latency notes before tomorrow morning's freeze?",
    imageDataUrl: renderAndroidScreenshotSvg({
      appLabel: "Slack Mobile • #eng-platform",
      timeLabel: "6:05 PM",
      sender: "Marcus Vance",
      messageLine1: "Reminder on the auth token rotation PR",
      messageLine2: "review + latency benchmark notes!",
      footerBadge: "Raw capture • Will cross-match Mac screenshots",
    }),
    syncState: "queued-for-tonight",
    extractedSignal: {
      hasActionableItem: true,
      title: "Review auth token rotation PR & latency notes",
      summary: "Same #eng-platform PR request captured earlier on MacBook",
      detectedKind: "deep-work",
      estimatedMinutes: 45,
      proposedDayOffset: 1,
      fingerprintKey: "auth-token-rotation-pr-review",
    },
    isSample: true,
  },
  {
    id: "cap-android-3",
    timestampIso: "2026-11-19T23:30:00Z",
    source: "android-queue",
    device: "android",
    appName: "Android Messages (Raw Screenshot)",
    windowTitle: "Messages • Priya Nair",
    ocrPreview:
      "Hey! Could you send over the revised Q1 hiring headcount table tomorrow afternoon? Probably takes ~60m.",
    imageDataUrl: renderAndroidScreenshotSvg({
      appLabel: "Messages • Priya Nair",
      timeLabel: "6:30 PM",
      sender: "Priya Nair (VP Eng)",
      messageLine1: "Could you send over the revised Q1 hiring",
      messageLine2: "headcount table tomorrow? (~60m)",
      footerBadge: "Raw capture • Queued for tonight's Mac VLM run",
    }),
    syncState: "queued-for-tonight",
    extractedSignal: {
      hasActionableItem: true,
      title: "Draft Q1 hiring headcount table for Priya",
      summary: "Android screenshot request from Priya Nair for tomorrow",
      detectedKind: "deep-work",
      estimatedMinutes: 60,
      proposedDayOffset: 1,
      fingerprintKey: "priya-q1-headcount-table",
    },
    isSample: true,
  },
];

export const INITIAL_CALENDAR_BLOCKS: CalendarBlock[] = [
  {
    id: "blk-standup",
    title: "Platform Engineering Standup",
    kind: "meeting",
    status: "confirmed",
    dayOffset: 0,
    startMinutes: 9 * 60, // 9:00 AM
    durationMinutes: 30,
    sourceLabel: "Apple Calendar",
    rationale: "Existing confirmed calendar event.",
    confidence: 1,
    isSample: true,
  },
  {
    id: "prep-for-blk-arch-sync",
    title: "Prep: Weekly Architecture & Reliability Sync",
    kind: "prep",
    status: "auto-scheduled",
    dayOffset: 0,
    startMinutes: 10 * 60 + 30, // 10:30 AM – 12:00 PM (finishes 2.5h before 2:30 PM!)
    durationMinutes: 90,
    linkedMeetingId: "blk-arch-sync",
    ruleId: "rule-recurring-2h-prep",
    sourceLabel: "≥2h runway before recurring meetings",
    rationale:
      'Scheduled ≥2h ahead of "Weekly Architecture & Reliability Sync" (finishes at 12:00 PM for your 2:30 PM recurring meeting).',
    confidence: 0.96,
    isSample: true,
  },
  {
    id: "blk-slack-pr",
    title: "Review auth token rotation PR & latency notes",
    kind: "deep-work",
    status: "auto-scheduled",
    dayOffset: 0,
    startMinutes: 13 * 60, // 1:00 PM – 1:45 PM
    durationMinutes: 45,
    sourceCaptureId: "cap-mac-2",
    ruleId: "rule-pr-calibration",
    sourceLabel: "Slack — #eng-platform screenshot",
    rationale:
      'From Slack #eng-platform (Marcus Vance). Duration calibrated to 45m via "Size PR & architecture reviews to 45m" and placed into your open 1:00 PM slot.',
    confidence: 0.91,
    isSample: true,
  },
  {
    id: "blk-arch-sync",
    title: "Weekly Architecture & Reliability Sync",
    kind: "meeting",
    status: "confirmed",
    dayOffset: 0,
    startMinutes: 14 * 60 + 30, // 2:30 PM – 3:30 PM
    durationMinutes: 60,
    isRecurring: true,
    locationOrUrl: "Zoom • Eng Room",
    sourceLabel: "Apple Calendar (Weekly Recurring)",
    rationale: "Recurring weekly engineering sync — automatically triggers ≥2h lead prep.",
    confidence: 1,
    isSample: true,
  },
  {
    id: "blk-solo-sarah",
    title: "Q4 Partner API Walkthrough w/ Sarah Chen",
    kind: "meeting",
    status: "auto-scheduled",
    dayOffset: 0,
    startMinutes: 16 * 60, // 4:00 PM – 4:30 PM
    durationMinutes: 30,
    sourceCaptureId: "cap-mac-1",
    isSoloHold: true,
    locationOrUrl: "Zoom (solo hold from email)",
    sourceLabel: "Apple Mail screenshot",
    rationale:
      "Solo calendar invite created just for you from Sarah Chen's email mention ('Zoom today at 4:00 PM for 30 mins').",
    confidence: 0.93,
    isSample: true,
  },
  {
    id: "prep-for-blk-tomorrow-product",
    title: "Prep: Weekly Product & Design Review",
    kind: "prep",
    status: "auto-scheduled",
    dayOffset: 0,
    startMinutes: 16 * 60 + 45, // 4:45 PM – 6:00 PM (90m or 75m; let's make 4:30 gap -> 4:45-5:45 or 60m/75m)
    durationMinutes: 75,
    linkedMeetingId: "blk-tomorrow-product",
    ruleId: "rule-recurring-2h-prep",
    sourceLabel: "≥2h runway before recurring meetings",
    rationale:
      'Tomorrow\'s recurring "Weekly Product & Design Review" starts at 9:30 AM, so prep was placed this afternoon to preserve your ≥2h calm runway.',
    confidence: 0.94,
    isSample: true,
  },
  // Tomorrow's initial schedule
  {
    id: "blk-tomorrow-product",
    title: "Weekly Product & Design Review",
    kind: "meeting",
    status: "confirmed",
    dayOffset: 1,
    startMinutes: 9 * 60 + 30, // Tomorrow 9:30 AM – 10:30 AM
    durationMinutes: 60,
    isRecurring: true,
    locationOrUrl: "Figma + Meet",
    sourceLabel: "Apple Calendar (Weekly Recurring)",
    rationale: "Recurring weekly review — prep block placed the afternoon prior.",
    confidence: 1,
    isSample: true,
  },
  {
    id: "blk-tomorrow-1on1",
    title: "1:1 w/ Director of Infrastructure",
    kind: "meeting",
    status: "confirmed",
    dayOffset: 1,
    startMinutes: 15 * 60, // Tomorrow 3:00 PM – 3:30 PM
    durationMinutes: 30,
    isRecurring: true,
    sourceLabel: "Apple Calendar (Weekly Recurring)",
    rationale: "Recurring 1:1.",
    confidence: 1,
    isSample: true,
  },
  {
    id: "prep-for-blk-tomorrow-1on1",
    title: "Prep: 1:1 w/ Director of Infrastructure",
    kind: "prep",
    status: "auto-scheduled",
    dayOffset: 1,
    startMinutes: 10 * 60 + 45, // Tomorrow 10:45 AM – 12:00 PM (finishes 3h before 3:00 PM!)
    durationMinutes: 75,
    linkedMeetingId: "blk-tomorrow-1on1",
    ruleId: "rule-recurring-2h-prep",
    sourceLabel: "≥2h runway before recurring meetings",
    rationale:
      'Scheduled ≥2h ahead of "1:1 w/ Director of Infrastructure" per your recurring meeting rule.',
    confidence: 0.92,
    isSample: true,
  },
];

export const SIMULATED_INCOMING_MAC_CAPTURES: Array<
  Omit<ScreenshotCapture, "id" | "timestampIso" | "syncState"> & {
    signal: NonNullable<ScreenshotCapture["extractedSignal"]>;
  }
> = [
  {
    source: "mac-slack",
    device: "macbook",
    appName: "Slack — DM w/ Jordan Lee",
    windowTitle: "Slack • Jordan Lee",
    ocrPreview:
      "Hey! Could you put together the customer migration rollout checklist today? Probably ~45 mins of focus.",
    imageDataUrl: renderMacScreenshotSvg({
      app: "slack",
      headerTitle: "Slack — Direct Message (Jordan Lee)",
      sender: "Jordan Lee",
      senderMeta: "Staff PM • Just now",
      line1: "Hey! Could you put together the customer migration rollout",
      line2: "checklist today before EOD? Probably ~45 mins of focus.",
      highlightPill: "Deep Work → Find open 45m slot on Today's Calendar",
    }),
    signal: {
      hasActionableItem: true,
      title: "Draft customer migration rollout checklist",
      summary: "Slack DM from Jordan Lee requesting migration checklist",
      detectedKind: "deep-work",
      estimatedMinutes: 45,
      proposedDayOffset: 0,
      fingerprintKey: "jordan-migration-checklist",
    },
  },
  {
    source: "mac-mail",
    device: "macbook",
    appName: "Apple Mail",
    windowTitle: "Security Questionnaire Follow-Up — FinServ Corp",
    ocrPreview:
      "Quick heads up — can we do a 30m call tomorrow at 2:00 PM to finalize the SOC2 questionnaire? I'll just call your cell.",
    imageDataUrl: renderMacScreenshotSvg({
      app: "mail",
      headerTitle: "Apple Mail — Security Questionnaire Follow-Up",
      sender: "Devon Brooks",
      senderMeta: "devon@finserv.example • Just now",
      line1: "Quick heads up — can we do a 30m call tomorrow at 2:00 PM",
      line2: "to finalize the SOC2 questionnaire? No formal invite sent.",
      highlightPill: "Solo Invite Hold → Tomorrow 2:00 PM (30m, just for you)",
    }),
    signal: {
      hasActionableItem: true,
      title: "SOC2 Questionnaire Call w/ Devon Brooks",
      summary: "Email mentions 2:00 PM call tomorrow without a calendar invite",
      detectedKind: "meeting",
      estimatedMinutes: 30,
      proposedStartMinutes: 14 * 60,
      proposedDayOffset: 1,
      isSoloInvite: true,
      locationOrUrl: "Phone call (solo hold from email)",
      fingerprintKey: "devon-soc2-call-2pm",
    },
  },
  {
    source: "mac-slack",
    device: "macbook",
    appName: "Slack — #leadership-staff",
    windowTitle: "Slack • #leadership-staff",
    ocrPreview:
      "Heads up: please send short bullet replies on the Q4 cloud cost variance thread before wrapping up.",
    imageDataUrl: renderMacScreenshotSvg({
      app: "slack",
      headerTitle: "Slack — #leadership-staff",
      sender: " Camille Laurent",
      senderMeta: "#leadership-staff • Just now",
      line1: "Please drop your bullet-point notes on the Q4 cloud cost",
      line2: "variance thread before wrapping up for the week.",
      highlightPill: "Follow-Up Block → 30m slotted into open window",
    }),
    signal: {
      hasActionableItem: true,
      title: "Reply to Q4 cloud cost variance thread",
      summary: "Slack #leadership-staff follow-up from Camille",
      detectedKind: "follow-up",
      estimatedMinutes: 30,
      proposedDayOffset: 0,
      fingerprintKey: "camille-cloud-cost-variance",
    },
  },
];

export const INITIAL_DISCUSSION_MESSAGES: DiscussionMessage[] = [
  {
    id: "msg-1",
    role: "user",
    text: "For recurring meetings, I always need at least 2 hours beforehand to prepare so I'm never scrambling right before the call.",
    timestampIso: "2026-11-19T14:00:00Z",
  },
  {
    id: "msg-2",
    role: "assistant",
    text: "Saved to your Standing Rules! I scheduled a 90m prep block at 10:30 AM today (finishing 2.5 hours before your 2:30 PM Weekly Architecture Sync), and placed prep at 4:45 PM today for tomorrow's 9:30 AM recurring Product Review since tomorrow morning has less than 2 hours of runway.",
    timestampIso: "2026-11-19T14:00:05Z",
    appliedActionSummary: "Rule active: ≥2h lead prep before recurring meetings",
  },
];

export const INITIAL_SUGGESTED_PROMPTS: SuggestedPreferencePrompt[] = [
  {
    id: "sug-batch-comms",
    question:
      "Should I batch quick Slack & email replies into a dedicated 4:00 PM wrap-up window instead of scattering 15m blocks?",
    whyItMatters:
      "Keeps your morning and early afternoon uninterrupted for 60–90m deep work blocks.",
    acceptLabel: "Protect mornings from short replies",
    ruleToCreate: {
      title: "Protect 8:30 AM – 11:30 AM for deep work & prep only",
      description:
        "Keep morning hours reserved for prep blocks and ≥45m focus work; route quick replies to afternoon slots.",
      category: "availability",
      enabled: true,
    },
  },
  {
    id: "sug-exec-prep",
    question:
      "Want 1 hour of prep (≥2h ahead) for one-off external / client / partner calls too — not just recurring meetings?",
    whyItMatters:
      "Sarah Chen's 4:00 PM Partner API call was detected as a one-off email hold; enabling this adds prep for external calls automatically.",
    acceptLabel: "Add 60m prep for Partner / Client calls",
    ruleToCreate: {
      title: "60m prep (≥2h ahead) for Partner, Client & Customer calls",
      description:
        "Automatically reserve 60m of prep finishing ≥2h before meetings matching Partner, Client, or Customer.",
      category: "prep-time",
      enabled: true,
      triggerPattern: "Partner|Client|Customer|Walkthrough",
      prepDurationMinutes: 60,
      minLeadMinutesBeforeMeeting: 120,
    },
  },
  {
    id: "sug-hard-stop",
    question:
      "Do you want a hard stop at 5:30 PM so evening screenshots automatically schedule onto Tomorrow instead of tonight?",
    whyItMatters:
      "Prevents late-afternoon Slack pings from creeping into your evening.",
    acceptLabel: "Protect after 5:30 PM",
    ruleToCreate: {
      title: "Evening wind-down after 5:30 PM",
      description:
        "Keep 5:30 PM – 6:00 PM clear and spill overflow tasks to tomorrow morning.",
      category: "availability",
      enabled: true,
      protectedWindow: {
        startMinutes: 17 * 60 + 30,
        endMinutes: 18 * 60,
        label: "Evening Wind-Down",
      },
    },
  },
];
