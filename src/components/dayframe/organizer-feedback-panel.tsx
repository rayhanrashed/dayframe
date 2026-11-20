"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CalendarBlock,
  DiscussionMessage,
  StandingRule,
  SuggestedPreferencePrompt,
  UserModelGraph,
  UserProfileModel,
} from "@/lib/types";
import { formatDuration } from "@/lib/scheduler";
import { computeStrivingAllocatedMinutes } from "@/lib/user-task-model";
import {
  BrainCircuit,
  CalendarPlus,
  Check,
  GitMerge,
  Layers,
  Loader2,
  MessageCircle,
  Pencil,
  Send,
  Sparkles,
  Trash2,
  User,
  X,
} from "lucide-react";

interface OrganizerFeedbackPanelProps {
  userGraph: UserModelGraph;
  blocks: CalendarBlock[];
  isInducingModels: boolean;
  onInduceModelsNow: () => void;
  onUpdateUserProfile: (patch: Partial<UserProfileModel>) => void;
  onRenameStriving: (id: string, newTitle: string) => void;
  onRenameTaskModel: (id: string, newTitle: string) => void;
  onMergeTaskModels: (keepId: string, absorbId: string) => void;
  onReassignTaskModel: (taskModelId: string, strivingId?: string) => void;
  onRemoveModelNode: (kind: "striving" | "taskModel", id: string) => void;
  onScheduleSessionForTaskModel: (taskModelId: string) => void;
  messages: DiscussionMessage[];
  rules: StandingRule[];
  suggestedPrompts: SuggestedPreferencePrompt[];
  onSendFeedback: (text: string) => void;
  onAcceptSuggestion: (promptId: string) => void;
  onDismissSuggestion: (promptId: string) => void;
  onToggleRule: (ruleId: string, enabled: boolean) => void;
  onDeleteRule: (ruleId: string) => void;
  onAddManualPrepRule: (opts: {
    keyword: string;
    prepMinutes: number;
    leadHours: number;
  }) => void;
}

export function OrganizerFeedbackPanel({
  userGraph,
  blocks,
  isInducingModels,
  onInduceModelsNow,
  onUpdateUserProfile,
  onRenameStriving,
  onRenameTaskModel,
  onMergeTaskModels,
  onReassignTaskModel,
  onRemoveModelNode,
  onScheduleSessionForTaskModel,
  messages,
  rules,
  suggestedPrompts,
  onSendFeedback,
  onAcceptSuggestion,
  onDismissSuggestion,
  onToggleRule,
  onDeleteRule,
  onAddManualPrepRule,
}: OrganizerFeedbackPanelProps) {
  const [draft, setDraft] = useState("");
  const [keyword, setKeyword] = useState("");
  const [prepMinutes, setPrepMinutes] = useState("45");
  const [leadHours, setLeadHours] = useState("2");

  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editTitleDraft, setEditTitleDraft] = useState("");
  const [mergingSourceId, setMergingSourceId] = useState<string | null>(null);

  const activeRuleCount = rules.filter((r) => r.enabled).length;
  const pendingSuggestions = suggestedPrompts.filter((s) => !s.answered);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    onSendFeedback(draft.trim());
    setDraft("");
  };

  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyword.trim()) return;
    onAddManualPrepRule({
      keyword: keyword.trim(),
      prepMinutes: Math.max(15, Number(prepMinutes) || 45),
      leadHours: Math.max(0.5, Number(leadHours) || 2),
    });
    setKeyword("");
  };

  return (
    <aside className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-3.5 shadow-2xs">
      <Tabs defaultValue="models" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="models" className="gap-1 text-xs">
            <Layers className="size-3" />
            Models ({userGraph.taskModels.length})
          </TabsTrigger>
          <TabsTrigger value="rules" className="gap-1 text-xs">
            <BrainCircuit className="size-3" />
            Rules ({activeRuleCount})
          </TabsTrigger>
          <TabsTrigger value="discussion" className="gap-1 text-xs">
            <MessageCircle className="size-3" />
            Coach
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: Hierarchical User & Task-Specific Models (Tempo Co-Creation) */}
        <TabsContent value="models" className="mt-3 space-y-3 text-xs">
          <div className="flex items-center justify-between gap-2 rounded-xl border bg-muted/30 px-2.5 py-2">
            <div className="min-w-0">
              <div className="font-semibold">User &amp; Task Models</div>
              <div className="truncate text-[10.5px] text-muted-foreground">
                Connects Slack, Mail, PDFs &amp; Calendar into projects
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => setShowProfileEditor((p) => !p)}
                title="Edit your self-context"
              >
                <User className="size-3.5" />
              </Button>
              <Button
                size="xs"
                onClick={onInduceModelsNow}
                disabled={isInducingModels}
                className="gap-1"
                title="Synthesize Task Models & Strivings from your calendar, Slack, and emails using Gemma 4"
              >
                {isInducingModels ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Sparkles className="size-3" />
                )}
                Synthesize
              </Button>
            </div>
          </div>

          {showProfileEditor && (
            <div className="space-y-2 rounded-xl border bg-background p-2.5">
              <div className="font-semibold">Self-Context (Seeds Inference)</div>
              <Input
                value={userGraph.profile.roleAndAffiliation}
                onChange={(e) =>
                  onUpdateUserProfile({ roleAndAffiliation: e.target.value })
                }
                placeholder="Role (e.g. PhD Researcher at UMich)"
                className="h-7 text-xs"
              />
              <Input
                value={userGraph.profile.activeDomains}
                onChange={(e) =>
                  onUpdateUserProfile({ activeDomains: e.target.value })
                }
                placeholder="Domains (e.g. HCI, AI agents, fellowships)"
                className="h-7 text-xs"
              />
              <Textarea
                value={userGraph.profile.currentPriorities}
                onChange={(e) =>
                  onUpdateUserProfile({ currentPriorities: e.target.value })
                }
                placeholder="Current priorities & deadlines..."
                className="min-h-14 text-xs"
              />
            </div>
          )}

          {/* Strivings Section */}
          {userGraph.strivings.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-muted-foreground">
                Ongoing Strivings (Allocated Time)
              </div>
              {userGraph.strivings.map((st) => {
                const allocatedMins = computeStrivingAllocatedMinutes(
                  st,
                  userGraph.taskModels,
                  blocks
                );
                const isEditing = editingNodeId === st.id;

                return (
                  <div
                    key={st.id}
                    className="rounded-xl border bg-background p-2.5 space-y-1"
                  >
                    {isEditing ? (
                      <form
                        className="flex gap-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          onRenameStriving(st.id, editTitleDraft);
                          setEditingNodeId(null);
                        }}
                      >
                        <Input
                          value={editTitleDraft}
                          onChange={(e) => setEditTitleDraft(e.target.value)}
                          className="h-7 text-xs"
                          autoFocus
                        />
                        <Button type="submit" size="xs">
                          Save
                        </Button>
                      </form>
                    ) : (
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="font-medium leading-snug">
                          {st.title}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Badge variant="outline" className="font-mono text-[9.5px]">
                            {formatDuration(allocatedMins)}
                          </Badge>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingNodeId(st.id);
                              setEditTitleDraft(st.title);
                            }}
                            className="text-muted-foreground hover:text-foreground"
                            title="Inline edit striving ([user-edited] constraint)"
                          >
                            <Pencil className="size-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onRemoveModelNode("striving", st.id)}
                            className="text-muted-foreground hover:text-destructive"
                            title="Remove striving"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      </div>
                    )}
                    {st.description && (
                      <p className="text-[10.5px] text-muted-foreground">
                        {st.description}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Task-Specific Models Section */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-muted-foreground">
              Task-Specific Models
            </div>
            {userGraph.taskModels.length === 0 ? (
              <div className="rounded-xl border border-dashed p-4 text-center text-[11px] text-muted-foreground">
                Add a project/fellowship in the composer above or click{" "}
                <strong>Synthesize</strong> to build Task Models across your Calendar, Slack, and Mail.
              </div>
            ) : (
              <div className="max-h-[420px] space-y-2 overflow-y-auto pr-0.5">
                {userGraph.taskModels.map((tm) => {
                  const isEditing = editingNodeId === tm.id;
                  const blockCount = blocks.filter(
                    (b) => b.taskModelId === tm.id
                  ).length;

                  return (
                    <div
                      key={tm.id}
                      className="space-y-1.5 rounded-xl border bg-background p-2.5"
                    >
                      {isEditing ? (
                        <form
                          className="flex gap-1"
                          onSubmit={(e) => {
                            e.preventDefault();
                            onRenameTaskModel(tm.id, editTitleDraft);
                            setEditingNodeId(null);
                          }}
                        >
                          <Input
                            value={editTitleDraft}
                            onChange={(e) => setEditTitleDraft(e.target.value)}
                            className="h-7 text-xs"
                            autoFocus
                          />
                          <Button type="submit" size="xs">
                            Save
                          </Button>
                        </form>
                      ) : (
                        <div className="flex items-start justify-between gap-1.5">
                          <div>
                            <div className="flex flex-wrap items-center gap-1 font-semibold">
                              <span>{tm.canonicalTitle}</span>
                              {tm.userEdited && (
                                <Badge variant="outline" className="text-[9px]">
                                  edited
                                </Badge>
                              )}
                            </div>
                            {tm.cadenceNote && (
                              <div className="text-[10px] text-muted-foreground">
                                {tm.cadenceNote}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1">
                            <Button
                              size="icon-xs"
                              variant="outline"
                              onClick={() =>
                                onScheduleSessionForTaskModel(tm.id)
                              }
                              title={`Schedule ${formatDuration(
                                tm.typicalSessionMinutes
                              )} session onto UMich calendar`}
                            >
                              <CalendarPlus className="size-3" />
                            </Button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingNodeId(tm.id);
                                setEditTitleDraft(tm.canonicalTitle);
                              }}
                              className="p-0.5 text-muted-foreground hover:text-foreground"
                              title="Rename task model"
                            >
                              <Pencil className="size-3" />
                            </button>
                            {userGraph.taskModels.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setMergingSourceId(
                                    mergingSourceId === tm.id ? null : tm.id
                                  )
                                }
                                className="p-0.5 text-muted-foreground hover:text-foreground"
                                title="Merge into another task model"
                              >
                                <GitMerge className="size-3" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                onRemoveModelNode("taskModel", tm.id)
                              }
                              className="p-0.5 text-muted-foreground hover:text-destructive"
                              title="Remove task model"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                        </div>
                      )}

                      <p className="text-[10.5px] text-muted-foreground">
                        {tm.summary}
                      </p>

                      <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                        <span>{blockCount} blocks</span>
                        <span>· {tm.evidence.length} evidence</span>
                        {tm.relevantPapers.length > 0 && (
                          <span>· {tm.relevantPapers.length} papers</span>
                        )}
                      </div>

                      {tm.immediateTodos.length > 0 && (
                        <div className="space-y-0.5 border-t pt-1 text-[10.5px]">
                          {tm.immediateTodos.slice(0, 2).map((td) => (
                            <div key={td.id} className="truncate text-muted-foreground">
                              • {td.text}
                            </div>
                          ))}
                        </div>
                      )}

                      {userGraph.strivings.length > 0 && (
                        <Select
                          value={tm.parentStrivingId || "__none__"}
                          onValueChange={(val) =>
                            onReassignTaskModel(
                              tm.id,
                              val === "__none__" ? undefined : (val ?? undefined)
                            )
                          }
                        >
                          <SelectTrigger className="h-6 w-full text-[10px]">
                            <SelectValue placeholder="Assign to striving..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">
                              Unassigned striving
                            </SelectItem>
                            {userGraph.strivings.map((st) => (
                              <SelectItem key={st.id} value={st.id}>
                                Serves: {st.title.slice(0, 44)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}

                      {mergingSourceId === tm.id && (
                        <div className="rounded-lg border bg-muted/40 p-2 space-y-1">
                          <div className="text-[10px] font-medium">
                            Merge &ldquo;{tm.canonicalTitle}&rdquo; into:
                          </div>
                          {userGraph.taskModels
                            .filter((other) => other.id !== tm.id)
                            .map((other) => (
                              <button
                                key={other.id}
                                type="button"
                                onClick={() => {
                                  onMergeTaskModels(other.id, tm.id);
                                  setMergingSourceId(null);
                                }}
                                className="block w-full truncate rounded px-2 py-1 text-left text-[10.5px] hover:bg-background"
                              >
                                &rarr; {other.canonicalTitle}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {userGraph.constraints.length > 0 && (
            <div className="rounded-xl border bg-muted/20 p-2 text-[10px] text-muted-foreground">
              {userGraph.constraints.length} active user constraint
              {userGraph.constraints.length === 1 ? "" : "s"} guiding future inductions
            </div>
          )}
        </TabsContent>

        {/* TAB 2: Standing Rules */}
        <TabsContent value="rules" className="mt-3 flex flex-col gap-3">
          <form
            onSubmit={handleAddRule}
            className="space-y-2 rounded-xl border bg-muted/30 p-2.5 text-xs"
          >
            <div className="font-medium">Add Meeting Prep Rule</div>
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder='Meeting keyword (e.g. "Advisor", "Committee")'
              className="h-7 bg-background text-xs"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                min={15}
                step={15}
                value={prepMinutes}
                onChange={(e) => setPrepMinutes(e.target.value)}
                className="h-7 bg-background text-xs"
              />
              <Input
                type="number"
                min={0.5}
                step={0.5}
                value={leadHours}
                onChange={(e) => setLeadHours(e.target.value)}
                className="h-7 bg-background text-xs"
              />
            </div>
            <Button
              type="submit"
              size="xs"
              variant="secondary"
              disabled={!keyword.trim()}
              className="w-full"
            >
              Save Prep Rule
            </Button>
          </form>

          <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-0.5">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="rounded-xl border bg-background p-2.5 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium leading-snug">{rule.title}</span>
                  <div className="flex items-center gap-1.5">
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={(checked) =>
                        onToggleRule(rule.id, checked)
                      }
                    />
                    {rule.createdFromFeedback && (
                      <button
                        type="button"
                        onClick={() => onDeleteRule(rule.id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {rule.description}
                </p>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* TAB 3: Feedback Coach */}
        <TabsContent value="discussion" className="mt-3 flex flex-col gap-3">
          <div className="flex max-h-[270px] flex-col gap-2.5 overflow-y-auto rounded-xl border bg-background p-2.5">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-lg p-2.5 text-xs leading-relaxed ${
                  m.role === "user"
                    ? "ml-4 bg-primary text-primary-foreground"
                    : "mr-2 border bg-muted/40 text-foreground"
                }`}
              >
                <p>{m.text}</p>
              </div>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="flex gap-1.5">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder='e.g. "Paper reviews usually take me 90 minutes"'
              className="text-xs"
            />
            <Button type="submit" size="icon-sm" disabled={!draft.trim()}>
              <Send className="size-3.5" />
            </Button>
          </form>

          {pendingSuggestions.length > 0 && (
            <div className="space-y-2 border-t pt-2.5">
              {pendingSuggestions.map((s) => (
                <div
                  key={s.id}
                  className="rounded-xl border bg-muted/30 p-2.5 text-xs"
                >
                  <p className="font-medium">{s.question}</p>
                  <div className="mt-2 flex gap-1.5">
                    <Button
                      size="xs"
                      onClick={() => onAcceptSuggestion(s.id)}
                      className="gap-1"
                    >
                      <Check className="size-3" />
                      {s.acceptLabel}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => onDismissSuggestion(s.id)}
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </aside>
  );
}
