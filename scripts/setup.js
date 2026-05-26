#!/usr/bin/env node

import { cp, mkdir, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ensureOverlayBinary, hasPrebuiltOverlay, commandExists, run } from "../lib/overlay-binary.js";
import { root } from "../lib/config.js";

const defaultAppDir = join(homedir(), "Library", "Application Support", "claude-pet", "app");
const markerFile = ".claude-pet-app";
const activeAppEnv = "CLAUDE_PET_ACTIVE_APP_DIR";
const appFiles = [
  "bin",
  "hooks",
  "lib",
  "macos",
  "prebuilt",
  "public",
  "scripts",
  "server.js",
  "package.json",
  "README.md"
];

function parseAppDir() {
  const index = process.argv.indexOf("--app-dir");
  if (index >= 0) {
    if (!process.argv[index + 1]) throw new Error("--app-dir requires a directory path.");
    return process.argv[index + 1];
  }

  const inline = process.argv.find(arg => arg.startsWith("--app-dir="));
  if (inline) return inline.slice("--app-dir=".length);

  return process.env.CLAUDE_PET_APP_DIR;
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function samePath(left, right) {
  try {
    return await realpath(left) === await realpath(right);
  } catch {
    return resolve(left) === resolve(right);
  }
}

async function promptAppDir() {
  const configured = parseAppDir();
  if (configured) return resolve(configured);

  if (!process.stdin.isTTY || !process.stdout.isTTY) return defaultAppDir;

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });
  try {
    const answer = await rl.question(`Install Claude Pet app files here? [${defaultAppDir}] `);
    return resolve(answer.trim() || defaultAppDir);
  } finally {
    rl.close();
  }
}

function isDangerousAppDir(appDir) {
  const resolved = resolve(appDir);
  const home = homedir();
  return [
    "/",
    home,
    join(home, "Desktop"),
    join(home, "Documents"),
    join(home, "Downloads"),
    join(home, "Applications"),
    "/Applications",
    "/Library",
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/etc",
    "/var",
    "/tmp"
  ].some(path => resolved === resolve(path));
}

async function validateAppDir(appDir) {
  if (isDangerousAppDir(appDir)) {
    throw new Error(`Refusing to install app files directly into ${appDir}. Choose a dedicated Claude Pet folder instead.`);
  }

  if (!(await pathExists(appDir))) return;

  const entries = await readdir(appDir);
  if (entries.length === 0 || entries.includes(markerFile)) return;

  throw new Error(`${appDir} is not empty and is not marked as a Claude Pet app directory. Choose an empty directory or an existing Claude Pet app directory.`);
}

async function copyAppFiles(appDir) {
  if (await samePath(root, appDir)) return;

  await validateAppDir(appDir);
  console.log(`Installing app files to ${appDir}...`);
  await mkdir(appDir, { recursive: true });
  await writeFile(join(appDir, markerFile), "Claude Pet managed app directory.\n");

  for (const item of appFiles) {
    const source = join(root, item);
    if (!(await pathExists(source))) continue;
    await rm(join(appDir, item), { recursive: true, force: true });
    await cp(source, join(appDir, item), {
      recursive: true,
      force: true
    });
  }
}

function runSetupFrom(appDir) {
  return new Promise((resolvePromise, reject) => {
    const script = join(appDir, "scripts", "setup.js");
    const child = spawn(process.execPath, [script], {
      cwd: appDir,
      stdio: "inherit",
      env: {
        ...process.env,
        CLAUDE_PET_SKIP_APP_COPY: "1",
        [activeAppEnv]: appDir
      }
    });
    child.on("error", reject);
    child.on("exit", code => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${script} exited with ${code}`));
    });
  });
}

async function installStableAppIfNeeded() {
  if (process.env[activeAppEnv] && !parseAppDir()) return false;
  if (process.env.CLAUDE_PET_SKIP_APP_COPY === "1") return false;

  const appDir = await promptAppDir();
  await copyAppFiles(appDir);
  if (!(await samePath(root, appDir))) {
    await runSetupFrom(appDir);
    return true;
  }
  return false;
}

async function assertPreflight() {
  const failures = [];
  if (process.platform !== "darwin") {
    failures.push("macOS is required for the native desktop overlay.");
  }

  const major = Number(process.versions.node.split(".")[0]);
  if (major < 18) {
    failures.push(`Node.js 18 or newer is required. Current version: ${process.version}.`);
  }

  if (!(await hasPrebuiltOverlay()) && !(await commandExists("swiftc"))) {
    failures.push("Xcode command line tools are required because swiftc was not found.");
  }

  if (failures.length > 0) {
    throw new Error(`Setup cannot continue:\n- ${failures.join("\n- ")}`);
  }
}

async function main() {
  console.log("Setting up Claude Pet...");
  if (await installStableAppIfNeeded()) return;
  await assertPreflight();
  await ensureOverlayBinary();
  await run(process.execPath, ["scripts/install-claude-hook.js"]);

  console.log("");
  console.log("Claude Pet is ready.");
  console.log("Open a new Claude Code session and the pet will launch automatically.");
  console.log("To launch it now, run: claude-pet launch");
  console.log("To preview a notification, run: claude-pet demo permission");
}

main().catch(error => {
  console.error(error?.message || error);
  process.exit(1);
});
