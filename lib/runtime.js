import { readFile, unlink } from "node:fs/promises";

export async function readStdinJson() {
  if (process.stdin.isTTY) return {};

  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  try {
    return input.trim() ? JSON.parse(input) : {};
  } catch {
    return {};
  }
}

export async function postJson(endpoint, payload) {
  return fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function readPid(path) {
  try {
    const pid = Number((await readFile(path, "utf8")).trim());
    return pid || undefined;
  } catch {
    return undefined;
  }
}

export function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function removeFile(path) {
  try {
    await unlink(path);
  } catch {
    // Already gone.
  }
}
