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

function cssBlock(css, selectorPattern) {
  const match = css.match(new RegExp(`${selectorPattern}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `expected CSS block for ${selectorPattern}`);
  return match[1];
}

function scaledPx(block, property) {
  const zeroMatch = block.match(new RegExp(`${property}:\\s*0(?:;|\\n)`));
  if (zeroMatch) return 0;
  const match = block.match(new RegExp(`${property}:\\s*calc\\((-?[\\d.]+)px \\* var\\(--pet-scale\\)\\)`));
  assert.ok(match, `expected scaled ${property}`);
  return Number(match[1]);
}

async function assertDesktopControlLayout() {
  const nonNegotiables = [
    "notification close/minimize controls must not overlap the speech bubble",
    "ready close/minimize controls must not overlap the resize handle",
    "resize handle must sit on the pet corner, not below or away from the pet",
    "resize handle must only appear on hover/focus/active resize",
    "resizing must not send native resizeWindow messages",
    "transparent overlay area must be click-through outside visible hit regions"
  ];
  const css = await readFile(new URL("../public/desktop.css", import.meta.url), "utf8");
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const page = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const swift = await readFile(new URL("../macos/RobotPetOverlay.swift", import.meta.url), "utf8");
  const hitRegionSource = app.slice(
    app.indexOf("function visibleHitRegions()"),
    app.indexOf("function connectResize()")
  );
  const readySpeech = cssBlock(css, "\\.pet-shell\\[data-state=\"ready\"\\] \\.speech");
  const bubbleZone = cssBlock(css, "\\.bubble-zone");
  const readyBubbleZone = cssBlock(css, "\\.pet-shell\\[data-state=\"ready\"\\] \\.bubble-zone,[\\s\\S]*?\\.pet-shell\\[data-multi-project=\"true\"\\] \\.bubble-zone");
  const utility = cssBlock(css, "\\.utility-controls");
  const readyUtility = cssBlock(css, "\\.pet-shell\\[data-state=\"ready\"\\] \\.utility-controls,[\\s\\S]*?\\.pet-shell\\[data-multi-project=\"true\"\\] \\.utility-controls");
  const readyShell = cssBlock(css, "\\.pet-shell\\[data-state=\"ready\"\\]");
  const buttons = cssBlock(css, "\\.close-button,\\s*\\.collapse-button");
  const resize = cssBlock(css, "\\.resize-handle");
  const utilityReveal = cssBlock(css, "\\.pet-shell:hover \\.utility-controls,[\\s\\S]*?\\.utility-controls:focus-within");
  const resizeReveal = cssBlock(css, "\\.pet-shell:hover \\.resize-handle,[\\s\\S]*?\\.pet-shell\\[data-resizing=\"true\"\\] \\.resize-handle");

  assert.equal(nonNegotiables.length, 6);

  const readyShellHeight = scaledPx(readyShell, "min-height");
  const bubbleWidth = scaledPx(bubbleZone, "width");
  const readyControlsTop = scaledPx(readyUtility, "top");
  const readyControlsRight = scaledPx(readyUtility, "right");
  const buttonHeight = scaledPx(buttons, "height");
  const buttonWidth = scaledPx(buttons, "width");
  const resizeBottom = scaledPx(resize, "bottom");
  const resizeRight = scaledPx(resize, "right");
  const resizeHeight = scaledPx(resize, "height");
  const shellWidth = 222;
  const actionPillHeight = buttonHeight + 6;
  const actionPillWidth = buttonWidth * 2 + 9;
  const readyControlsBottom = readyControlsTop + actionPillHeight;
  const readyResizeTop = readyShellHeight - resizeBottom - resizeHeight;
  const resizeLeft = shellWidth - resizeRight - resizeHeight;
  const petRight = (shellWidth + 122) / 2;
  const actionRightInset = (shellWidth - bubbleWidth) / 2;

  assert.ok(
    readyControlsBottom + 8 <= readyResizeTop,
    nonNegotiables[1]
  );
  assert.ok(
    shellWidth - readyControlsRight - actionPillWidth < shellWidth - resizeRight,
    `${nonNegotiables[1]}: action pill should be separate from resize corner`
  );
  assert.equal(
    readyControlsRight,
    actionRightInset,
    "ready action pill right edge must align with the speech bubble right edge"
  );
  assert.equal(
    resizeRight,
    actionRightInset,
    "resize handle right edge must align with the close button right edge"
  );
  assert.equal(
    resizeBottom,
    0,
    "resize handle bottom edge must align with the Claude Pet base"
  );
  assert.ok(
    page.indexOf('<div class="bubble-zone">') < page.indexOf('<div class="speech" id="speech">')
      && page.indexOf('<div class="utility-controls"') < page.indexOf('<div class="speech" id="speech">'),
    nonNegotiables[0]
  );
  assert.ok(
    resizeLeft >= petRight + 8,
    nonNegotiables[2]
  );

  assert.match(readySpeech, /display:\s*none/);
  assert.ok(readyShellHeight < 180, "ready-state shell should not reserve hidden speech-bubble space");
  assert.match(bubbleZone, /display:\s*grid/);
  assert.match(bubbleZone, /row-gap:\s*calc\(4px \* var\(--pet-scale\)\)/);
  assert.match(bubbleZone, /margin-bottom:\s*calc\(4px \* var\(--pet-scale\)\)/);
  assert.match(readyBubbleZone, /height:\s*0/);
  assert.match(readyBubbleZone, /margin:\s*0/);
  assert.match(utility, /position:\s*relative/);
  assert.match(utility, /pointer-events:\s*none/);
  assert.match(utility, /border-radius:\s*999px/);
  assert.match(utility, /backdrop-filter:\s*blur\(14px\)/);
  assert.doesNotMatch(utility, /top:\s*calc/);
  assert.match(readyUtility, /top:\s*calc\(4px \* var\(--pet-scale\)\)/);
  assert.match(readyUtility, /right:\s*calc\(9px \* var\(--pet-scale\)\)/);
  assert.match(utilityReveal, /pointer-events:\s*auto/);
  assert.match(resize, /opacity:\s*0/);
  assert.match(resize, /pointer-events:\s*none/);
  assert.match(resize, /right:\s*calc\(9px \* var\(--pet-scale\)\)/);
  assert.match(resize, /bottom:\s*0/);
  assert.match(resizeReveal, /opacity:\s*1/);
  assert.match(resizeReveal, /pointer-events:\s*auto/);
  assert.doesNotMatch(css, /\.stage:hover \.resize-handle/);
  assert.match(swift, /defaultSize = NSSize\(width: 420, height: 520\)/);
  assert.match(swift, /x: currentFrame\.maxX - nextSize\.width/);
  assert.match(swift, /private var hitRegions: \[NSRect\] = \[\]/);
  assert.match(swift, /case "hitRegions"/);
  assert.match(swift, /NSEvent\.addGlobalMonitorForEvents/);
  assert.match(swift, /window\.ignoresMouseEvents = !hitRegions\.contains/);
  assert.match(swift, /window\.ignoresMouseEvents = true\s+return/);

  assert.doesNotMatch(app, /scheduleDesktopWindowSizeSync/);
  assert.doesNotMatch(app, /syncDesktopWindowSize/);
  assert.doesNotMatch(app, /type:\s*"resizeWindow"/, nonNegotiables[4]);
  assert.match(app, /resizingPet = true;[\s\S]*?scheduleDesktopHitRegionSync\(\)/);
  assert.match(app, /resizingPet = false;[\s\S]*?setScale\(currentScale\);[\s\S]*?scheduleDesktopHitRegionSync\(\)/);
  assert.match(app, /let hitRegionFrame = 0/);
  assert.match(app, /function visibleHitRegions\(\)/);
  assert.match(app, /type:\s*"hitRegions"/);
  assert.match(app, /viewportHeight:\s*window\.innerHeight/);
  assert.match(app, /document\.querySelector\("\.pet-wrap"\)/);
  assert.match(app, /document\.querySelector\("\.utility-controls"\)/);
  assert.match(app, /\.\.\.document\.querySelectorAll\("\.project-bubble"\)/);
  assert.match(app, /style\.pointerEvents === "none"/);
  assert.doesNotMatch(hitRegionSource, /querySelector\("\.stage"\)/);
  assert.match(app, /window\.addEventListener\("load", scheduleDesktopHitRegionSync\)/);
  assert.match(app, /document\.addEventListener\("pointermove", scheduleDesktopHitRegionSync\)/);
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
          { type: "command", command: "node \"/tmp/.Trash/claude-pet/hooks/claude-pet-notify.js\"" },
          { type: "command", command: "echo keep-me" }
        ]
      }],
      PermissionRequest: [{
        hooks: [
          { type: "command", command: "node \"/tmp/.Trash/claude-pet/hooks/claude-pet-notify.js\"" }
        ]
      }],
      SessionStart: [{
        hooks: [
          { type: "command", command: "node \"/tmp/.Trash/claude-pet/scripts/launch-desktop-if-needed.js\"" }
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
  await runNodeCheck("scripts/demo-notification.js");
  await runNodeCheck("scripts/install-claude-hook.js");
  await runNodeCheck("scripts/launch-desktop-if-needed.js");
  await runNodeCheck("scripts/close-desktop-if-last-session.js");
  await assertStaticPreviewUsesRelativeAssets();
  await assertDesktopControlLayout();
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
