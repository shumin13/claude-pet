#!/usr/bin/env node

import { labelForEvent, withSessionPrefix } from "../lib/session-labels.js";
import { eventsUrl } from "../lib/config.js";
import { eventType, notificationMessage, notificationTitle, shouldIgnoreEvent } from "../lib/events.js";
import { postJson, readStdinJson } from "../lib/runtime.js";

const endpoint = process.env.CLAUDE_PET_ENDPOINT || eventsUrl;

try {
  const event = await readStdinJson();
  if (!shouldIgnoreEvent(event)) {
    const label = await labelForEvent(event);
    const response = await postJson(endpoint, {
      ...event,
      type: eventType(event),
      title: notificationTitle(event),
      message: withSessionPrefix(notificationMessage(event), label),
      replay: false
    });

    if (!response.ok) process.exitCode = 1;
  }
} catch {
  process.exitCode = 1;
}
