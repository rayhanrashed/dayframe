# Dayframe

**Dayframe** is a local-AI MacBook calendar organizer powered by **Gemma 4** (`gemma4:e4b` / `12b` / `26b` / `31b` via Ollama). Instead of dumping tasks into a to-do list or showing sample data, Dayframe starts with a **3-Step Kickstart Setup** that connects directly to your real Calendar & Mail, performs a one-off baseline scan of your upcoming week, and then runs silent periodic screenshots to keep your day organized.

## How It Works

1. **Local Gemma 4 Multimodal Engine (`127.0.0.1:11434`)**: Uses `gemma4` in Ollama for both vision (reading screenshots of Mail, Gmail, Slack, and active windows) and text reasoning (scanning recent inbox emails and applying your standing rules).
2. **Seamless Calendar & Mail Bridge (No `.ics` Uploads)**:
   - **Native Mac Mode (`npm run mac`)**: Connects directly to **macOS `Calendar.app`** via Apple EventKit (including Google, iCloud, and Exchange accounts signed into macOS), **macOS `Mail.app`**, and silent background **`screencapture -x`**.
   - **Browser Direct Mode**: Optionally connects directly to **Google Calendar** and **Gmail** APIs over HTTPS.
3. **One-Off Initial Baseline Scan**: During setup, Dayframe scans your existing calendar events for the next 7 days plus recent inbox messages—detecting recurring meetings, attaching your **≥2-hour lead prep blocks**, creating **solo calendar holds** from informal meeting mentions, and writing approved blocks straight back to your calendar.
4. **Continuous Screenshot Loop & Feedback Memory**: Captures screenshots at your chosen interval (`1m`, `5m`, custom), skips unchanged static screens, calibrates task durations from your feedback, and optionally processes raw Android screenshots synced to `~/Pictures/Dayframe-Android` at night.

## Quickstart on Your MacBook

1. Install dependencies:

```bash
npm install
```

2. Pull **Gemma 4** in Ollama and start the local server:

```bash
ollama pull gemma4:e4b
OLLAMA_ORIGINS="*" ollama serve
```

3. Launch Dayframe + the Native macOS Bridge together (auto-pairs Calendar.app, Mail.app, and silent screen capture):

```bash
npm run mac
```

*(If you already have the Dayframe UI open in a browser, you can also start just the bridge with `npm run mac-bridge` and paste the pairing token printed in your terminal.)*
