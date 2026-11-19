import {
  CalendarBlock,
  MacCalendarDescriptor,
  ModelLifecycleState,
  ScannedEmailItem,
} from "./types";

const MAC_BRIDGE_BASE = "http://127.0.0.1:43822";

export interface MacBridgeConnectionState {
  reachable: boolean;
  paired: boolean;
  isMac?: boolean;
  offlineLoopbackOnly?: boolean;
  androidSyncFolder?: string;
  queuedCaptureCount?: number;
  collectorEnabled?: boolean;
  modelsSleeping?: boolean;
  residentAiRamMb?: number;
  error?: string;
}

export function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dateKeyAndMinutesToEpochMs(
  dateKey: string,
  minutesFromMidnight: number
): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  dt.setMinutes(minutesFromMidnight);
  return dt.getTime();
}

export async function probeMacBridge(
  pairingToken: string
): Promise<MacBridgeConnectionState> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1800);
    const healthRes = await fetch(`${MAC_BRIDGE_BASE}/health`, {
      signal: ctrl.signal,
    });
    clearTimeout(t);

    if (!healthRes.ok) {
      return {
        reachable: false,
        paired: false,
        error: "Mac Daemon did not respond cleanly on 127.0.0.1:43822.",
      };
    }

    if (!pairingToken.trim()) {
      return {
        reachable: true,
        paired: false,
        error:
          "Mac Daemon detected on 127.0.0.1:43822! Paste the Pairing Token printed in your terminal.",
      };
    }

    const statusRes = await fetch(`${MAC_BRIDGE_BASE}/api/status`, {
      headers: { Authorization: `Bearer ${pairingToken.trim()}` },
    });

    if (statusRes.status === 401) {
      return {
        reachable: true,
        paired: false,
        error: "Pairing token rejected — check the token printed by ./dayframe.",
      };
    }

    const body = (await statusRes.json()) as {
      ok?: boolean;
      isMac?: boolean;
      offlineLoopbackOnly?: boolean;
      androidSyncFolder?: string;
      queuedCaptureCount?: number;
      collectorEnabled?: boolean;
      modelsSleeping?: boolean;
      residentAiRamMb?: number;
    };

    return {
      reachable: true,
      paired: Boolean(body.ok),
      isMac: body.isMac,
      offlineLoopbackOnly: body.offlineLoopbackOnly,
      androidSyncFolder: body.androidSyncFolder,
      queuedCaptureCount: body.queuedCaptureCount ?? 0,
      collectorEnabled: body.collectorEnabled ?? false,
      modelsSleeping: body.modelsSleeping ?? true,
      residentAiRamMb: body.residentAiRamMb ?? 0,
    };
  } catch {
    return {
      reachable: false,
      paired: false,
      error: "Mac Daemon is not running yet on 127.0.0.1:43822.",
    };
  }
}

export async function fetchMacModelLifecycle(params: {
  pairingToken: string;
  valenPort: number;
}): Promise<Omit<ModelLifecycleState, "activePhase"> | null> {
  if (!params.pairingToken.trim()) return null;
  try {
    const res = await fetch(
      `${MAC_BRIDGE_BASE}/api/models/lifecycle?valenPort=${params.valenPort}`,
      {
        headers: { Authorization: `Bearer ${params.pairingToken.trim()}` },
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok?: boolean;
      valenRunning?: boolean;
      ollamaDaemonRunning?: boolean;
      loadedOllamaModels?: string[];
      residentAiRamMb?: number;
      allModelsSleeping?: boolean;
      lastBatchCompletedIso?: string;
    };
    if (!data.ok) return null;
    return {
      allModelsSleeping: Boolean(data.allModelsSleeping),
      valenRunning: Boolean(data.valenRunning),
      ollamaDaemonRunning: Boolean(data.ollamaDaemonRunning),
      loadedOllamaModels: data.loadedOllamaModels ?? [],
      residentAiRamMb: data.residentAiRamMb ?? 0,
      lastBatchCompletedIso: data.lastBatchCompletedIso,
    };
  } catch {
    return null;
  }
}

export async function wakeValenViaMacDaemon(params: {
  pairingToken: string;
  port: number;
  ggufFile: string;
}): Promise<{ ok: boolean; running: boolean; reason?: string }> {
  if (!params.pairingToken.trim()) {
    return { ok: false, running: false, reason: "Mac Daemon not paired." };
  }
  try {
    const res = await fetch(`${MAC_BRIDGE_BASE}/api/models/wake-valen`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.pairingToken.trim()}`,
      },
      body: JSON.stringify({
        port: params.port,
        ggufFile: params.ggufFile,
      }),
    });
    return (await res.json()) as {
      ok: boolean;
      running: boolean;
      reason?: string;
    };
  } catch {
    return { ok: false, running: false };
  }
}

export async function stopValenViaMacDaemon(
  pairingToken: string
): Promise<void> {
  if (!pairingToken.trim()) return;
  try {
    await fetch(`${MAC_BRIDGE_BASE}/api/models/stop-valen`, {
      method: "POST",
      headers: { Authorization: `Bearer ${pairingToken.trim()}` },
    });
  } catch {
    // Non-fatal
  }
}

export async function wakeOllamaViaMacDaemon(
  pairingToken: string
): Promise<{ ok: boolean; running: boolean; error?: string }> {
  if (!pairingToken.trim()) {
    return { ok: false, running: false, error: "Mac Daemon not paired." };
  }
  try {
    const res = await fetch(`${MAC_BRIDGE_BASE}/api/models/wake-ollama`, {
      method: "POST",
      headers: { Authorization: `Bearer ${pairingToken.trim()}` },
    });
    return (await res.json()) as {
      ok: boolean;
      running: boolean;
      error?: string;
    };
  } catch {
    return { ok: false, running: false };
  }
}

export async function sleepAllModelsViaMacDaemon(params: {
  pairingToken: string;
  gemmaModel: string;
}): Promise<{ ok: boolean; unloadedModels: string[]; daemonStopped: boolean }> {
  if (params.pairingToken.trim()) {
    try {
      const res = await fetch(`${MAC_BRIDGE_BASE}/api/models/sleep-ollama`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.pairingToken.trim()}`,
        },
        body: JSON.stringify({ model: params.gemmaModel }),
      });
      if (res.ok) {
        const body = (await res.json()) as {
          unloadedModels?: string[];
          daemonStopped?: boolean;
        };
        return {
          ok: true,
          unloadedModels: body.unloadedModels ?? [],
          daemonStopped: Boolean(body.daemonStopped),
        };
      }
    } catch {
      // Fall back to direct loopback keep_alive: 0 below
    }
  }

  try {
    await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: params.gemmaModel, keep_alive: 0 }),
    });
    return {
      ok: true,
      unloadedModels: [params.gemmaModel],
      daemonStopped: false,
    };
  } catch {
    return { ok: true, unloadedModels: [], daemonStopped: false };
  }
}

export async function configureMacBackgroundCollector(params: {
  pairingToken: string;
  enabled: boolean;
  intervalMinutes: number;
}): Promise<boolean> {
  if (!params.pairingToken.trim()) return false;
  try {
    const res = await fetch(`${MAC_BRIDGE_BASE}/api/collector/config`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.pairingToken.trim()}`,
      },
      body: JSON.stringify({
        enabled: params.enabled,
        intervalMinutes: params.intervalMinutes,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchMacDiskCaptureQueue(params: {
  pairingToken: string;
  includeImages?: boolean;
}): Promise<{
  ok: boolean;
  totalQueued: number;
  skippedDuplicates: number;
  items: Array<{
    id: string;
    capturedAtIso: string;
    appName: string;
    windowTitle: string;
    imageDataUrl: string;
  }>;
}> {
  if (!params.pairingToken.trim()) {
    return { ok: false, totalQueued: 0, skippedDuplicates: 0, items: [] };
  }
  try {
    const flag = params.includeImages === false ? "0" : "1";
    const res = await fetch(
      `${MAC_BRIDGE_BASE}/api/capture/queue?images=${flag}`,
      {
        headers: { Authorization: `Bearer ${params.pairingToken.trim()}` },
      }
    );
    if (!res.ok) {
      return { ok: false, totalQueued: 0, skippedDuplicates: 0, items: [] };
    }
    const data = (await res.json()) as {
      ok?: boolean;
      totalQueued?: number;
      skippedDuplicates?: number;
      items?: Array<{
        id: string;
        capturedAtIso: string;
        appName: string;
        windowTitle: string;
        imageDataUrl: string;
      }>;
    };
    return {
      ok: Boolean(data.ok),
      totalQueued: data.totalQueued ?? 0,
      skippedDuplicates: data.skippedDuplicates ?? 0,
      items: data.items ?? [],
    };
  } catch {
    return { ok: false, totalQueued: 0, skippedDuplicates: 0, items: [] };
  }
}

export async function acknowledgeMacDiskCaptures(params: {
  pairingToken: string;
  ids: string[];
}): Promise<void> {
  if (!params.pairingToken.trim() || params.ids.length === 0) return;
  try {
    await fetch(`${MAC_BRIDGE_BASE}/api/capture/ack`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.pairingToken.trim()}`,
      },
      body: JSON.stringify({ ids: params.ids }),
    });
  } catch {
    // Non-fatal
  }
}

export async function openMacCalendarPrivacySettings(
  pairingToken: string
): Promise<void> {
  if (!pairingToken.trim()) return;
  try {
    await fetch(`${MAC_BRIDGE_BASE}/api/system/open-calendar-privacy`, {
      method: "POST",
      headers: { Authorization: `Bearer ${pairingToken.trim()}` },
    });
  } catch {
    // Non-fatal
  }
}

export async function sendMacNativeNotification(params: {
  pairingToken: string;
  title: string;
  message: string;
}): Promise<void> {
  if (!params.pairingToken.trim()) return;
  try {
    await fetch(`${MAC_BRIDGE_BASE}/api/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.pairingToken.trim()}`,
      },
      body: JSON.stringify({
        title: params.title,
        message: params.message,
      }),
    });
  } catch {
    // Non-fatal
  }
}

export async function scanMacCalendarEvents(params: {
  pairingToken: string;
  daysAhead?: number;
}): Promise<{
  ok: boolean;
  calendars: MacCalendarDescriptor[];
  defaultCalendarId: string;
  blocks: CalendarBlock[];
  error?: string;
}> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const startMs = start.getTime();
  const endMs = startMs + (params.daysAhead ?? 7) * 24 * 60 * 60 * 1000;

  try {
    const res = await fetch(`${MAC_BRIDGE_BASE}/api/calendar/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.pairingToken.trim()}`,
      },
      body: JSON.stringify({ startMs, endMs }),
    });

    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      defaultCalendarId?: string;
      calendars?: MacCalendarDescriptor[];
      events?: Array<{
        id: string;
        title: string;
        startIso: string;
        endIso: string;
        isRecurring: boolean;
        location: string;
        calendarTitle: string;
      }>;
    };

    if (!data.ok) {
      return {
        ok: false,
        calendars: [],
        defaultCalendarId: "",
        blocks: [],
        error: data.error || "Failed scanning macOS Calendar.app.",
      };
    }

    const blocks: CalendarBlock[] = (data.events ?? []).map((ev, idx) => {
      const s = new Date(ev.startIso);
      const e = new Date(ev.endIso);
      const startMinutes = s.getHours() * 60 + s.getMinutes();
      const rawDur = Math.round((e.getTime() - s.getTime()) / 60000);
      const durationMinutes = Math.max(
        15,
        Math.min(480, Math.round(rawDur / 15) * 15)
      );

      return {
        id: `mac-cal-${idx}-${ev.id.slice(0, 14)}`,
        title: ev.title,
        kind: "meeting",
        status: "confirmed",
        dateKey: toLocalDateKey(s),
        startMinutes,
        durationMinutes,
        isRecurring: ev.isRecurring,
        locationOrUrl: ev.location || undefined,
        calendarTitle: ev.calendarTitle,
        externalEventId: ev.id,
        syncedToExternalCalendar: true,
        sourceLabel: `macOS Calendar (${ev.calendarTitle})`,
        rationale: ev.isRecurring
          ? "Existing recurring event from your macOS Calendar."
          : "Existing event from your macOS Calendar.",
        confidence: 1,
      };
    });

    return {
      ok: true,
      calendars: data.calendars ?? [],
      defaultCalendarId: data.defaultCalendarId ?? "",
      blocks,
    };
  } catch (err) {
    return {
      ok: false,
      calendars: [],
      defaultCalendarId: "",
      blocks: [],
      error:
        err instanceof Error
          ? err.message
          : "Could not reach Mac Calendar Daemon on 127.0.0.1:43822.",
    };
  }
}

export async function scanMacMailMessages(params: {
  pairingToken: string;
  limit?: number;
}): Promise<{ ok: boolean; messages: ScannedEmailItem[]; error?: string }> {
  try {
    const res = await fetch(`${MAC_BRIDGE_BASE}/api/mail/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.pairingToken.trim()}`,
      },
      body: JSON.stringify({ limit: params.limit ?? 10 }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      messages?: Array<{
        id: string;
        subject: string;
        sender: string;
        dateIso: string;
        snippet: string;
      }>;
    };
    if (!data.ok) {
      return { ok: false, messages: [], error: data.error };
    }
    return {
      ok: true,
      messages: (data.messages ?? []).map((m) => ({
        ...m,
        source: "apple-mail" as const,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      messages: [],
      error: err instanceof Error ? err.message : "Mail scan failed.",
    };
  }
}

export async function writeBlockToMacCalendar(params: {
  pairingToken: string;
  block: CalendarBlock;
  calendarId?: string;
}): Promise<{ ok: boolean; externalEventId?: string; error?: string }> {
  const { pairingToken, block, calendarId } = params;
  const startMs = dateKeyAndMinutesToEpochMs(block.dateKey, block.startMinutes);
  const endMs = startMs + block.durationMinutes * 60 * 1000;
  const prefix =
    block.kind === "prep"
      ? "[Prep] "
      : block.isSoloHold
        ? "[Solo Hold] "
        : block.kind === "deep-work"
          ? "[Focus] "
          : "";

  try {
    const res = await fetch(`${MAC_BRIDGE_BASE}/api/calendar/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pairingToken.trim()}`,
      },
      body: JSON.stringify({
        title: `${prefix}${block.title}`,
        startMs,
        endMs,
        notes: `${block.rationale}\nScheduled offline by Dayframe (${block.sourceLabel})`,
        location: block.locationOrUrl || "",
        calendarId: calendarId || "",
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      externalEventId?: string;
      error?: string;
    };
    return {
      ok: Boolean(data.ok),
      externalEventId: data.externalEventId,
      error: data.error,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed writing to Calendar.app.",
    };
  }
}

export async function captureSilentMacScreenshot(
  pairingToken: string
): Promise<{
  ok: boolean;
  skippedPrivateApp?: boolean;
  skippedDuplicate?: boolean;
  appName?: string;
  windowTitle?: string;
  imageDataUrl?: string;
  error?: string;
}> {
  try {
    const res = await fetch(`${MAC_BRIDGE_BASE}/api/capture/screen`, {
      method: "POST",
      headers: { Authorization: `Bearer ${pairingToken.trim()}` },
    });
    return (await res.json()) as {
      ok: boolean;
      skippedPrivateApp?: boolean;
      skippedDuplicate?: boolean;
      appName?: string;
      windowTitle?: string;
      imageDataUrl?: string;
      error?: string;
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Screen capture failed.",
    };
  }
}

export async function fetchMacAndroidFolderQueue(
  pairingToken: string
): Promise<{
  ok: boolean;
  folder: string;
  screenshots: Array<{
    filename: string;
    capturedAtIso: string;
    imageDataUrl: string;
  }>;
}> {
  try {
    const res = await fetch(`${MAC_BRIDGE_BASE}/api/android/queue`, {
      headers: { Authorization: `Bearer ${pairingToken.trim()}` },
    });
    const data = (await res.json()) as {
      ok?: boolean;
      folder?: string;
      screenshots?: Array<{
        filename: string;
        capturedAtIso: string;
        imageDataUrl: string;
      }>;
    };
    return {
      ok: Boolean(data.ok),
      folder: data.folder || "~/Pictures/Dayframe-Android",
      screenshots: data.screenshots ?? [],
    };
  } catch {
    return {
      ok: false,
      folder: "~/Pictures/Dayframe-Android",
      screenshots: [],
    };
  }
}
