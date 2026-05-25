const ignoredTypes = new Set(["auth_success"]);

export function eventType(event = {}) {
  if (event.hook_event_name === "PermissionRequest") return "permission_prompt";
  return event.notification_type || event.type || "notification";
}

export function shouldIgnoreEvent(event = {}) {
  return ignoredTypes.has(eventType(event));
}

export function notificationTitle(event = {}) {
  if (event.hook_event_name === "PermissionRequest") return "Permission needed";
  return event.title;
}

export function notificationMessage(event = {}) {
  if (event.hook_event_name !== "PermissionRequest") return event.message;

  const tool = event.tool_name || "tool";
  const command = event.tool_input?.command;
  if (command) return `Claude wants to use ${tool}: ${command}`;
  return `Claude wants to use ${tool}.`;
}
