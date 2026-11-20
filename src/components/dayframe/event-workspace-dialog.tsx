"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CalendarBlock,
  ScreenshotCapture,
  TaskSpecificModel,
} from "@/lib/types";
import {
  formatDateKeyLabel,
  formatDuration,
  formatMinutesToTime,
} from "@/lib/scheduler";
import {
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  ListTodo,
  Loader2,
  MessageSquare,
  Minus,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";

interface EventWorkspaceDialogProps {
  todayKey: string;
  block: CalendarBlock | null;
  linkedTaskModel?: TaskSpecificModel;
  linkedCapture: ScreenshotCapture | null;
  isBusyEnriching: boolean;
  onClose: () => void;
  onSendEventChat: (blockId: string, text: string) => Promise<void>;
  onPullContextAndPapers: (blockId: string) => Promise<void>;
  onRenameEvent: (blockId: string, newTitle: string) => void;
  onSaveEventNotes: (blockId: string, notes: string) => void;
  onToggleSubtask: (blockId: string, subtaskId: string) => void;
  onAddSubtask: (blockId: string, text: string) => void;
  onRemoveSubtask: (blockId: string, subtaskId: string) => void;
  onAddPaper: (blockId: string, title: string, pathOrUrl?: string) => void;
  onRemovePaper: (blockId: string, paperId: string) => void;
  onOpenLocalPaper: (pathOrUrl: string) => void;
  onAddReminder: (blockId: string, text: string, leadMinutes: number) => void;
  onToggleBlockDone: (id: string, actualMinutesOverride?: number) => void;
  onAdjustBlockDuration: (
    id: string,
    deltaMinutes: number,
    saveRule: boolean
  ) => void;
  onConfirmAndSyncBlock: (id: string) => void;
  onMoveBlockToNextSlot: (id: string) => void;
  onShiftBlockDate: (id: string, deltaDays: number) => void;
  onDeleteBlock: (id: string) => void;
}

const EVENT_CHAT_CHIPS = [
  "Add two 1-hour blocks to prepare for this from today until the meeting",
  "Read context from my email, Slack, and local papers",
  "Remind me 30m before to review notes",
];

export function EventWorkspaceDialog({
  todayKey,
  block,
  linkedTaskModel,
  linkedCapture,
  isBusyEnriching,
  onClose,
  onSendEventChat,
  onPullContextAndPapers,
  onRenameEvent,
  onSaveEventNotes,
  onToggleSubtask,
  onAddSubtask,
  onRemoveSubtask,
  onAddPaper,
  onRemovePaper,
  onOpenLocalPaper,
  onAddReminder,
  onToggleBlockDone,
  onAdjustBlockDuration,
  onConfirmAndSyncBlock,
  onMoveBlockToNextSlot,
  onShiftBlockDate,
  onDeleteBlock,
}: EventWorkspaceDialogProps) {
  const [chatInput, setChatInput] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [newTodo, setNewTodo] = useState("");
  const [newPaperTitle, setNewPaperTitle] = useState("");
  const [newPaperUrl, setNewPaperUrl] = useState("");
  const [reminderText, setReminderText] = useState("");
  const [reminderLead, setReminderLead] = useState("30");

  useEffect(() => {
    if (!block) return;
    const t = setTimeout(() => {
      setTitleDraft(block.title);
      setNotesDraft(block.notes || "");
      setEditingTitle(false);
    }, 0);
    return () => clearTimeout(t);
  }, [block]);

  if (!block) return null;

  const subtasks = block.subtasks ?? [];
  const papers = block.relevantPapers ?? [];
  const reminders = block.reminders ?? [];
  const chatHistory = block.eventChat ?? [];

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isBusyEnriching) return;
    const msg = chatInput.trim();
    setChatInput("");
    await onSendEventChat(block.id, msg);
  };

  return (
    <Dialog
      open={Boolean(block)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="text-[10px]">
              {formatDateKeyLabel(block.dateKey, todayKey)} •{" "}
              {formatMinutesToTime(block.startMinutes)} –{" "}
              {formatMinutesToTime(block.startMinutes + block.durationMinutes)}{" "}
              ({formatDuration(block.durationMinutes)})
            </Badge>
            {block.calendarTitle && (
              <Badge variant="outline" className="text-[10px]">
                {block.calendarTitle}
              </Badge>
            )}
            {linkedTaskModel && (
              <Badge variant="outline" className="text-[10px]">
                Model: {linkedTaskModel.canonicalTitle}
              </Badge>
            )}
            {block.syncedToExternalCalendar && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <CheckCircle2 className="size-3 text-emerald-500" />
                Synced
              </Badge>
            )}
          </div>

          {editingTitle ? (
            <form
              className="mt-1.5 flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (titleDraft.trim()) {
                  onRenameEvent(block.id, titleDraft.trim());
                }
                setEditingTitle(false);
              }}
            >
              <Input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                className="h-8 text-sm font-semibold"
                autoFocus
              />
              <Button type="submit" size="xs">
                Save
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-2 pt-1">
              <DialogTitle className="text-base">{block.title}</DialogTitle>
              {!block.occupiesTimeOnly && (
                <button
                  type="button"
                  onClick={() => setEditingTitle(true)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Edit standard event title"
                >
                  <Pencil className="size-3.5" />
                </button>
              )}
            </div>
          )}

          <DialogDescription className="text-xs">
            {block.rationale}
            {block.attendeeNames && block.attendeeNames.length > 0
              ? ` • Attendees: ${block.attendeeNames.slice(0, 5).join(", ")}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="chat" className="w-full text-xs">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="chat" className="gap-1.5 text-xs">
              <MessageSquare className="size-3.5" />
              Chat with Event
            </TabsTrigger>
            <TabsTrigger value="details" className="gap-1.5 text-xs">
              <ListTodo className="size-3.5" />
              Todos &amp; Details ({subtasks.length})
            </TabsTrigger>
            <TabsTrigger value="papers" className="gap-1.5 text-xs">
              <BookOpen className="size-3.5" />
              Papers &amp; Reminders ({papers.length + reminders.length})
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: Direct Per-Event Chat */}
          <TabsContent value="chat" className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/30 px-3 py-2">
              <span className="text-[11px] text-muted-foreground">
                Ask to schedule prep blocks, pull Email/Slack/PDF context, add todos, or resize.
              </span>
              <Button
                size="xs"
                variant="secondary"
                disabled={isBusyEnriching}
                onClick={() => void onPullContextAndPapers(block.id)}
                className="gap-1 shrink-0"
              >
                {isBusyEnriching ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Sparkles className="size-3" />
                )}
                Pull Context &amp; Papers
              </Button>
            </div>

            <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border bg-background p-3">
              {chatHistory.length === 0 ? (
                <div className="space-y-2 py-3 text-center text-[11px] text-muted-foreground">
                  <p>
                    Chat directly with <strong>{block.title}</strong>. Try a prompt below or type your own instruction:
                  </p>
                  <div className="flex flex-wrap justify-center gap-1.5 pt-1">
                    {EVENT_CHAT_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => void onSendEventChat(block.id, chip)}
                        className="rounded-lg border bg-muted/35 px-2.5 py-1 text-left text-[10.5px] text-foreground transition-colors hover:bg-muted"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                chatHistory.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-lg p-2.5 text-xs leading-relaxed ${
                      m.role === "user"
                        ? "ml-6 bg-primary text-primary-foreground"
                        : "mr-4 border bg-muted/40 text-foreground"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    {m.actionBadge && (
                      <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                        <Check className="size-2.5" />
                        {m.actionBadge}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <form onSubmit={(e) => void handleChatSubmit(e)} className="flex gap-1.5">
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder='e.g. "add two one-hour blocks to prepare for this anytime from today until the meeting"'
                className="flex-1 text-xs"
                disabled={isBusyEnriching}
              />
              <Button
                type="submit"
                size="sm"
                disabled={!chatInput.trim() || isBusyEnriching}
                className="gap-1"
              >
                {isBusyEnriching ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
                Send
              </Button>
            </form>
          </TabsContent>

          {/* TAB 2: Immediate To-Dos (Sub-Checklist) & Synced Event Details */}
          <TabsContent value="details" className="mt-3 space-y-3">
            <div className="space-y-2 rounded-xl border p-3">
              <div className="font-semibold">
                Immediate To-Dos Inside This Block
              </div>
              <form
                className="flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newTodo.trim()) return;
                  onAddSubtask(block.id, newTodo.trim());
                  setNewTodo("");
                }}
              >
                <Input
                  value={newTodo}
                  onChange={(e) => setNewTodo(e.target.value)}
                  placeholder="Add concrete step for this session..."
                  className="h-7 flex-1 text-xs"
                />
                <Button type="submit" size="xs" disabled={!newTodo.trim()}>
                  Add
                </Button>
              </form>

              {subtasks.length === 0 ? (
                <p className="py-2 text-[11px] text-muted-foreground">
                  No checklist items yet. Click &ldquo;Pull Context &amp; Papers&rdquo; in Chat to extract immediate steps from your emails/Slack, or add one above.
                </p>
              ) : (
                <div className="space-y-1.5 pt-1">
                  {subtasks.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 px-2.5 py-1.5"
                    >
                      <button
                        type="button"
                        onClick={() => onToggleSubtask(block.id, item.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span
                          className={`flex size-3.5 shrink-0 items-center justify-center rounded-sm border ${
                            item.done
                              ? "border-emerald-600 bg-emerald-600 text-white"
                              : "border-foreground/40"
                          }`}
                        >
                          {item.done && <Check className="size-2.5" />}
                        </span>
                        <span
                          className={
                            item.done ? "line-through text-muted-foreground" : ""
                          }
                        >
                          {item.text}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveSubtask(block.id, item.id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-xl border p-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-semibold">
                  <FileText className="size-3.5" />
                  Event Context &amp; Notes (Synced to Calendar.app)
                </span>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => onSaveEventNotes(block.id, notesDraft)}
                >
                  Save Notes
                </Button>
              </div>
              <Textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder="Context from emails, Slack threads, agenda links, or notes..."
                className="min-h-24 text-xs"
              />
            </div>

            {linkedCapture?.imageDataUrl && (
              <div className="space-y-1.5 rounded-xl border bg-muted/30 p-2.5">
                <div className="font-medium">
                  Captured Source ({linkedCapture.appName})
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={linkedCapture.imageDataUrl}
                  alt={linkedCapture.windowTitle}
                  className="max-h-36 w-full rounded-lg border object-cover"
                />
              </div>
            )}
          </TabsContent>

          {/* TAB 3: Relevant Papers & Native Calendar Reminders */}
          <TabsContent value="papers" className="mt-3 space-y-3">
            <div className="space-y-2 rounded-xl border p-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold">
                  Relevant Papers, PDFs &amp; Links
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={isBusyEnriching}
                  onClick={() => void onPullContextAndPapers(block.id)}
                >
                  Scan Local PDFs
                </Button>
              </div>

              <form
                className="flex flex-wrap gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newPaperTitle.trim()) return;
                  onAddPaper(
                    block.id,
                    newPaperTitle.trim(),
                    newPaperUrl.trim() || undefined
                  );
                  setNewPaperTitle("");
                  setNewPaperUrl("");
                }}
              >
                <Input
                  value={newPaperTitle}
                  onChange={(e) => setNewPaperTitle(e.target.value)}
                  placeholder="Paper title or doc name..."
                  className="h-7 min-w-[160px] flex-1 text-xs"
                />
                <Input
                  value={newPaperUrl}
                  onChange={(e) => setNewPaperUrl(e.target.value)}
                  placeholder="arXiv URL or ~/Documents/... path (optional)"
                  className="h-7 min-w-[160px] flex-1 text-xs"
                />
                <Button type="submit" size="xs" disabled={!newPaperTitle.trim()}>
                  Attach
                </Button>
              </form>

              {papers.length === 0 ? (
                <p className="py-2 text-[11px] text-muted-foreground">
                  No papers attached yet. Click &ldquo;Scan Local PDFs&rdquo; to find matching PDFs in your Mac&apos;s Documents/Downloads, or attach a title/URL above.
                </p>
              ) : (
                <div className="space-y-1.5 pt-1">
                  {papers.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 px-2.5 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{p.title}</div>
                        {(p.authorsOrVenue || p.pathOrUrl) && (
                          <div className="truncate text-[10.5px] text-muted-foreground">
                            {p.authorsOrVenue || p.pathOrUrl}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {p.pathOrUrl && (
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => {
                              if (/^https?:\/\//i.test(p.pathOrUrl!)) {
                                window.open(p.pathOrUrl, "_blank", "noopener");
                              } else {
                                onOpenLocalPaper(p.pathOrUrl!);
                              }
                            }}
                            title="Open paper"
                          >
                            <ExternalLink className="size-3" />
                          </Button>
                        )}
                        <button
                          type="button"
                          onClick={() => onRemovePaper(block.id, p.id)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-xl border p-3">
              <div className="flex items-center gap-1.5 font-semibold">
                <Bell className="size-3.5" />
                Event Reminders (Adds Native macOS Calendar Alert)
              </div>
              <form
                className="flex flex-wrap gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!reminderText.trim()) return;
                  onAddReminder(
                    block.id,
                    reminderText.trim(),
                    Number(reminderLead) || 30
                  );
                  setReminderText("");
                }}
              >
                <Input
                  value={reminderText}
                  onChange={(e) => setReminderText(e.target.value)}
                  placeholder="e.g. Send draft slides before call..."
                  className="h-7 flex-1 text-xs"
                />
                <Input
                  type="number"
                  min={5}
                  max={1440}
                  value={reminderLead}
                  onChange={(e) => setReminderLead(e.target.value)}
                  className="h-7 w-20 text-xs"
                />
                <span className="self-center text-[11px] text-muted-foreground">
                  min before
                </span>
                <Button type="submit" size="xs" disabled={!reminderText.trim()}>
                  Add Alert
                </Button>
              </form>

              {reminders.length > 0 && (
                <div className="space-y-1 pt-1">
                  {reminders.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-md border bg-muted/20 px-2.5 py-1 text-[11px]"
                    >
                      • {r.text}
                      {r.leadMinutes ? ` (${r.leadMinutes}m before)` : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Bottom Footer: Done Calibration + Slot Controls */}
        <div className="space-y-2.5 border-t pt-3 text-xs">
          {block.isDayframeCreated && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-emerald-500/[0.06] px-3 py-2">
              <span className="font-medium">Complete &amp; Calibrate:</span>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="xs"
                  variant={block.done ? "secondary" : "default"}
                  onClick={() => {
                    onToggleBlockDone(block.id, block.durationMinutes);
                    onClose();
                  }}
                  className="gap-1"
                >
                  <Check className="size-3" />
                  {block.done
                    ? "Reopen"
                    : `Done (${formatDuration(block.durationMinutes)})`}
                </Button>
                {!block.done && (
                  <>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        onToggleBlockDone(
                          block.id,
                          Math.max(15, block.durationMinutes - 30)
                        );
                        onClose();
                      }}
                    >
                      30m faster
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        onToggleBlockDone(block.id, block.durationMinutes + 30);
                        onClose();
                      }}
                    >
                      +30m longer
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        onToggleBlockDone(block.id, block.durationMinutes * 2);
                        onClose();
                      }}
                    >
                      2× longer
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {!block.occupiesTimeOnly && (
                <>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={block.durationMinutes <= 15}
                    onClick={() =>
                      onAdjustBlockDuration(block.id, -15, true)
                    }
                  >
                    <Minus className="size-3" /> 15m
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      onAdjustBlockDuration(block.id, 15, true)
                    }
                  >
                    <Plus className="size-3" /> 15m
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => onMoveBlockToNextSlot(block.id)}
                    className="gap-1"
                  >
                    Next Slot <ArrowRight className="size-3" />
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => onShiftBlockDate(block.id, 1)}
                  >
                    +1 Day
                  </Button>
                </>
              )}
              {!block.syncedToExternalCalendar && !block.occupiesTimeOnly && (
                <Button
                  size="xs"
                  onClick={() => {
                    onConfirmAndSyncBlock(block.id);
                    onClose();
                  }}
                >
                  Write to Calendar
                </Button>
              )}
            </div>

            {!block.occupiesTimeOnly && (
              <Button
                size="icon-xs"
                variant="destructive"
                onClick={() => {
                  onDeleteBlock(block.id);
                  onClose();
                }}
                title="Delete block"
              >
                <Trash2 className="size-3" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
