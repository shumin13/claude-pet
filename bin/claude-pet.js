#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const binDir = dirname(fileURLToPath(import.meta.url));
const root = join(binDir, "..");

const commands = new Map([
  ["setup", ["scripts/setup.js"]],
  ["launch", ["scripts/launch-desktop-if-needed.js"]],
  ["install-hooks", ["scripts/install-claude-hook.js"]],
  ["server", ["server.js"]]
]);

const aliases = new Map([
  ["start", "launch"],
  ["hooks", "install-hooks"]
]);

function printHelp() {
  console.log(`Claude Pet

Usage:
  claude-pet               Set up hooks and build the overlay
  claude-pet setup         Set up hooks and build the overlay
  claude-pet launch        Launch or preview the pet now
  claude-pet install-hooks Install or refresh Claude Code hooks
  claude-pet server        Run the local event server

Install:
  npm install -g @shumin13/claude-pet`);
}

function run(script) {
  const child = spawn(process.execPath, script, {
    cwd: root,
    stdio: ["ignore", "inherit", "inherit"]
  });
  child.on("exit", code => {
    process.exit(code || 0);
  });
  child.on("error", error => {
    console.error(error?.message || error);
    process.exit(1);
  });
}

const rawCommand = process.argv[2] || "setup";
const command = aliases.get(rawCommand) || rawCommand;

if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

const script = commands.get(command);
if (!script) {
  console.error(`Unknown command: ${rawCommand}`);
  console.error("");
  printHelp();
  process.exit(1);
}

run(script);
