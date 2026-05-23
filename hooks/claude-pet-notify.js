#!/usr/bin/env node

import { labelForEvent, withSessionPrefix } from "../lib/session-labels.js";
import { eventsUrl } from "../lib/config.js";
import { postJson, readStdinJson } from "../lib/runtime.js";

const endpoint = process.env.CLAUDE_PET_ENDPOINT || eventsUrl;
const ignoredTypes = new Set(["auth_success"]);
const genericBashPermission = "Claude needs your permission to use Bash";

try {
  const event = await readStdinJson();
  const type = event.notification_type || event.type;
  if (!ignoredTypes.has(type) && !(type === "permission_prompt" && String(event.message || "").trim() === genericBashPermission)) {
    const label = await labelForEvent(event);
    const response = await postJson(endpoint, {
      ...event,
      message: withSessionPrefix(event.message, label),
      replay: false
    });

    if (!response.ok) process.exitCode = 1;
  }
} catch {
  process.exitCode = 1;
}
