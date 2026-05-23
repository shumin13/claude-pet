#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { pruneStaleSessions, readSessions, sessionKey, sessionsFile, writeSessions } from "../lib/session-labels.js";
import { eventsUrl, lifecycleLockDir, logDir, overlayPidFile, serverPidFile } from "../lib/config.js";
import { withFileLock } from "../lib/lock.js";
import { isAlive, postJson, readPid, readStdinJson, removeFile } from "../lib/runtime.js";

async function killPidFile(path) {
  const pid = await readPid(path);
  if (isAlive(pid)) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // Fall back to killing only the recorded process.
    }
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Ignore cleanup races.
    }
  }
  try {
    await removeFile(path);
  } catch {
    // Ignore cleanup races.
  }
}

async function resetPetServer() {
  try {
    await postJson(eventsUrl, {
      type: "ready",
      title: "Claude Pet is awake",
      message: "Waiting for Claude Code notifications.",
      replay: true
    });
  } catch {
    // Server may already be closed.
  }
}

async function main() {
  const event = await readStdinJson();
  await mkdir(logDir, { recursive: true });

  await withFileLock(lifecycleLockDir, async () => {
    const sessionId = sessionKey(event);
    const sessions = pruneStaleSessions(await readSessions());
    if (sessionId) delete sessions[sessionId];

    const remaining = Object.keys(sessions);
    if (remaining.length > 0) {
      await writeSessions(sessions);
      return;
    }

    try {
      await removeFile(sessionsFile);
    } catch {
      // Already gone.
    }

    await resetPetServer();
    await killPidFile(overlayPidFile);
    await killPidFile(serverPidFile);
  });
}

main().catch(error => {
  console.error(error?.message || error);
  process.exit(1);
});
