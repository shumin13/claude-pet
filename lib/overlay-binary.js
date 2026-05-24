import { access, chmod, copyFile, mkdir, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import {
  overlayPath,
  prebuiltOverlayPath,
  root,
  swiftModuleCacheDir,
  swiftSource
} from "./config.js";

export async function commandExists(command) {
  try {
    await run(command, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function executable(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function hasPrebuiltOverlay() {
  return executable(prebuiltOverlayPath);
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: options.stdio || "inherit",
      env: {
        ...process.env,
        CLANG_MODULE_CACHE_PATH: swiftModuleCacheDir,
        ...options.env
      }
    });
    child.on("error", reject);
    child.on("exit", code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

async function targetIsCurrentWithPrebuilt() {
  if (!(await executable(overlayPath))) return false;
  const [prebuiltStat, overlayStat] = await Promise.all([stat(prebuiltOverlayPath), stat(overlayPath)]);
  return overlayStat.size === prebuiltStat.size && overlayStat.mtimeMs >= prebuiltStat.mtimeMs;
}

async function targetIsCurrentWithSource() {
  if (!(await executable(overlayPath))) return false;
  const [sourceStat, overlayStat] = await Promise.all([stat(swiftSource), stat(overlayPath)]);
  return overlayStat.mtimeMs >= sourceStat.mtimeMs;
}

export async function ensureOverlayBinary({ quiet = false } = {}) {
  if (await hasPrebuiltOverlay()) {
    if (await targetIsCurrentWithPrebuilt()) {
      if (!quiet) console.log("Native overlay is already installed.");
      return "current";
    }

    if (!quiet) console.log("Installing prebuilt native macOS overlay...");
    await mkdir(dirname(overlayPath), { recursive: true });
    await copyFile(prebuiltOverlayPath, overlayPath);
    await chmod(overlayPath, 0o755);
    return "prebuilt";
  }

  if (await targetIsCurrentWithSource()) {
    if (!quiet) console.log("Native overlay is already built.");
    return "current";
  }

  if (!(await commandExists("swiftc"))) {
    throw new Error("Xcode command line tools are required because no prebuilt overlay was found and swiftc is not available.");
  }

  if (!quiet) console.log("Building native macOS overlay...");
  await rm(swiftModuleCacheDir, { recursive: true, force: true });
  await mkdir(swiftModuleCacheDir, { recursive: true });
  await mkdir(dirname(overlayPath), { recursive: true });
  await run("swiftc", [
    "macos/RobotPetOverlay.swift",
    "-framework",
    "Cocoa",
    "-framework",
    "WebKit",
    "-o",
    overlayPath
  ]);
  await rm(swiftModuleCacheDir, { recursive: true, force: true });
  return "built";
}
