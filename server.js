import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { port, root } from "./lib/config.js";

const publicDir = join(root, "public");
const clients = new Set();
const genericBashPermission = "Claude needs your permission to use Bash";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

let lastEvent = {
  type: "ready",
  title: "Claude Pet is awake",
  message: "Waiting for Claude Code notifications.",
  createdAt: new Date().toISOString(),
  replay: true
};

let permissionPromptTimer = null;

function send(client, event) {
  client.write(`data: ${JSON.stringify(event)}\n\n`);
}

function broadcast(event) {
  lastEvent = { ...event, createdAt: new Date().toISOString() };
  for (const client of clients) send(client, lastEvent);

  clearTimeout(permissionPromptTimer);
  if (event.type === "permission_prompt") {
    // Auto-clear if the user denies (no PostToolUse fires in that case)
    permissionPromptTimer = setTimeout(() => broadcast(readyEvent()), 30_000);
  }
}

function readyEvent(message = "") {
  return {
    type: "ready",
    title: "Claude Pet is awake",
    message,
    createdAt: new Date().toISOString(),
    replay: true
  };
}

function normalizeEvent(incoming = {}) {
  const type = incoming.notification_type || incoming.type || "notification";
  return {
    type,
    title: incoming.title || "Claude Code",
    message: incoming.message || "Claude Code needs your attention.",
    replay: incoming.replay !== false,
    sessionLabel: incoming.sessionLabel || incoming.session_label
  };
}

function shouldIgnoreEvent(event) {
  if (event.type === "auth_success") return true;
  return event.type === "permission_prompt" && String(event.message || "").trim() === genericBashPermission;
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/events/stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "access-control-allow-origin": "*"
      });
      clients.add(res);
      send(res, lastEvent.replay === false ? readyEvent() : lastEvent);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (req.method === "POST" && (url.pathname === "/events" || url.pathname === "/claude-notification")) {
      const raw = await readBody(req);
      const incoming = raw ? JSON.parse(raw) : {};
      const event = normalizeEvent(incoming);
      if (shouldIgnoreEvent(event)) {
        json(res, 202, { ok: true, ignored: true, event: lastEvent });
        return;
      }
      broadcast(event);
      json(res, 202, { ok: true, event: lastEvent });
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, { ok: true, clients: clients.size, lastEvent });
      return;
    }

    if (req.method !== "GET") {
      json(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    const requested = url.pathname === "/" || url.pathname === "/claude-notification" || url.pathname === "/desktop.html"
      ? "/index.html"
      : url.pathname;
    const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(publicDir, safePath);
    const body = await readFile(filePath);
    res.writeHead(200, { "content-type": types[extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch (error) {
    if (error?.code === "ENOENT") {
      json(res, 404, { ok: false, error: "Not found" });
      return;
    }
    json(res, 500, { ok: false, error: error?.message || "Server error" });
  }
});

server.listen(Number(port), "127.0.0.1", () => {
  console.log(`Claude Pet listening at http://127.0.0.1:${port}`);
});
