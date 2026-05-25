#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appName, appVersion, isExpectedHealth } from "../lib/app-identity.js";
import { root } from "../lib/config.js";
import { eventType, notificationMessage, notificationTitle, shouldIgnoreEvent } from "../lib/events.js";
import { hasSessionIdentity, pruneStaleSessions, recordSession, sessionKey } from "../lib/session-labels.js";

const port = "38421";
const buildDir = new URL("../.build", import.meta.url).pathname;
const moduleCacheDir = new URL("../.build/module-cache", import.meta.url).pathname;
const overlayPath = new URL("../.build/robot-pet-overlay", import.meta.url).pathname;
const env = {
  ...process.env,
  PORT: port,
  CLAUDE_PET_PORT: port,
  CLAUDE_PET_BUILD_DIR: buildDir
};

function spawnNode(args, options = {}) {
  return spawn(process.execPath, args, {
    cwd: new URL("..", import.meta.url).pathname,
    env,
    ...options
  });
}

function waitForExit(child, input) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.on("data", chunk => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", code => {
      if (code === 0) resolve();
      else reject(new Error(`process exited ${code}: ${stderr}`));
    });
    if (input) child.stdin.end(input);
  });
}

async function eventuallyHealth() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return response.json();
    } catch {
      // Keep polling.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("server did not become healthy");
}

async function health() {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(response.ok, true);
  return response.json();
}

async function readFirstSseEvent() {
  const response = await fetch(`http://127.0.0.1:${port}/events/stream`);
  assert.equal(response.ok, true);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("\n\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  await reader.cancel();
  const line = text.split("\n").find(item => item.startsWith("data: "));
  assert.ok(line, "expected an SSE data line");
  return JSON.parse(line.slice("data: ".length));
}

async function runHook(script, payload) {
  const child = spawnNode([script], { stdio: ["pipe", "ignore", "pipe"] });
  await waitForExit(child, JSON.stringify(payload));
}

async function runNodeCheck(path) {
  const child = spawnNode(["--check", path], { stdio: ["ignore", "ignore", "pipe"] });
  await waitForExit(child);
}

async function runScriptWithEnv(script, extraEnv) {
  const child = spawn(process.execPath, [script], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...env,
      ...extraEnv
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  await waitForExit(child);
}

async function assertStaticPreviewUsesRelativeAssets() {
  const page = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(page, /href="styles\.css"/);
  assert.match(page, /src="app\.js"/);
  assert.doesNotMatch(page, /href="\/styles\.css"|src="\/app\.js"/);
}

async function assertDesktopBuildExists() {
  const details = await stat(overlayPath);
  assert.equal(details.isFile(), true);
  assert.equal((details.mode & 0o111) !== 0, true);
}

function assertStaleSessionsPruned() {
  const now = Date.parse("2026-05-23T00:00:00.000Z");
  const sessions = pruneStaleSessions({
    old: {
      label: "old",
      lastSeenAt: "2026-05-19T00:00:00.000Z"
    },
    fresh: {
      label: "fresh",
      lastSeenAt: "2026-05-22T23:59:00.000Z"
    }
  }, now);
  assert.deepEqual(Object.keys(sessions), ["fresh"]);
}

function assertSessionFallbackKeysAreStable() {
  assert.equal(sessionKey({ session_id: "abc" }), "session:abc");
  assert.equal(sessionKey({ transcript_path: "/tmp/demo.jsonl" }), "transcript:/tmp/demo.jsonl");
  assert.equal(sessionKey({ cwd: "/tmp/project-a" }), "cwd:/tmp/project-a");
  assert.equal(sessionKey({}), "fallback:claude-session");
  assert.equal(hasSessionIdentity({}), false);
  assert.equal(hasSessionIdentity({ cwd: "/tmp/project-a" }), true);
}

function assertEventFiltersAreShared() {
  assert.equal(eventType({ notification_type: "permission_prompt" }), "permission_prompt");
  assert.equal(eventType({ hook_event_name: "PermissionRequest", tool_name: "Bash" }), "permission_prompt");
  assert.equal(notificationTitle({ hook_event_name: "PermissionRequest" }), "Permission needed");
  assert.equal(notificationMessage({ hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "npm test" } }), "Claude wants to use Bash: npm test");
  assert.equal(shouldIgnoreEvent({ notification_type: "auth_success" }), true);
  assert.equal(shouldIgnoreEvent({ notification_type: "permission_prompt", message: "Claude needs your permission to use Bash" }), false);
}

async function assertEmptyLaunchDoesNotRecordSession() {
  const recorded = await recordSession({});
  assert.equal(recorded, undefined);
}

async function assertInstallHooksPrunesStaleCommands() {
  const home = await mkdtemp(join(tmpdir(), "claude-pet-home-"));
  const settingsPath = join(home, ".claude", "settings.json");
  await mkdir(join(home, ".claude"), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify({
    hooks: {
      Notification: [{
        hooks: [
          { type: "command", command: "node \"/Users/s.huang.4/.Trash/claude-pet/hooks/claude-pet-notify.js\"" },
          { type: "command", command: "echo keep-me" }
        ]
      }],
      PermissionRequest: [{
        hooks: [
          { type: "command", command: "node \"/Users/s.huang.4/.Trash/claude-pet/hooks/claude-pet-notify.js\"" }
        ]
      }],
      SessionStart: [{
        hooks: [
          { type: "command", command: "node \"/Users/s.huang.4/.Trash/claude-pet/scripts/launch-desktop-if-needed.js\"" }
        ]
      }]
    }
  }, null, 2)}\n`);

  await runScriptWithEnv("scripts/install-claude-hook.js", { HOME: home });

  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  const commands = Object.values(settings.hooks)
    .flatMap(entries => entries.flatMap(entry => entry.hooks || []))
    .map(hook => hook.command);

  assert.equal(commands.some(command => command.includes(".Trash/claude-pet")), false);
  assert.equal(commands.includes("echo keep-me"), true);
  assert.equal(commands.includes(`node ${JSON.stringify(join(root, "hooks", "claude-pet-notify.js"))}`), true);
  assert.equal(commands.includes(`node ${JSON.stringify(join(root, "scripts", "launch-desktop-if-needed.js"))}`), true);
  assert.equal(settings.hooks.PermissionRequest[0].hooks.some(hook => hook.command === `node ${JSON.stringify(join(root, "hooks", "claude-pet-notify.js"))}`), true);
}

async function buildDesktopOverlay() {
  await mkdir(moduleCacheDir, { recursive: true });
  const child = spawn("swiftc", [
    "macos/RobotPetOverlay.swift",
    "-framework",
    "Cocoa",
    "-framework",
    "WebKit",
    "-o",
    overlayPath
  ], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...env,
      CLANG_MODULE_CACHE_PATH: moduleCacheDir
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  await waitForExit(child);
}

const server = spawnNode(["server.js"], { stdio: ["ignore", "ignore", "pipe"] });
let serverError = "";
server.stderr.on("data", chunk => {
  serverError += chunk;
});

try {
  await runNodeCheck("server.js");
  await runNodeCheck("public/app.js");
  await runNodeCheck("lib/app-identity.js");
  await runNodeCheck("lib/overlay-binary.js");
  await runNodeCheck("hooks/claude-pet-notify.js");
  await runNodeCheck("hooks/claude-pet-clear.js");
  await runNodeCheck("hooks/claude-pet-stop.js");
  await runNodeCheck("bin/claude-pet.js");
  await runNodeCheck("scripts/setup.js");
  await runNodeCheck("scripts/install-claude-hook.js");
  await runNodeCheck("scripts/launch-desktop-if-needed.js");
  await runNodeCheck("scripts/close-desktop-if-last-session.js");
  await assertStaticPreviewUsesRelativeAssets();
  assertStaleSessionsPruned();
  assertSessionFallbackKeysAreStable();
  assertEventFiltersAreShared();
  await assertEmptyLaunchDoesNotRecordSession();
  await assertInstallHooksPrunesStaleCommands();
  await buildDesktopOverlay();
  await assertDesktopBuildExists();

  await eventuallyHealth();

  let current = await health();
  assert.equal(current.lastEvent.type, "ready");
  assert.equal(current.app, appName);
  assert.equal(current.version, await appVersion());
  assert.equal(current.root, root);
  assert.equal(current.desktopPathOk, true);
  assert.equal(isExpectedHealth(current), true);
  assert.equal(isExpectedHealth({ ok: true, app: appName, root: "/tmp/claude-pet", desktopPathOk: true }), false);

  await runHook("hooks/claude-pet-notify.js", {
    notification_type: "auth_success",
    title: "Logged in",
    message: "Logged in successfully"
  });
  current = await health();
  assert.equal(current.lastEvent.type, "ready", "auth_success should be ignored");

  await runHook("hooks/claude-pet-notify.js", {
    notification_type: "permission_prompt",
    cwd: "/tmp/alpha-project",
    title: "Permission needed",
    message: "Claude needs your permission to use Bash"
  });
  current = await health();
  assert.equal(current.lastEvent.type, "permission_prompt", "generic Bash permission prompts should notify");
  assert.equal(current.lastEvent.replay, false);
  assert.match(current.lastEvent.message, /^\[alpha-project\] /);

  await runHook("hooks/claude-pet-notify.js", {
    notification_type: "permission_prompt",
    cwd: "/tmp/alpha-project",
    title: "Permission needed",
    message: "Claude wants to run a shell command."
  });
  current = await health();
  assert.equal(current.lastEvent.type, "permission_prompt");
  assert.equal(current.lastEvent.replay, false);
  assert.match(current.lastEvent.message, /^\[alpha-project\] /);

  await runHook("hooks/claude-pet-notify.js", {
    hook_event_name: "PermissionRequest",
    cwd: "/tmp/alpha-project",
    tool_name: "Bash",
    tool_input: {
      command: "npm test",
      description: "Run the test suite"
    }
  });
  current = await health();
  assert.equal(current.lastEvent.type, "permission_prompt");
  assert.equal(current.lastEvent.title, "Permission needed");
  assert.match(current.lastEvent.message, /^\[alpha-project\] Claude wants to use Bash: npm test/);

  const replay = await readFirstSseEvent();
  assert.equal(replay.type, "ready", "new clients should not replay stale permission events");

  await runHook("hooks/claude-pet-notify.js", {
    notification_type: "idle_prompt",
    cwd: "/tmp/alpha-project",
    title: "Still here",
    message: "Claude is waiting for your next instruction."
  });
  current = await health();
  assert.equal(current.lastEvent.type, "idle_prompt");
  assert.match(current.lastEvent.message, /^\[alpha-project\] /);

  await runHook("hooks/claude-pet-stop.js", {
    cwd: "/tmp/alpha-project"
  });
  current = await health();
  assert.equal(current.lastEvent.type, "job_done");
  assert.equal(current.lastEvent.replay, false);
  assert.match(current.lastEvent.message, /^\[alpha-project\] /);

  await runHook("hooks/claude-pet-clear.js", {});
  current = await health();
  assert.equal(current.lastEvent.type, "ready");
  assert.equal(current.lastEvent.replay, true);

  console.log("pet integration scenarios passed");
} finally {
  server.kill("SIGTERM");
}

server.on("exit", code => {
  if (code && code !== 143) {
    console.error(serverError);
  }
});
