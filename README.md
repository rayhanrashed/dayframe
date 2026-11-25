# Dayframe

Dayframe is a local macOS application that schedules work directly onto your calendar instead of keeping an unscheduled to-do list. It reads context from your selected macOS calendars, open Slack and mail windows, Apple Mail, and local PDFs, and writes time blocks to a single user-selected calendar.

All inference and system access run locally over `127.0.0.1` without external API calls.

## Core Functions

- **Calendar Read/Write Scope**: Select which macOS calendars to read busy events and meetings from, and pin a single calendar (for example, your personal UMich calendar) as the only write destination. Unselected calendars are ignored.
- **Direct Calendar Scheduling & Decomposition**:
  - Natural-language input parses canonical event titles, durations, deadlines, and weekly cadences (for example, `"aiim fellowship. 2 hours each week for the next two weeks"` schedules `AIIM Fellowship` blocks across Week 1 and Week 2).
  - Multi-hour deadlines are split into 60–90 minute blocks, starting with a scoping session and backtracked before the due date.
  - Estimates are scaled by a calibration multiplier (`gut estimate × multiplier`), which updates as you mark blocks done and record actual time taken.
  - Protects daily buffers, morning hours, weekends, and user-specified busy/travel date ranges.
  - Unfinished blocks from earlier today or past days can be moved forward into open slots in one action.
- **Per-Event Chat & Private Internal Augmentation**:
  - Shared and external calendar events are strictly read-only in `Calendar.app` (never edited or deleted, so attendees never receive modified invite notifications).
  - Notes, checklists, approved papers, reminders, and chat history for meetings are stored privately inside `~/.dayframe/event-augmentations.json` and overlaid onto calendar events inside Dayframe.
  - Proposed solo preparation blocks, candidate PDFs, and suggested todos are staged for explicit confirmation before anything is attached or written as a solo block onto your target calendar.
- **User and Task Models**:
  - Maintains persistent models for ongoing projects/tasks (linking related calendar blocks, emails, captures, papers, and immediate next steps) and higher-level strivings, drawing on hierarchical activity modeling ([StanfordHCI/striving-cocreation](https://github.com/StanfordHCI/striving-cocreation)).
  - Supports inline rename, merge, reassign, and remove operations; edits are stored as constraints for subsequent model runs.
- **Two-Model Division of Labor + Deterministic Slot Solver**:
  - `Valen-Decision-1.5` (optional local GGUF server on `127.0.0.1:43823`): single-pass `predicate`/`choice`/`score`/`bbox` router for screenshot triage, utterance intent routing, calendar event role classification, Task-Model entity matching, and Mail/PDF relevance filtering.
  - `Gemma 4` (local Ollama on `127.0.0.1:11434`): compiles open-ended natural-language scheduling requests, multi-action per-event chat instructions, and preference updates into structured session specs; deterministic heuristics provide live input previews and offline fallback, and a constraint solver places sessions into conflict-free slots.
- **Projects & Time Progress + Triangulation**:
  - Switch between `Calendar Space` and `Projects & Progress` to see how completed (`✓`) and scheduled blocks map to each project, alongside hours invested vs. target hours.
  - Screenshot and Slack/Mail evaluations are conditioned on your existing Projects, Strivings, user edit constraints, and already-allocated calendar hours so captures update project evidence rather than creating duplicate standalone tasks.
- **Idle-Only Background Execution & Live Activity Bar**:
  - By default, background batch sweeps run only when macOS `IOHIDSystem` `HIDIdleTime` shows the keyboard/trackpad has been untouched for at least 5 minutes and CPU load is low; if you resume input mid-sweep, the batch pauses and unloads models (`keep_alive: 0`) immediately.
  - A persistent status bar beneath the header displays the active model, current operation, elapsed time, and a direct `Stop Model Now` button without opening a modal.

## Requirements

- macOS 14 or newer
- Node.js 20+
- Xcode Command Line Tools (`/usr/bin/swiftc` for the EventKit and CoreGraphics helpers)
- [Ollama](https://ollama.com) with a local Gemma 4 model (`ollama pull gemma4:e4b`)

## How to Run

```bash
git clone https://github.com/rayhanrashed/dayframe.git
cd dayframe
./dayframe
```

You can also double-click `Dayframe.command` in Finder, run `npm run mac`, or launch inside a standalone native macOS window + menu-bar app (`◷ Dayframe`, where closing the window hides to the menu bar instead of exiting):

```bash
./dayframe --app
```

On first launch, `./dayframe`:
1. Installs npm packages if `node_modules` is missing.
2. Checks `~/.ollama/models` for `gemma4` (pulls `gemma4:e4b` once if missing, then stops Ollama).
3. Builds the local Next.js bundle if `HEAD` changed and starts the UI on `http://127.0.0.1:43820` paired with the local macOS bridge on `http://127.0.0.1:43822`.

For development with hot reload, run:

```bash
./dayframe --dev
```

To check running status or stop all Dayframe, Ollama/Gemma 4, and Valen background processes:

```bash
./dayframe status
./dayframe stop
```

## macOS Permissions

Grant permissions in **System Settings -> Privacy & Security** to the terminal app running `./dayframe` (for example, `Terminal` or `Cursor`):
- **Calendars**: Required to read events and write blocks via EventKit.
- **Screen Recording**: Optional; required to capture open Slack/browser windows and periodic screenshots.
- **Automation (Mail)**: Optional; required to scan or search Apple `Mail.app`.

## Project Layout

- `dayframe` / `Dayframe.command` / `macos-bridge/launch-mac.mjs`: Launcher for the UI and local macOS daemon.
- `macos-bridge/dayframe-mac.mjs`: Local HTTP daemon (`127.0.0.1:43822`) managing EventKit, Mail, Spotlight PDF search, silent window capture, and Ollama/Valen process lifecycle.
- `macos-bridge/swift/`: Swift helpers for EventKit (`dayframe-eventkit.swift`) and CoreGraphics window enumeration (`dayframe-windows.swift`).
- `src/lib/nl-schedule-parser.ts`: Natural-language parser for canonical titles, weekly cadences, and per-event commands.
- `src/lib/place-on-calendar.ts` & `src/lib/scheduler.ts`: Slot solver, deadline backtracker, calibration multiplier, and overdue re-planner.
- `src/lib/user-task-model.ts`: Task-specific models, strivings, and user edit constraints.
- `src/components/dayframe/`: UI components (`dayframe-app.tsx`, `task-composer.tsx`, `calendar-timeline.tsx`, `event-workspace-dialog.tsx`, `organizer-feedback-panel.tsx`).
