#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
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
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  const event = await readStdinJson();
  await mkdir(logDir, { recursive: true });
  await withFileLock(lifecycleLockDir, async () => {
    await recordSession(event);

    if (!(await healthCheck())) {
      const serverProcess = spawnDetached(process.execPath, ["server.js"], "server.log");
      await writeFile(serverPidFile, `${serverProcess.pid}\n`);
      await new Promise(resolve => setTimeout(resolve, 1000));
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
