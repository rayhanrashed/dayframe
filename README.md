# Dayframe

**Dayframe** is a two-stage local-AI MacBook calendar organizer pairing **Valen-Decision-1.5** (`Valen-Team/Valen-Decision-1.5-*-GGUF` — System-1 multimodal decision gatekeeper) with **Gemma 4** (`gemma4:e4b` / `12b` / `26b` / `31b` via Ollama — System-2 extractor and planner).

## Two-Stage Local AI Architecture

1. **Stage 1 — System-1 Gatekeeper (`Valen-Decision-1.5` via `/v1/decisions`)**:
   - Evaluates `predicate`, `choice`, `score`, and `bbox` questions in **one forward pass (`0` autoregressive output tokens)**.
   - **Screenshot Noise Filter**: Skips ~85% of non-actionable periodic screenshots (coding, docs, static browsing) before waking Gemma 4.
   - **Privacy Drop Gate**: Immediately discards screenshots displaying passwords, API keys, or banking screens in memory.
   - **`bbox` Visual Grounding**: Crops multi-window MacBook screenshots down to the exact actionable Mail or Slack pane before handing off to Gemma 4.
   - **Inbox & Prep Triage**: Screens out newsletters/automated alerts during inbox scans and scores whether one-off meetings require advance prep.
   - *Graceful Standby*: If the local Valen GGUF server is not running yet, Dayframe automatically falls back to routing directly to Gemma 4.
2. **Stage 2 — System-2 Extractor & Calendar Planner (`Gemma 4` via Ollama)**:
   - Runs only on screenshots and emails that pass the Valen gate, sizing task durations, creating solo meeting holds, and scheduling prep blocks (e.g. **≥2 hours before recurring meetings**) directly into your real calendar.
3. **Native macOS Bridge (`npm run mac`)**:
   - Talks directly to **macOS `Calendar.app`** (Apple EventKit), **macOS `Mail.app`**, and silent **`screencapture -x`** without `.ics` files.

## Quickstart on macOS

```bash
npm install

# Stage 2: Start Gemma 4 in Ollama
ollama pull gemma4:e4b
OLLAMA_ORIGINS="*" ollama serve

# (Optional) Stage 1: Serve Valen-Decision-1.5 GGUF (0.8B / 2B / 4B / 9B) on port 43823
# ./serve -m ./Valen-Decision-1.5-9B-Q8_0.gguf --mmproj ./vision-native-limits-F32.gguf --host 127.0.0.1 --port 43823

# Launch Dayframe + Native macOS Calendar/Mail/Screen Bridge
npm run mac
```
