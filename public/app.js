const shell = document.querySelector(".pet-shell");
const speech = document.querySelector("#speech");
const eventType = document.querySelector("#eventType");
const eventTitle = document.querySelector("#eventTitle");
const eventMessage = document.querySelector("#eventMessage");
const collapsedBadge = document.querySelector("#collapsedBadge");
const collapseButton = document.querySelector(".collapse-button");
const resizeHandle = document.querySelector(".resize-handle");
const projectTray = document.querySelector("#projectTray");

document.documentElement.dataset.mode = window.location.pathname.endsWith("/desktop.html")
  ? "desktop"
  : "preview";

const minScale = 0.86;
const maxScale = 1.58;
const defaultScale = 1;
const duplicateWindowMs = 4000;
const projectPrefixPattern = /^\[([^\]]+)\]/;
const projectMessagePrefixPattern = /^\[[^\]]+\]\s*/;
const eventPriority = {
  idle_prompt: 1,
  job_done: 2,
  permission_prompt: 3
};
const recentEvents = new Map();
let currentEvent = null;
let queue = [];
let collapsed = false;
let currentScale = defaultScale;

const copy = {
  permission_prompt: {
    type: "permission_prompt",
    label: "Permission",
    title: "Claude needs a nod",
    message: "A tool or command is waiting for your approval."
  },
  idle_prompt: {
    type: "idle_prompt",
    label: "Idle",
    title: "Claude Pet is peeking",
    message: "Claude has been waiting quietly for your next move."
  },
  job_done: {
    type: "job_done",
    label: "Done",
    title: "Job done",
    message: "Claude finished the current response."
  },
  auth_success: {
    type: "auth_success",
    label: "Success",
    title: "Permission granted",
    message: "Claude can continue now."
  },
  elicitation_dialog: {
    type: "elicitation_dialog",
    label: "Input",
    title: "Claude has a question",
    message: "A response is needed before work can continue."
  },
  elicitation_complete: {
    type: "elicitation_complete",
    label: "Done",
    title: "Answer received",
    message: "Claude has what it needs."
  },
  elicitation_response: {
    type: "elicitation_response",
    label: "Reply",
    title: "Message sent",
    message: "Your response reached Claude."
  },
  ready: {
    type: "ready",
    label: "Ready",
    title: "Claude Pet is awake",
    message: ""
  },
  notification: {
    type: "notification",
    label: "Notice",
    title: "Claude Code",
    message: "Claude Code needs your attention."
  }
};

function humanize(type) {
  return String(type || "notification").replaceAll("_", " ");
}

function priority(event) {
  return eventPriority[event.type] ?? 2;
}

function normalizeEvent(event = {}) {
  const type = event.type || event.notification_type || "notification";
  const fallback = copy[type] || copy.notification;
  return {
    type,
    label: fallback.label || humanize(type),
    title: event.title || fallback.title,
    message: event.message || fallback.message,
    createdAt: event.createdAt || new Date().toISOString()
  };
}

function projectLabel(event = {}) {
  return String(event.message || "").match(projectPrefixPattern)?.[1] || "Claude";
}

function messageWithoutProject(event = {}) {
  return String(event.message || "").replace(projectMessagePrefixPattern, "");
}

function notificationItems() {
  return [currentEvent, ...queue].filter(item => item && item.type !== "ready");
}

function pendingCount() {
  return notificationItems().length;
}

function duplicateKey(event) {
  const session = String(event.message || "").match(projectPrefixPattern)?.[1] || "";
  return `${event.type}:${session}`;
}

function isDuplicate(event) {
  const now = Date.now();
  const key = duplicateKey(event);
  for (const [seenKey, seenAt] of recentEvents) {
    if (now - seenAt > duplicateWindowMs) recentEvents.delete(seenKey);
  }
  if (recentEvents.has(key) && now - recentEvents.get(key) < duplicateWindowMs) return true;
  recentEvents.set(key, now);
  return false;
}

function render(event = currentEvent) {
  const item = normalizeEvent(event || copy.ready);
  const pending = pendingCount();
  const groups = projectGroups();
  shell.dataset.state = item.type;
  shell.dataset.collapsed = String(collapsed && item.type !== "ready");
  shell.dataset.hasQueue = String(pending > 1);
  shell.dataset.multiProject = String(!collapsed && groups.length > 1);
  eventType.textContent = item.label;
  eventTitle.textContent = item.title;
  eventMessage.textContent = item.message;

  if (collapsedBadge) {
    collapsedBadge.textContent = String(Math.max(1, pending));
    collapsedBadge.hidden = !(collapsed && pending > 0);
  }
  renderProjectTray(groups);

  speech?.classList.remove("flash");
  requestAnimationFrame(() => speech?.classList.add("flash"));
}

function renderProjectTray(groups = projectGroups()) {
  if (!projectTray) return;
  projectTray.replaceChildren();
  for (const group of groups) {
    const bubble = document.createElement("button");
    bubble.className = "project-bubble";
    bubble.type = "button";
    bubble.dataset.project = group.label;
    bubble.dataset.urgent = String(group.urgent);
    bubble.title = `Show ${group.label}`;

    const head = document.createElement("div");
    head.className = "project-bubble-head";

    const label = document.createElement("span");
    label.className = "project-bubble-label";
    label.textContent = group.label;
    head.append(label);

    if (group.count > 1) {
      const count = document.createElement("span");
      count.className = "project-bubble-count";
      count.textContent = String(group.count);
      head.append(count);
    }

    const message = document.createElement("p");
    message.className = "project-bubble-message";
    message.textContent = messageWithoutProject(group.event);

    bubble.append(head, message);
    projectTray.append(bubble);
  }
}

function projectGroups() {
  const groups = new Map();
  for (const event of notificationItems()) {
    const label = projectLabel(event);
    const group = groups.get(label) || {
      label,
      count: 0,
      event,
      urgent: false,
      rank: priority(event)
    };
    group.count += 1;
    group.urgent ||= event.type === "permission_prompt";
    if (priority(event) > group.rank) {
      group.event = event;
      group.rank = priority(event);
    }
    groups.set(label, group);
  }
  return [...groups.values()].sort((a, b) => b.rank - a.rank);
}

function selectProject(label) {
  const items = notificationItems();
  const selected = items.find(event => projectLabel(event) === label);
  if (!selected) return;
  currentEvent = selected;
  queue = items.filter(event => event !== selected);
  expandNotifications();
  render();
}

function popNext() {
  queue.sort((a, b) => priority(b) - priority(a));
  currentEvent = queue.shift() || normalizeEvent(copy.ready);
  expandNotifications();
  render();
}

function showEvent(event) {
  currentEvent = event;
  expandNotifications();
  render();
}

function overrideEvent(rawEvent) {
  currentEvent = normalizeEvent(rawEvent);
  queue = [];
  expandNotifications();
  render();
}

function expandNotifications() {
  collapsed = false;
}

function applyEvent(rawEvent) {
  const event = normalizeEvent(rawEvent);
  if (event.type === "ready") {
    if (queue.length > 0) popNext();
    else showEvent(event);
    return;
  }

  if (isDuplicate(event)) return;

  if (!currentEvent || currentEvent.type === "ready") {
    showEvent(event);
    return;
  }

  if (priority(event) > priority(currentEvent)) {
    queue.push(currentEvent);
    currentEvent = event;
    expandNotifications();
  } else {
    queue.push(event);
  }
  render();
}

function connectStream() {
  if (window.location.protocol === "file:" || new URLSearchParams(window.location.search).has("demo")) {
    applyDemoEventsFromUrl();
    return;
  }

  const source = new EventSource("/events/stream");
  source.onmessage = message => {
    shell.dataset.offline = "false";
    try {
      applyEvent(JSON.parse(message.data));
    } catch {
      applyEvent(copy.notification);
    }
  };
  source.onerror = () => {
    shell.dataset.offline = "true";
  };
}

function applyDemoEventsFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const demo = params.get("demo") || "ready";
  const demoEvents = {
    ready: [copy.ready],
    permission: [{
      type: "permission_prompt",
      title: "Claude needs a nod",
      message: "[Website] Claude wants to run a command."
    }],
    idle: [{
      type: "idle_prompt",
      title: "Claude Pet is peeking",
      message: "[Docs] Claude is waiting for your next instruction."
    }],
    done: [{
      type: "job_done",
      title: "Job done",
      message: "[Claude Pet] Claude finished the current response."
    }],
    one: [{
      type: "notification",
      title: "Claude Code",
      message: "[Claude Pet] One notification is waiting."
    }],
    multi: [
      {
        type: "permission_prompt",
        title: "Permission needed",
        message: "[Website] Claude wants to run a command."
      },
      {
        type: "idle_prompt",
        title: "Still here",
        message: "[Docs] Claude is waiting quietly."
      },
      {
        type: "job_done",
        title: "Job done",
        message: "[Claude Pet] Claude finished the current response."
      }
    ]
  };

  for (const event of demoEvents[demo] || demoEvents.ready) applyEvent(event);
  if (params.get("collapsed") === "true") {
    collapsed = true;
    render();
  }
}

function clampScale(scale) {
  return Math.min(maxScale, Math.max(minScale, scale));
}

function sizeName(scale) {
  if (scale < 1.08) return "small";
  if (scale < 1.34) return "medium";
  return "large";
}

function setScale(scale, persist = true) {
  currentScale = clampScale(scale);
  document.documentElement.style.setProperty("--pet-scale", String(currentScale));
  shell.dataset.size = sizeName(currentScale);
  try {
    if (persist) localStorage.setItem("claude-pet-scale", String(currentScale));
  } catch {
    // Static previews can run without storage.
  }
}

for (const button of document.querySelectorAll("[data-demo]")) {
  button.addEventListener("click", () => {
    const type = button.dataset.demo;
    overrideEvent({ type, ...copy[type] });
  });
}

projectTray?.addEventListener("click", event => {
  const bubble = event.target.closest?.("[data-project]");
  if (!bubble) return;
  event.stopPropagation();
  selectProject(bubble.dataset.project);
});

collapseButton?.addEventListener("click", event => {
  event.stopPropagation();
  if (!currentEvent || currentEvent.type === "ready") return;
  collapsed = true;
  render();
});

collapsedBadge?.addEventListener("click", event => {
  event.stopPropagation();
  collapsed = false;
  render();
});

shell?.addEventListener("click", () => {
  if (collapsed) {
    collapsed = false;
    render();
  }
});

try {
  const savedScale = Number(localStorage.getItem("claude-pet-scale"));
  setScale(Number.isFinite(savedScale) ? savedScale : defaultScale, false);
} catch {
  setScale(defaultScale, false);
}

const previewScale = Number(new URLSearchParams(window.location.search).get("scale"));
if (Number.isFinite(previewScale) && previewScale > 0) setScale(previewScale, false);

if (new URLSearchParams(window.location.search).get("snapshot") === "true") {
  shell.dataset.snapshot = "true";
}

if (new URLSearchParams(window.location.search).get("demoMotion") === "true") {
  shell.dataset.demoMotion = "true";
}

connectStream();

function connectResize() {
  let resizing = false;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartScale = currentScale;
  let resizeFrame = 0;

  const applyResize = event => {
    const delta = Math.max(event.clientX - resizeStartX, event.clientY - resizeStartY);
    const nextScale = resizeStartScale + delta / 180;
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      setScale(nextScale, false);
    });
  };

  resizeHandle?.addEventListener("pointerdown", event => {
    resizing = true;
    resizeStartX = event.clientX;
    resizeStartY = event.clientY;
    resizeStartScale = currentScale;
    shell.dataset.resizing = "true";
    resizeHandle.setPointerCapture?.(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
  });

  resizeHandle?.addEventListener("pointermove", event => {
    if (!resizing) return;
    applyResize(event);
    event.stopPropagation();
    event.preventDefault();
  });

  document.addEventListener("pointermove", event => {
    if (!resizing) return;
    applyResize(event);
    event.preventDefault();
  });

  const endResize = event => {
    if (!resizing) return;
    resizing = false;
    shell.dataset.resizing = "false";
    resizeHandle.releasePointerCapture?.(event.pointerId);
    setScale(currentScale);
    event.stopPropagation();
  };

  resizeHandle?.addEventListener("pointerup", endResize);
  resizeHandle?.addEventListener("pointercancel", endResize);
  document.addEventListener("pointerup", endResize);
  document.addEventListener("pointercancel", endResize);
}

function connectDesktopDrag() {
  const bridge = window.webkit?.messageHandlers?.petDrag;
  if (!bridge) return;
  const closeButton = document.querySelector(".close-button");

  let dragging = false;

  const start = event => {
    if (event.target.closest?.("button")) return;
    dragging = true;
    bridge.postMessage({ type: "start" });
    event.preventDefault();
  };
  const move = event => {
    if (!dragging) return;
    bridge.postMessage({ type: "move" });
    event.preventDefault();
  };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    bridge.postMessage({ type: "end" });
  };

  document.addEventListener("pointerdown", start);
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);
  closeButton?.addEventListener("click", event => {
    event.stopPropagation();
    bridge.postMessage({ type: "close" });
  });
}

connectResize();
connectDesktopDrag();
