import {
  CalendarBlock,
  MacCalendarDescriptor,
  ScannedEmailItem,
} from "./types";

const MAC_BRIDGE_BASE = "http://127.0.0.1:43822";

export interface MacBridgeConnectionState {
  reachable: boolean;
  paired: boolean;
  isMac?: boolean;
  androidSyncFolder?: string;
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
        error: "Mac Bridge did not respond cleanly on 127.0.0.1:43822.",
      };
    }

    if (!pairingToken.trim()) {
      return {
        reachable: true,
        paired: false,
        error: "Mac Bridge detected! Paste the Pairing Token printed in your terminal.",
      };
    }

    const statusRes = await fetch(`${MAC_BRIDGE_BASE}/api/status`, {
      headers: { Authorization: `Bearer ${pairingToken.trim()}` },
    });

    if (statusRes.status === 401) {
      return {
        reachable: true,
        paired: false,
        error: "Pairing token rejected — check the token printed by npm run mac.",
      };
    }

    const body = (await statusRes.json()) as {
      ok?: boolean;
      isMac?: boolean;
      androidSyncFolder?: string;
    };

    return {
      reachable: true,
      paired: Boolean(body.ok),
      isMac: body.isMac,
      androidSyncFolder: body.androidSyncFolder,
    };
  } catch {
    return {
      reachable: false,
      paired: false,
      error: "Mac Bridge is not running yet on 127.0.0.1:43822.",
    };
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
          : "Could not reach Mac Calendar Bridge.",
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
        notes: `${block.rationale}\nScheduled by Dayframe (${block.sourceLabel})`,
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

/**
 * Direct Google Calendar + Gmail REST connector for browser-only mode (no .ics files).
 */
export async function scanGoogleCalendarAndGmail(params: {
  googleAccessToken: string;
  daysAhead?: number;
}): Promise<{
  ok: boolean;
  blocks: CalendarBlock[];
  emails: ScannedEmailItem[];
  error?: string;
}> {
  const token = params.googleAccessToken.trim();
  if (!token) {
    return { ok: false, blocks: [], emails: [], error: "Missing Google OAuth access token." };
  }

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(
    start.getTime() + (params.daysAhead ?? 7) * 24 * 60 * 60 * 1000
  );

  try {
    const calUrl = new URL(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events"
    );
    calUrl.searchParams.set("timeMin", start.toISOString());
    calUrl.searchParams.set("timeMax", end.toISOString());
    calUrl.searchParams.set("singleEvents", "true");
    calUrl.searchParams.set("orderBy", "startTime");
    calUrl.searchParams.set("maxResults", "100");

    const calRes = await fetch(calUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!calRes.ok) {
      return {
        ok: false,
        blocks: [],
        emails: [],
        error: `Google Calendar API returned HTTP ${calRes.status}. Verify your token has calendar.events scope.`,
      };
    }

    const calJson = (await calRes.json()) as {
      items?: Array<{
        id: string;
        summary?: string;
        location?: string;
        recurringEventId?: string;
        start?: { dateTime?: string };
        end?: { dateTime?: string };
      }>;
    };

    const blocks: CalendarBlock[] = [];
    for (const item of calJson.items ?? []) {
      if (!item.start?.dateTime || !item.end?.dateTime) continue;
      const s = new Date(item.start.dateTime);
      const e = new Date(item.end.dateTime);
      const startMinutes = s.getHours() * 60 + s.getMinutes();
      const durationMinutes = Math.max(
        15,
        Math.min(480, Math.round((e.getTime() - s.getTime()) / 60000 / 15) * 15)
      );

      blocks.push({
        id: `gcal-${item.id}`,
        title: item.summary || "Busy",
        kind: "meeting",
        status: "confirmed",
        dateKey: toLocalDateKey(s),
        startMinutes,
        durationMinutes,
        isRecurring: Boolean(item.recurringEventId),
        locationOrUrl: item.location,
        externalEventId: item.id,
        syncedToExternalCalendar: true,
        sourceLabel: "Google Calendar",
        rationale: item.recurringEventId
          ? "Recurring Google Calendar meeting."
          : "Existing Google Calendar event.",
        confidence: 1,
      });
    }

    // Optional Gmail unread messages scan if token also includes gmail.readonly
    const emails: ScannedEmailItem[] = [];
    try {
      const listRes = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=8&q=in:inbox",
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (listRes.ok) {
        const listData = (await listRes.json()) as {
          messages?: Array<{ id: string }>;
        };
        for (const m of (listData.messages ?? []).slice(0, 6)) {
          const detailRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!detailRes.ok) continue;
          const detail = (await detailRes.json()) as {
            id: string;
            snippet?: string;
            payload?: { headers?: Array<{ name: string; value: string }> };
          };
          const headers = detail.payload?.headers ?? [];
          const subject =
            headers.find((h) => h.name === "Subject")?.value || "(No subject)";
          const sender = headers.find((h) => h.name === "From")?.value || "";
          emails.push({
            id: `gmail-${detail.id}`,
            subject,
            sender,
            dateIso: new Date().toISOString(),
            snippet: detail.snippet || "",
            source: "gmail",
          });
        }
      }
    } catch {
      // Gmail scope is optional; calendar events still succeed
    }

    return { ok: true, blocks, emails };
  } catch (err) {
    return {
      ok: false,
      blocks: [],
      emails: [],
      error: err instanceof Error ? err.message : "Google API request failed.",
    };
  }
}

export async function writeBlockToGoogleCalendar(params: {
  googleAccessToken: string;
  block: CalendarBlock;
}): Promise<{ ok: boolean; externalEventId?: string; error?: string }> {
  const { googleAccessToken, block } = params;
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
    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${googleAccessToken.trim()}`,
        },
        body: JSON.stringify({
          summary: `${prefix}${block.title}`,
          description: `${block.rationale}\nScheduled by Dayframe (${block.sourceLabel})`,
          location: block.locationOrUrl,
          start: { dateTime: new Date(startMs).toISOString() },
          end: { dateTime: new Date(endMs).toISOString() },
        }),
      }
    );
    if (!res.ok) {
      return {
        ok: false,
        error: `Google Calendar write failed (HTTP ${res.status}).`,
      };
    }
    const created = (await res.json()) as { id?: string };
    return { ok: true, externalEventId: created.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Google Calendar write failed.",
    };
  }
}
