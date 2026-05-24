import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildDir, root, sessionsFile } from "./config.js";

export { buildDir, root, sessionsFile };

const staleSessionMs = 24 * 60 * 60 * 1000;

export function sessionKey(event = {}) {
  if (event.session_id) return `session:${event.session_id}`;
  if (event.transcript_path) return `transcript:${event.transcript_path}`;
  if (event.cwd) return `cwd:${event.cwd}`;
  return "fallback:claude-session";
}

export function hasSessionIdentity(event = {}) {
  return Boolean(event.session_id || event.transcript_path || event.cwd);
}

function basename(path) {
  return String(path || "")
    .split(/[\\/]/)
    .filter(Boolean)
    .pop();
}

export function sessionLabel(event = {}) {
  const cwdName = basename(event.cwd);
  if (cwdName) return cwdName;

  const transcriptName = basename(event.transcript_path);
  if (transcriptName) return transcriptName.replace(/\.jsonl$/, "");

  const id = event.session_id ? String(event.session_id).slice(0, 8) : "";
  return id ? `Session ${id}` : "Claude session";
}

export async function readSessions() {
  try {
    return JSON.parse(await readFile(sessionsFile, "utf8"));
  } catch {
    return {};
  }
}

export async function writeSessions(sessions) {
  await mkdir(dirname(sessionsFile), { recursive: true });
  await writeFile(sessionsFile, `${JSON.stringify(sessions, null, 2)}\n`);
}

export function pruneStaleSessions(sessions, now = Date.now()) {
  return Object.fromEntries(
    Object.entries(sessions).filter(([, session]) => {
      const seenAt = Date.parse(session?.lastSeenAt || session?.startedAt || "");
      return Number.isFinite(seenAt) && now - seenAt <= staleSessionMs;
    })
  );
}

export async function recordSession(event = {}) {
  if (!hasSessionIdentity(event)) return undefined;
  const key = sessionKey(event) || `${Date.now()}`;
  const sessions = pruneStaleSessions(await readSessions());
  sessions[key] = {
    cwd: event.cwd,
    label: sessionLabel(event),
    startedAt: sessions[key]?.startedAt || new Date().toISOString(),
    lastSeenAt: new Date().toISOString()
  };
  await writeSessions(sessions);
  return sessions[key];
}

export async function labelForEvent(event = {}) {
  const key = sessionKey(event);
  const sessions = await readSessions();
  if (key && sessions[key]?.label) {
    return sessions[key].label;
  }
  return sessionLabel(event);
}

export function withSessionPrefix(message, label) {
  const text = message || "Claude Code needs your attention.";
  return `[${label}] ${text}`;
}
