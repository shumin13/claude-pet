#!/usr/bin/env node

import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { root } from "../lib/config.js";

const projectRoot = root;
const notifyHookPath = join(projectRoot, "hooks", "claude-pet-notify.js");
const clearHookPath = join(projectRoot, "hooks", "claude-pet-clear.js");
const stopHookPath = join(projectRoot, "hooks", "claude-pet-stop.js");
const sessionStartHookPath = join(projectRoot, "scripts", "launch-desktop-if-needed.js");
const sessionEndHookPath = join(projectRoot, "scripts", "close-desktop-if-last-session.js");
const settingsPath = join(homedir(), ".claude", "settings.json");
const notifyCommand = `node ${JSON.stringify(notifyHookPath)}`;
const clearCommand = `node ${JSON.stringify(clearHookPath)}`;
const stopCommand = `node ${JSON.stringify(stopHookPath)}`;
const sessionStartCommand = `node ${JSON.stringify(sessionStartHookPath)}`;
const sessionEndCommand = `node ${JSON.stringify(sessionEndHookPath)}`;

async function readSettings() {
  try {
    return JSON.parse(await readFile(settingsPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

function hasHook(hooks, command) {
  return hooks.some(hook => hook?.type === "command" && hook?.command === command);
}

function isStaleClaudePetHook(hook, scriptPath, command) {
  if (hook?.type !== "command" || typeof hook.command !== "string") return false;
  return hook.command !== command
    && hook.command.includes("claude-pet")
    && hook.command.includes(scriptPath);
}

function removeStaleHooks(settings, lifecycle, scriptPath, command) {
  for (const entry of settings.hooks[lifecycle] || []) {
    entry.hooks = (entry.hooks || []).filter(hook => !isStaleClaudePetHook(hook, scriptPath, command));
  }
}

function ensureHook(settings, lifecycle, scriptPath, command) {
  settings.hooks[lifecycle] ||= [];
  removeStaleHooks(settings, lifecycle, scriptPath, command);

  let entry = settings.hooks[lifecycle].find(item => !item.matcher);
  if (!entry) {
    entry = { hooks: [] };
    settings.hooks[lifecycle].push(entry);
  }
  entry.hooks ||= [];
  if (!hasHook(entry.hooks, command)) {
    entry.hooks.push({ type: "command", command });
  }
}

async function main() {
  const settings = await readSettings();
  settings.hooks ||= {};

  ensureHook(settings, "Notification", "hooks/claude-pet-notify.js", notifyCommand);
  ensureHook(settings, "PermissionRequest", "hooks/claude-pet-notify.js", notifyCommand);
  ensureHook(settings, "PostToolUse", "hooks/claude-pet-clear.js", clearCommand);
  ensureHook(settings, "Stop", "hooks/claude-pet-stop.js", stopCommand);
  ensureHook(settings, "SessionStart", "scripts/launch-desktop-if-needed.js", sessionStartCommand);
  ensureHook(settings, "SessionEnd", "scripts/close-desktop-if-last-session.js", sessionEndCommand);

  await mkdir(dirname(settingsPath), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    await copyFile(settingsPath, `${settingsPath}.before-claude-pet-${stamp}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const tempPath = `${settingsPath}.claude-pet-${stamp}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`);
  await rename(tempPath, settingsPath);
  console.log(`Installed Claude Code hooks in ${settingsPath}`);
  console.log(`  Notification: ${notifyCommand}`);
  console.log(`  PermissionRequest: ${notifyCommand}`);
  console.log(`  PostToolUse:  ${clearCommand}`);
  console.log(`  Stop:         ${stopCommand}`);
  console.log(`  SessionStart: ${sessionStartCommand}`);
  console.log(`  SessionEnd:   ${sessionEndCommand}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
