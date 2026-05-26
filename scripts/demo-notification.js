#!/usr/bin/env node

import { spawn } from "node:child_process";
import { eventsUrl, healthUrl, root } from "../lib/config.js";
import { postJson } from "../lib/runtime.js";

const demos = {
  permission: [{
    type: "permission_prompt",
    title: "Permission needed",
    message: "[Demo] Claude wants to use Bash: npm test",
    replay: false
  }],
  idle: [{
    type: "idle_prompt",
    title: "Still here",
    message: "[Demo] Claude is waiting for your next instruction.",
    replay: false
  }],
  done: [{
    type: "job_done",
    title: "Job done",
    message: "[Demo] Claude finished the current response.",
    replay: false
  }],
  one: [{
    type: "notification",
    title: "Claude Code",
    message: "[Demo] One notification is waiting.",
    replay: false
  }],
  multi: [
    {
      type: "permission_prompt",
      title: "Permission needed",
      message: "[Website] Claude wants to run a command.",
      replay: false
    },
    {
      type: "idle_prompt",
      title: "Still here",
      message: "[Docs] Claude is waiting quietly.",
      replay: false
    },
    {
      type: "job_done",
      title: "Job done",
      message: "[Claude Pet] Claude finished the current response.",
      replay: false
    }
  ]
};

function launchPet() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/launch-desktop-if-needed.js"], {
      cwd: root,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", code => {
      if (code === 0) resolve();
      else reject(new Error(`launch exited with ${code}`));
    });
  });
}

async function waitForOverlayClient() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const health = await fetch(healthUrl).then(response => response.json());
      if (health.clients > 0) return true;
    } catch {
      // Keep polling while the server starts.
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return false;
}

async function main() {
  const name = process.argv[2] || "permission";
  const events = demos[name];
  if (!events) {
    throw new Error(`Unknown demo: ${name}. Try permission, idle, done, one, or multi.`);
  }

  await launchPet();
  const hasClient = await waitForOverlayClient();
  for (const event of events) {
    const response = await postJson(eventsUrl, {
      ...event,
      replay: !hasClient
    });
    if (!response.ok) throw new Error(`demo event failed with ${response.status}`);
  }
  console.log(`Sent Claude Pet ${name} demo.`);
}

main().catch(error => {
  console.error(error?.message || error);
  process.exit(1);
});
