#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const binDir = dirname(fileURLToPath(import.meta.url));
const root = join(binDir, "..");
const defaultAppDir = join(homedir(), "Library", "Application Support", "claude-pet", "app");

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
  claude-pet               Set up hooks and install the overlay
  claude-pet setup         Set up hooks and install the overlay
  claude-pet --app-dir DIR Install stable app files in DIR during setup
  claude-pet launch        Launch or preview the pet now
  claude-pet install-hooks Install or refresh Claude Code hooks
  claude-pet server        Run the local event server

Install:
  npm install -g @shumin13/claude-pet`);
}

function run(script, args = []) {
  const scriptRoot = script[0].startsWith(defaultAppDir) ? defaultAppDir : root;
  const child = spawn(process.execPath, [...script, ...args], {
    cwd: scriptRoot,
    stdio: "inherit"
  });
  child.on("exit", code => {
    process.exit(code || 0);
  });
  child.on("error", error => {
    console.error(error?.message || error);
    process.exit(1);
  });
}

function commandScript(command) {
  const script = commands.get(command);
  if (!script || command === "setup") return script;

  const stableScript = join(defaultAppDir, script[0]);
  const marker = join(defaultAppDir, ".claude-pet-app");
  if (existsSync(marker) && existsSync(stableScript)) {
    return [stableScript];
  }

  return script;
}

const rawCommand = process.argv[2] || "setup";
const commandArgs = process.argv.slice(3);
const command = aliases.get(rawCommand) || rawCommand;

if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

const script = rawCommand.startsWith("-") ? commands.get("setup") : commandScript(command);
if (!script) {
  console.error(`Unknown command: ${rawCommand}`);
  console.error("");
  printHelp();
  process.exit(1);
}

run(script, rawCommand.startsWith("-") ? process.argv.slice(2) : commandArgs);
