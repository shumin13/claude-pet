#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import { pruneStaleSessions, sessionKey } from "../lib/session-labels.js";

const port = "38421";
const env = {
  ...process.env,
  PORT: port,
  CLAUDE_PET_PORT: port
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

async function assertStaticPreviewUsesRelativeAssets() {
  const desktop = await readFile(new URL("../public/desktop.html", import.meta.url), "utf8");
  assert.match(desktop, /href="desktop\.css"/);
  assert.match(desktop, /src="app\.js"/);
  assert.doesNotMatch(desktop, /href="\/desktop\.css"|src="\/app\.js"/);
}

async function assertDesktopBuildExists() {
  const output = new URL("../.build/robot-pet-overlay", import.meta.url);
  const details = await stat(output);
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
}

async function buildDesktopOverlay() {
  await mkdir(new URL("../.build/module-cache", import.meta.url), { recursive: true });
  const child = spawn("swiftc", [
    "macos/RobotPetOverlay.swift",
    "-framework",
    "Cocoa",
    "-framework",
    "WebKit",
    "-o",
    ".build/robot-pet-overlay"
  ], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...env,
      CLANG_MODULE_CACHE_PATH: ".build/module-cache"
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
  await runNodeCheck("hooks/claude-pet-notify.js");
  await runNodeCheck("hooks/claude-pet-clear.js");
  await runNodeCheck("hooks/claude-pet-stop.js");
  await runNodeCheck("scripts/launch-desktop-if-needed.js");
  await runNodeCheck("scripts/close-desktop-if-last-session.js");
  await assertStaticPreviewUsesRelativeAssets();
  assertStaleSessionsPruned();
  assertSessionFallbackKeysAreStable();
  await buildDesktopOverlay();
  await assertDesktopBuildExists();

  await eventuallyHealth();

  let current = await health();
  assert.equal(current.lastEvent.type, "ready");

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
  assert.equal(current.lastEvent.type, "ready", "generic Bash startup permission should be ignored");

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
