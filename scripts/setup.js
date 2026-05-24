#!/usr/bin/env node

import { ensureOverlayBinary, hasPrebuiltOverlay, commandExists, run } from "../lib/overlay-binary.js";

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
  await assertPreflight();
  await ensureOverlayBinary();
  await run(process.execPath, ["scripts/install-claude-hook.js"]);

  console.log("");
  console.log("Claude Pet is ready.");
  console.log("Open a new Claude Code session and the pet will launch automatically.");
  console.log("To launch it now, run: claude-pet launch");
}

main().catch(error => {
  console.error(error?.message || error);
  process.exit(1);
});
