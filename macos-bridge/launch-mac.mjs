#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const uiPort = process.env.PORT || "43820";

console.log("Starting Dayframe for macOS (UI + Native Calendar/Mail/Capture Bridge)...");

const nextProc = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "dev", "--port", uiPort],
  {
    cwd: rootDir,
    stdio: "inherit",
    env: { ...process.env },
  }
);

setTimeout(() => {
  const bridgeProc = spawn(
    process.execPath,
    [path.join(__dirname, "dayframe-mac.mjs"), "--open"],
    {
      cwd: rootDir,
      stdio: "inherit",
      env: { ...process.env, DAYFRAME_UI_PORT: uiPort },
    }
  );

  const shutdown = () => {
    bridgeProc.kill();
    nextProc.kill();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}, 2200);
