# Dayframe

**Dayframe** is a privacy-first MacBook calendar organizer powered by a local vision AI model (Ollama on Apple Silicon, with an on-device heuristic fallback). Instead of piling items onto a to-do list, Dayframe periodically captures screenshots of your workspace (Apple Mail, Gmail, Slack, and active windows), estimates how long work will take, creates solo calendar holds from informal meeting mentions, and reserves preparation blocks ahead of recurring meetings.

## Key Capabilities

- **Customizable MacBook Screen Capture**: Capture your screen or specific windows (`Mail`, `Slack`) every 1 minute, 5 minutes, or any custom interval (`1–30 min`), with perceptual duplicate-frame skipping so unchanged screens do not trigger redundant inference.
- **Local Vision AI (`127.0.0.1:11434`)**: Connects directly from your MacBook browser to a local [Ollama](https://ollama.com) vision model (`llama3.2-vision`, `qwen2.5-vl`, `gemma3`), keeping screenshots on-device. Includes a built-in heuristic extractor and sample workspace day when Ollama is offline.
- **Time-Blocking Over To-Dos**: Slots tasks directly onto open windows on Today's or Tomorrow's calendar based on availability, protected lunch/wind-down hours, and calibrated duration estimates.
- **Solo Calendar Invites ("Just for You")**: Detects informal meeting mentions in emails or Slack threads that lack a formal `.ics` invite and creates personal calendar holds with one-click `.ics` export for Apple Calendar.
- **Standing Rules & Prep-Time Memory**: Remembers recurrent rules from your feedback (for example, *"I need at least 2 hours beforehand to prepare for recurring meetings"*—automatically placing prep earlier in the day, or the afternoon prior when a recurring meeting starts early in the morning).
- **Android Nightly Batch Sync Preview**: Queues lightweight raw phone screenshots (zero on-phone AI processing) for a nightly Mac batch run that deduplicates items already seen on your MacBook and schedules net-new commitments onto Tomorrow's calendar.

## Running Locally on macOS

1. Install dependencies:

```bash
npm install
```

2. (Optional) Start a local vision model with Ollama on your MacBook:

```bash
ollama pull llama3.2-vision
OLLAMA_ORIGINS="*" ollama serve
```

3. Start the app:

```bash
npm run dev
```

4. Open the local URL printed in your terminal, import your `.ics` calendar if desired, and click **Start Live Mac Capture** to select your Mac screen, Mail, or Slack window.
