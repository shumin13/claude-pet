#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { isExpectedHealth } from "../lib/app-identity.js";
import { recordSession } from "../lib/session-labels.js";
import { withFileLock } from "../lib/lock.js";
import { ensureOverlayBinary } from "../lib/overlay-binary.js";
import { isAlive, readPid, readStdinJson, removeFile } from "../lib/runtime.js";
import {
  lifecycleLockDir,
  healthUrl,
  desktopUrl,
  logDir,
  overlayPath,
  overlayPidFile,
  port,
  root,
  serverPidFile,
  buildDir
} from "../lib/config.js";

function spawnDetached(command, args, logName) {
  const child = spawn(command, args, {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      CLAUDE_PET_ROOT: root,
      CLAUDE_PET_BUILD_DIR: buildDir,
      CLAUDE_PET_DESKTOP_URL: desktopUrl
    }
  });
  child.unref();
  return child;
}

async function processIsAlive(pidFile) {
  const pid = await readPid(pidFile);
  if (isAlive(pid)) return true;
  await removeFile(pidFile);
  return false;
}

async function healthCheck() {
  try {
    const response = await fetch(healthUrl);
    if (!response.ok) {
      return { ok: false, reachable: true, reason: `/health returned ${response.status}` };
    }

    let health;
    try {
      health = await response.json();
    } catch {
      return { ok: false, reachable: true, reason: "/health returned invalid JSON" };
    }

    if (!isExpectedHealth(health)) {
      return { ok: false, reachable: true, reason: "health identity did not match this install", health };
    }

    const desktop = await fetch(desktopUrl);
    const contentType = desktop.headers.get("content-type") || "";
    if (!desktop.ok || !contentType.includes("text/html")) {
      return { ok: false, reachable: true, reason: `/desktop.html returned ${desktop.status} ${contentType}` };
    }

    return { ok: true };
  } catch {
    return { ok: false, reachable: false };
  }
}

function incompatibleServerError(check) {
  const details = check.reason ? ` ${check.reason}.` : "";
  return `Port ${port} is occupied by an incompatible claude-pet server.${details} Stop the stale server, then launch again.`;
}

async function main() {
  const event = await readStdinJson();
  await mkdir(logDir, { recursive: true });
  await withFileLock(lifecycleLockDir, async () => {
    await recordSession(event);

    const existingServer = await healthCheck();
    if (!existingServer.ok && existingServer.reachable) {
      throw new Error(incompatibleServerError(existingServer));
    }

    if (!existingServer.ok) {
      const serverProcess = spawnDetached(process.execPath, ["server.js"], "server.log");
      await writeFile(serverPidFile, `${serverProcess.pid}\n`);
      await new Promise(resolve => setTimeout(resolve, 1000));

      const newServer = await healthCheck();
      if (!newServer.ok) {
        throw new Error(newServer.reachable ? incompatibleServerError(newServer) : "Claude Pet server did not become healthy.");
      }
    }

    await ensureOverlayBinary({ quiet: true });

    if (!(await processIsAlive(overlayPidFile))) {
      const overlayProcess = spawnDetached(overlayPath, [], "overlay.log");
      await writeFile(overlayPidFile, `${overlayProcess.pid}\n`);
    }
  });
}

main().catch(error => {
  console.error(error?.message || error);
  process.exit(1);
});
