#!/usr/bin/env node

import { eventsUrl } from "../lib/config.js";
import { postJson } from "../lib/runtime.js";

const endpoint = process.env.CLAUDE_PET_ENDPOINT || eventsUrl;

try {
  await postJson(endpoint, {
    type: "ready",
    title: "Claude Pet is awake",
    message: "Waiting for Claude Code notifications.",
    replay: true
  });
} catch {
  process.exitCode = 1;
}
