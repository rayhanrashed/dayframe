"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarBlock, UserModelGraph } from "@/lib/types";
import {
  formatDateKeyLabel,
  formatDuration,
  formatMinutesToTime,
} from "@/lib/scheduler";
import { computeAllProjectProgress } from "@/lib/user-task-model";
import {
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronRight,
  FolderKanban,
  Plus,
} from "lucide-react";

interface ProjectsProgressPanelProps {
  todayKey: string;
  userGraph: UserModelGraph;
  blocks: CalendarBlock[];
  onCreateProject: (title: string, targetWeeklyMinutes?: number) => void;
  onUpdateProjectTargetMinutes: (projectId: string, minutes: number) => void;
  onAssignBlockToProject: (blockId: string, projectId: string) => void;
  onScheduleProjectSession: (projectId: string) => void;
  onSelectBlockId: (blockId: string) => void;
  onToggleBlockDone: (blockId: string) => void;
}

export function ProjectsProgressPanel({
  todayKey,
  userGraph,
  blocks,
  onCreateProject,
  onUpdateProjectTargetMinutes,
  onAssignBlockToProject,
  onScheduleProjectSession,
  onSelectBlockId,
  onToggleBlockDone,
}: ProjectsProgressPanelProps) {
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [newTargetHours, setNewTargetHours] = useState("4");
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    new Set()
  );

  const summary = useMemo(
    () => computeAllProjectProgress({ graph: userGraph, blocks }),
    [blocks, userGraph]
  );

  const toggleExpand = (id: string) => {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectTitle.trim()) return;
    const hrs = Number(newTargetHours);
    onCreateProject(
      newProjectTitle.trim(),
      hrs > 0 ? Math.round(hrs * 60) : undefined
    );
    setNewProjectTitle("");
  };

  return (
    <section className="space-y-4 rounded-2xl border border-border/80 bg-card p-4 shadow-2xs">
      {/* Header & Totals */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Projects &amp; Time Progress
          </h2>
          <p className="text-xs text-muted-foreground">
            How every completed and scheduled calendar block maps to your active projects.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="rounded-xl border bg-emerald-500/10 px-3 py-1.5">
            <span className="text-muted-foreground">Done: </span>
            <strong className="font-mono text-emerald-800 dark:text-emerald-200">
              {formatDuration(summary.totalCompletedMinutes)}
            </strong>
          </div>
          <div className="rounded-xl border bg-orange-500/10 px-3 py-1.5">
            <span className="text-muted-foreground">Scheduled ahead: </span>
            <strong className="font-mono text-orange-900 dark:text-orange-200">
              {formatDuration(summary.totalScheduledMinutes)}
            </strong>
          </div>
        </div>
      </div>

      {/* Add Project Row */}
      <form
        onSubmit={handleAddProject}
        className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/25 p-2.5 text-xs"
      >
        <FolderKanban className="size-4 text-muted-foreground" />
        <Input
          value={newProjectTitle}
          onChange={(e) => setNewProjectTitle(e.target.value)}
          placeholder="Add project (e.g. AIIM Fellowship, UIST Paper, Thesis Proposal)..."
          className="h-7 min-w-[200px] flex-1 bg-background text-xs"
        />
        <Select
          value={newTargetHours}
          onValueChange={(v) => {
            if (v) setNewTargetHours(v);
          }}
        >
          <SelectTrigger size="sm" className="h-7 w-[135px] bg-background text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2">Target: 2h</SelectItem>
            <SelectItem value="4">Target: 4h</SelectItem>
            <SelectItem value="6">Target: 6h</SelectItem>
            <SelectItem value="10">Target: 10h</SelectItem>
            <SelectItem value="15">Target: 15h</SelectItem>
            <SelectItem value="20">Target: 20h</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" size="xs" disabled={!newProjectTitle.trim()} className="gap-1">
          <Plus className="size-3" />
          Add Project
        </Button>
      </form>

      {/* Project Cards */}
      {summary.projects.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center text-xs text-muted-foreground">
          No projects added yet. Add a project above (or schedule a multi-session task in the composer) to track hours invested, upcoming blocks, and completion progress.
        </div>
      ) : (
        <div className="space-y-3">
          {summary.projects.map((item) => {
            const { project } = item;
            const isExpanded =
              expandedProjectIds.has(project.id) || summary.projects.length <= 4;
            const denom = Math.max(
              60,
              item.targetMinutes ?? item.totalAllocatedMinutes
            );
            const donePct = Math.min(
              100,
              Math.round((item.completedMinutes / denom) * 100)
            );
            const schedPct = Math.min(
              100 - donePct,
              Math.round((item.scheduledUpcomingMinutes / denom) * 100)
            );
            const parentStriving = userGraph.strivings.find(
              (s) => s.id === project.parentStrivingId
            );

            return (
              <div
                key={project.id}
                className="rounded-xl border bg-background p-3.5 text-xs shadow-2xs"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleExpand(project.id)}
                        className="inline-flex items-center gap-1 text-sm font-semibold hover:underline"
                      >
                        {isExpanded ? (
                          <ChevronDown className="size-3.5" />
                        ) : (
                          <ChevronRight className="size-3.5" />
                        )}
                        {project.canonicalTitle}
                      </button>
                      {parentStriving && (
                        <Badge variant="outline" className="text-[10px]">
                          {parentStriving.title.slice(0, 36)}
                        </Badge>
                      )}
                      {project.cadenceNote && (
                        <Badge variant="secondary" className="text-[10px]">
                          {project.cadenceNote}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {project.summary}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Select
                      value={
                        item.targetMinutes
                          ? String(Math.round(item.targetMinutes / 60))
                          : "none"
                      }
                      onValueChange={(v) => {
                        if (!v) return;
                        onUpdateProjectTargetMinutes(
                          project.id,
                          v === "none" ? 0 : Number(v) * 60
                        );
                      }}
                    >
                      <SelectTrigger size="sm" className="h-7 w-[112px] text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No target</SelectItem>
                        <SelectItem value="2">Goal: 2h</SelectItem>
                        <SelectItem value="4">Goal: 4h</SelectItem>
                        <SelectItem value="6">Goal: 6h</SelectItem>
                        <SelectItem value="10">Goal: 10h</SelectItem>
                        <SelectItem value="15">Goal: 15h</SelectItem>
                        <SelectItem value="20">Goal: 20h</SelectItem>
                      </SelectContent>
                    </Select>

                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => onScheduleProjectSession(project.id)}
                      className="gap-1"
                    >
                      <CalendarPlus className="size-3" />+ Session
                    </Button>
                  </div>
                </div>

                {/* Dual Segmented Progress Bar: Emerald = Done, Orange = Scheduled */}
                <div className="mt-3 space-y-1">
                  <div className="flex flex-wrap items-center justify-between text-[11px]">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-medium text-emerald-700 dark:text-emerald-300">
                        ✓ {formatDuration(item.completedMinutes)} completed (
                        {item.doneBlocksCount} block
                        {item.doneBlocksCount === 1 ? "" : "s"})
                      </span>
                      <span className="font-medium text-orange-700 dark:text-orange-300">
                        • {formatDuration(item.scheduledUpcomingMinutes)} on
                        calendar ({item.upcomingBlocksCount} upcoming)
                      </span>
                    </div>
                    <span className="font-mono text-muted-foreground">
                      {item.targetMinutes
                        ? `${donePct}% of ${formatDuration(item.targetMinutes)} target`
                        : `${item.progressPercent}% of scheduled done`}
                    </span>
                  </div>

                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                    {donePct > 0 && (
                      <div
                        className="bg-emerald-500 transition-all"
                        style={{ width: `${donePct}%` }}
                        title={`Completed: ${formatDuration(item.completedMinutes)}`}
                      />
                    )}
                    {schedPct > 0 && (
                      <div
                        className="bg-orange-400/80 transition-all"
                        style={{ width: `${schedPct}%` }}
                        title={`Scheduled upcoming: ${formatDuration(item.scheduledUpcomingMinutes)}`}
                      />
                    )}
                  </div>
                </div>

                {/* Expanded Corresponding Tasks / Calendar Blocks */}
                {isExpanded && item.linkedBlocks.length > 0 && (
                  <div className="mt-3 space-y-1 border-t pt-2.5">
                    <div className="text-[10.5px] font-semibold text-muted-foreground">
                      Corresponding Calendar Blocks ({item.linkedBlocks.length})
                    </div>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {item.linkedBlocks.map((blk) => (
                        <div
                          key={blk.id}
                          className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 px-2.5 py-1.5"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onToggleBlockDone(blk.id)}
                              className={`flex size-3.5 shrink-0 items-center justify-center rounded-sm border ${
                                blk.done
                                  ? "border-emerald-600 bg-emerald-600 text-white"
                                  : "border-foreground/40 bg-background"
                              }`}
                            >
                              {blk.done && <Check className="size-2.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => onSelectBlockId(blk.id)}
                              className="min-w-0 flex-1 text-left hover:underline"
                            >
                              <div
                                className={`truncate font-medium ${
                                  blk.done
                                    ? "line-through text-muted-foreground"
                                    : ""
                                }`}
                              >
                                {blk.title}
                              </div>
                              <div className="font-mono text-[10px] text-muted-foreground">
                                {formatDateKeyLabel(blk.dateKey, todayKey)} ·{" "}
                                {formatMinutesToTime(blk.startMinutes)} (
                                {formatDuration(blk.durationMinutes)})
                              </div>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Unassigned Tasks Bucket — 1-Click Assign to Any Project */}
      {summary.unassignedBlocks.length > 0 && userGraph.taskModels.length > 0 && (
        <div className="space-y-2 rounded-xl border bg-muted/20 p-3 text-xs">
          <div className="font-semibold">
            Unassigned Calendar Tasks ({summary.unassignedBlocks.length})
          </div>
          <div className="space-y-1.5">
            {summary.unassignedBlocks.map((blk) => (
              <div
                key={blk.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background px-2.5 py-1.5"
              >
                <button
                  type="button"
                  onClick={() => onSelectBlockId(blk.id)}
                  className="min-w-0 flex-1 text-left hover:underline"
                >
                  <span className="font-medium">{blk.title}</span>{" "}
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    ({blk.dateKey} · {formatDuration(blk.durationMinutes)})
                  </span>
                </button>
                <Select
                  value=""
                  onValueChange={(projId) => {
                    if (projId) onAssignBlockToProject(blk.id, projId);
                  }}
                >
                  <SelectTrigger size="sm" className="h-6 w-[160px] text-[10.5px]">
                    <SelectValue placeholder="Assign to project..." />
                  </SelectTrigger>
                  <SelectContent>
                    {userGraph.taskModels.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.canonicalTitle}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
