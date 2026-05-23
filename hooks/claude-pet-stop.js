#!/usr/bin/env node

import { labelForEvent, withSessionPrefix } from "../lib/session-labels.js";
import { eventsUrl } from "../lib/config.js";
import { postJson, readStdinJson } from "../lib/runtime.js";

const endpoint = process.env.CLAUDE_PET_ENDPOINT || eventsUrl;

try {
  const event = await readStdinJson();
  const label = await labelForEvent(event);
  const message = event.stop_hook_active
    ? "Claude finished and skipped recursive stop hooks."
    : "Claude finished the current response.";

  await postJson(endpoint, {
    type: "job_done",
    title: "Job done",
    message: withSessionPrefix(message, label),
    replay: false
  });
} catch {
  process.exitCode = 1;
}
