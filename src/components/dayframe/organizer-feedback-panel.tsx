"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DiscussionMessage,
  StandingRule,
  SuggestedPreferencePrompt,
} from "@/lib/types";
import {
  BrainCircuit,
  Check,
  Lightbulb,
  MessageCircle,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

interface OrganizerFeedbackPanelProps {
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

const QUICK_FEEDBACK_CHIPS = [
  "I need at least 3 hours before recurring meetings",
  "Design & deck reviews usually take 90 minutes",
  "Give me 45m of prep 2 hours before interview calls",
  "Take screenshots every 1 minute",
];

export function OrganizerFeedbackPanel({
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
  const [prepMinutes, setPrepMinutes] = useState("60");
  const [leadHours, setLeadHours] = useState("2");

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
      prepMinutes: Math.max(15, Number(prepMinutes) || 60),
      leadHours: Math.max(0.5, Number(leadHours) || 2),
    });
    setKeyword("");
  };

  return (
    <aside className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-3.5 shadow-2xs">
      <Tabs defaultValue="discussion" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="discussion" className="gap-1.5 text-xs">
            <MessageCircle className="size-3.5" />
            Feedback &amp; Coach
          </TabsTrigger>
          <TabsTrigger value="rules" className="gap-1.5 text-xs">
            <BrainCircuit className="size-3.5" />
            Standing Rules ({activeRuleCount})
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Feedback Discussion + Proactive "What More You Might Want" Questions */}
        <TabsContent value="discussion" className="mt-3 flex flex-col gap-3">
          {/* Discussion History */}
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
                {m.appliedActionSummary && (
                  <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                    <Sparkles className="size-2.5" />
                    {m.appliedActionSummary}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Feedback Composer */}
          <form onSubmit={handleSubmit} className="space-y-2">
            <div className="flex flex-wrap gap-1">
              {QUICK_FEEDBACK_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => onSendFeedback(chip)}
                  className="rounded-md border bg-muted/40 px-2 py-0.5 text-left text-[10.5px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                >
                  {chip}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder='Tell Dayframe a rule or correction (e.g. "Need 2h before recurring syncs")...'
                className="text-xs"
              />
              <Button
                type="submit"
                size="icon"
                disabled={!draft.trim()}
                title="Send feedback to organizer"
              >
                <Send className="size-3.5" />
              </Button>
            </div>
          </form>

          {/* Proactive Organizer Suggestions ("Ask me what more I want or should want") */}
          {pendingSuggestions.length > 0 && (
            <div className="space-y-2 rounded-xl border border-sky-500/25 bg-sky-500/5 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <Lightbulb className="size-3.5 text-amber-500" />
                Questions to Refine Your Day
              </div>
              <p className="text-[11px] text-muted-foreground">
                Zero hand-holding — answer once and Dayframe remembers forever:
              </p>

              <div className="space-y-2 pt-0.5">
                {pendingSuggestions.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border bg-background p-2.5 text-xs"
                  >
                    <p className="font-medium leading-snug">{item.question}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {item.whyItMatters}
                    </p>
                    <div className="mt-2 flex items-center gap-1.5">
                      <Button
                        size="xs"
                        onClick={() => onAcceptSuggestion(item.id)}
                        className="gap-1"
                      >
                        <Check className="size-3" />
                        {item.acceptLabel}
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => onDismissSuggestion(item.id)}
                        className="gap-0.5 text-muted-foreground"
                      >
                        <X className="size-3" />
                        Not now
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        {/* Tab 2: Standing Rules & Prep-Time Memory */}
        <TabsContent value="rules" className="mt-3 flex flex-col gap-3">
          <form
            onSubmit={handleAddRule}
            className="space-y-2 rounded-xl border bg-muted/30 p-2.5 text-xs"
          >
            <div className="font-medium">Add Custom Meeting Prep Rule</div>
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder='Meeting keyword (e.g. "Board", "Customer", "1:1")'
              className="bg-background text-xs"
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[10.5px] text-muted-foreground">
                  Prep Duration (min)
                </label>
                <Input
                  type="number"
                  min={15}
                  max={180}
                  step={15}
                  value={prepMinutes}
                  onChange={(e) => setPrepMinutes(e.target.value)}
                  className="bg-background text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10.5px] text-muted-foreground">
                  Min Lead Before (hrs)
                </label>
                <Input
                  type="number"
                  min={0.5}
                  max={8}
                  step={0.5}
                  value={leadHours}
                  onChange={(e) => setLeadHours(e.target.value)}
                  className="bg-background text-xs"
                />
              </div>
            </div>
            <Button
              type="submit"
              size="xs"
              disabled={!keyword.trim()}
              className="w-full gap-1"
            >
              <Plus className="size-3" />
              Save Prep Rule &amp; Re-run Schedule
            </Button>
          </form>

          <div className="flex max-h-[430px] flex-col gap-2 overflow-y-auto pr-0.5">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="rounded-xl border bg-background p-2.5 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{rule.title}</span>
                      {rule.createdFromFeedback && (
                        <Badge variant="secondary" className="text-[9.5px]">
                          From your feedback
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {rule.description}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Switch
                      size="sm"
                      checked={rule.enabled}
                      onCheckedChange={(checked) =>
                        onToggleRule(rule.id, checked)
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => onDeleteRule(rule.id)}
                      title="Delete rule"
                    >
                      <Trash2 className="size-3 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </aside>
  );
}
