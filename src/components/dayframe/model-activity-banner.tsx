"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BatchExecutionMode,
  ModelLifecycleState,
  OrganizerSettings,
} from "@/lib/types";
import { Cpu, Loader2, Moon, PowerOff } from "lucide-react";

interface ModelActivityBannerProps {
  lifecycle: ModelLifecycleState;
  isBusyAction: boolean;
  busyActionLabel?: string;
  settings: OrganizerSettings;
  onUpdateSettings: (patch: Partial<OrganizerSettings>) => void;
  onStopModelsNow: () => void;
}

export function ModelActivityBanner({
  lifecycle,
  isBusyAction,
  busyActionLabel,
  settings,
  onUpdateSettings,
  onStopModelsNow,
}: ModelActivityBannerProps) {
  const isModelActive =
    lifecycle.activePhase !== "sleeping" ||
    !lifecycle.allModelsSleeping ||
    isBusyAction;

  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!isModelActive) return;
    const t0 = lifecycle.startedAtMs || Date.now();
    const tick = () => {
      setElapsedSec(Math.max(0, Math.round((Date.now() - t0) / 100) / 10));
    };
    tick();
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
  }, [isModelActive, lifecycle.startedAtMs]);

  const phaseTitle = (() => {
    if (busyActionLabel) return busyActionLabel;
    if (lifecycle.currentTaskDescription) return lifecycle.currentTaskDescription;
    switch (lifecycle.activePhase) {
      case "waking-valen":
        return `Waking Valen-Decision-1.5 (${settings.valenModelId})...`;
      case "screening-valen":
        return `Valen-Decision-1.5 screening queue (0 output tokens)...`;
      case "waking-gemma":
        return `Waking ${settings.gemmaModel} in local Ollama...`;
      case "reasoning-gemma":
        return `${settings.gemmaModel} reasoning & triangulating with your Projects...`;
      case "unloading":
        return "Unloading model weights back to 0 MB RAM...";
      default:
        return `${settings.gemmaModel} resident in memory (${lifecycle.residentAiRamMb} MB)`;
    }
  })();

  const idleSelectValue =
    settings.batchExecutionMode === "when-device-idle"
      ? `idle-${settings.idleMinutesBeforeBatch || 5}`
      : settings.batchExecutionMode;

  if (isModelActive) {
    return (
      <div className="border-b border-amber-500/40 bg-amber-500/12 px-4 py-2 text-xs text-amber-950 dark:text-amber-100 lg:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Loader2 className="size-4 shrink-0 animate-spin text-amber-600 dark:text-amber-300" />
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Local AI Running:</span>
              <span>{phaseTitle}</span>
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[11px]">
                {elapsedSec.toFixed(1)}s
              </span>
              {lifecycle.residentAiRamMb > 0 && (
                <span className="font-mono text-[11px] opacity-80">
                  • {lifecycle.residentAiRamMb} MB RAM
                </span>
              )}
            </div>
          </div>

          <Button
            size="xs"
            variant="outline"
            onClick={onStopModelsNow}
            className="gap-1 border-amber-600/40 bg-background/80"
          >
            <PowerOff className="size-3" />
            Stop Model Now
          </Button>
        </div>
      </div>
    );
  }

  const idleSecs = lifecycle.deviceIdleSeconds ?? 0;
  const idleLabel =
    idleSecs >= 60
      ? `${Math.floor(idleSecs / 60)}m ${idleSecs % 60}s idle`
      : `${idleSecs}s idle`;

  return (
    <div className="border-b border-border/60 bg-muted/30 px-4 py-1.5 text-[11px] text-muted-foreground lg:px-6">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <Moon className="size-3 text-emerald-600" />
            Models Stopped (0 MB RAM)
          </span>
          <span>•</span>
          <span>
            {settings.batchExecutionMode === "when-device-idle"
              ? `Background AI runs only when Mac is untouched ≥${
                  settings.idleMinutesBeforeBatch || 5
                }m (${idleLabel}) & pauses immediately if you return`
              : settings.batchExecutionMode === "scheduled-batches"
                ? "Scheduled daily windows"
                : "Instant per capture"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Cpu className="size-3" />
          <span>Auto-run policy:</span>
          <Select
            value={idleSelectValue}
            onValueChange={(val) => {
              if (!val) return;
              if (val.startsWith("idle-")) {
                const mins = Number(val.replace("idle-", "")) || 5;
                onUpdateSettings({
                  batchExecutionMode: "when-device-idle",
                  idleMinutesBeforeBatch: mins,
                });
              } else {
                onUpdateSettings({
                  batchExecutionMode: val as BatchExecutionMode,
                });
              }
            }}
          >
            <SelectTrigger size="sm" className="h-6 min-w-[165px] bg-background text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="idle-3">
                Only when Mac idle ≥3 min
              </SelectItem>
              <SelectItem value="idle-5">
                Only when Mac idle ≥5 min (Default)
              </SelectItem>
              <SelectItem value="idle-10">
                Only when Mac idle ≥10 min
              </SelectItem>
              <SelectItem value="scheduled-batches">
                Fixed clock times (3x/day)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
