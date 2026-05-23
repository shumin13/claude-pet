#!/usr/bin/env node

import { access, mkdir, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { recordSession } from "../lib/session-labels.js";
import { withFileLock } from "../lib/lock.js";
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
  swiftSource
} from "../lib/config.js";

async function executable(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function spawnDetached(command, args, logName) {
  const child = spawn(command, args, {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      CLAUDE_PET_ROOT: root,
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

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "ignore",
      env: {
        ...process.env,
        CLANG_MODULE_CACHE_PATH: join(root, ".build", "module-cache")
      }
    });
    child.on("error", reject);
    child.on("exit", code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

async function healthCheck() {
  try {
    const response = await fetch(healthUrl);
    return response.ok;
  } catch {
    return false;
  }
}

async function needsBuild() {
  if (!(await executable(overlayPath))) return true;
  const [sourceStat, overlayStat] = await Promise.all([stat(swiftSource), stat(overlayPath)]);
  return sourceStat.mtimeMs > overlayStat.mtimeMs;
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

    if (await needsBuild()) {
      await mkdir(join(root, ".build", "module-cache"), { recursive: true });
      await run("swiftc", [
        "macos/RobotPetOverlay.swift",
        "-framework",
        "Cocoa",
        "-framework",
        "WebKit",
        "-o",
        overlayPath
      ]);
    }

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
