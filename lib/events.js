const ignoredTypes = new Set(["auth_success"]);

export function eventType(event = {}) {
  return event.notification_type || event.type || "notification";
}

export function shouldIgnoreEvent(event = {}) {
  return ignoredTypes.has(eventType(event));
}
