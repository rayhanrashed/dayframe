import { CalendarBlock, EventAugmentation } from "./types";

/**
 * Returns true whenever a calendar event includes anyone else OR was not created
 * by Dayframe as a solo personal block. Such events MUST NEVER be edited or deleted
 * in macOS Calendar.app — all notes, prep links, papers, and todos live strictly
 * inside Dayframe's private EventAugmentation overlay.
 */
export function isProtectedCalendarInvite(block: CalendarBlock): boolean {
  if ((block.attendeeCount ?? 0) > 0) return true;
  if (block.occupiesTimeOnly) return true;
  if (block.calendarImmutable) return true;
  if (!block.isDayframeCreated) return true;
  return false;
}

export function getStableEventKey(block: CalendarBlock): string {
  if (block.externalEventId) {
    return `ext:${block.externalEventId}::${block.dateKey}`;
  }
  const normTitle = block.title.toLowerCase().trim().slice(0, 60);
  return `local:${block.id || `${normTitle}@${block.dateKey}:${block.startMinutes}`}`;
}

export function extractAugmentationFromBlock(
  block: CalendarBlock,
  existing?: EventAugmentation
): EventAugmentation {
  return {
    eventKey: getStableEventKey(block),
    customDisplayTitle: block.userEditedTitle
      ? block.title
      : existing?.customDisplayTitle,
    privateNotes: block.notes ?? existing?.privateNotes ?? "",
    subtasks: block.subtasks ?? existing?.subtasks ?? [],
    approvedPapers: block.relevantPapers ?? existing?.approvedPapers ?? [],
    privateReminders: block.reminders ?? existing?.privateReminders ?? [],
    stagedCandidates:
      block.stagedCandidates ?? existing?.stagedCandidates ?? [],
    eventChat: block.eventChat ?? existing?.eventChat ?? [],
    updatedAtIso: new Date().toISOString(),
  };
}

export function mergeAugmentationIntoBlock(
  block: CalendarBlock,
  augmentations: Record<string, EventAugmentation>
): CalendarBlock {
  const key = getStableEventKey(block);
  const aug = augmentations[key];
  if (!aug) return block;

  return {
    ...block,
    title: aug.customDisplayTitle || block.title,
    userEditedTitle: Boolean(aug.customDisplayTitle) || block.userEditedTitle,
    notes: aug.privateNotes || block.notes,
    subtasks: aug.subtasks.length > 0 ? aug.subtasks : block.subtasks,
    relevantPapers:
      aug.approvedPapers.length > 0 ? aug.approvedPapers : block.relevantPapers,
    reminders:
      aug.privateReminders.length > 0 ? aug.privateReminders : block.reminders,
    stagedCandidates: aug.stagedCandidates,
    eventChat: aug.eventChat.length > 0 ? aug.eventChat : block.eventChat,
  };
}

export function mergeAugmentationsIntoBlocks(
  blocks: CalendarBlock[],
  augmentations: Record<string, EventAugmentation>
): CalendarBlock[] {
  return blocks.map((b) => mergeAugmentationIntoBlock(b, augmentations));
}
