# Dayframe

**Dayframe** is an all-in-one, **100% offline** MacBook calendar organizer powered by on-demand local AI (**Valen-Decision-1.5** + **Gemma 4**).

## Key Design Principles

1. **All-In-One Single Launcher (`./dayframe` or `Dayframe.command`)**:
   - No juggling separate terminal windows. One command (or double-clicking `Dayframe.command` in Finder) auto-installs dependencies on first run, checks cached model weights, starts the loopback UI (`127.0.0.1:43820`), and pairs the native macOS EventKit/Mail/Capture daemon (`127.0.0.1:43822`).
2. **Zero-Idle-Resource Scheduled Batches (`0 MB` AI RAM 99% of the Day)**:
   - Throughout the day, screenshots queue silently as tiny compressed frames (`~/.dayframe/capture-queue/`) with **both AI models completely stopped (`0 MB` RAM / `0%` GPU)**.
   - At scheduled batch windows (**3x/day by default: `9:30 AM`, `1:30 PM`, `5:30 PM`**, or whenever you click **Run Batch Sweep**):
     1. **Wake `Valen-Decision-1.5`** &rarr; Screen queued frames in 1 forward pass (`0` output tokens), drop private screens, skip ~85% non-actionable frames, crop `bbox` &rarr; **Immediately terminate Valen (`0 MB` RAM)** before Stage 2 loads.
     2. **Wake `Gemma 4` via local Ollama** (only if actionable items survived) &rarr; Extract tasks, durations, and solo meeting holds &rarr; **Immediately unload weights (`keep_alive: 0`) and stop transient Ollama (`0 MB` RAM)**.
3. **Ask Often When Unsure**:
   - Whenever an email, Slack message, solo meeting mention, or task duration isn't 100% certain, Dayframe queues a plain-English **Yes / No / Adjust Duration / Always / Never** confirmation card rather than blindly writing to `Calendar.app`.
4. **100% Offline Workflow**:
   - Every single request in Dayframe's runtime workflow stays strictly on `127.0.0.1` loopback (`NEXT_TELEMETRY_DISABLED=1`, `OLLAMA_NOUPDATE=1`, native system fonts, local Apple EventKit `Calendar.app` & `Mail.app`). Once weights are cached once, Wi-Fi can be turned completely off.

## Run on Your MacBook

```bash
cd dayframe
./dayframe
```

*(Or double-click `Dayframe.command` in Finder, or run `npm run mac`.)*
