import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { root } from "./config.js";

export const appName = "claude-pet";

let packageVersion;

export async function appVersion() {
  if (packageVersion) return packageVersion;
  try {
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    packageVersion = pkg.version || "0.0.0";
  } catch {
    packageVersion = "0.0.0";
  }
  return packageVersion;
}

export async function desktopPathOk() {
  try {
    await access(join(root, "public", "index.html"));
    return true;
  } catch {
    return false;
  }
}

export async function healthIdentity(extra = {}) {
  return {
    ok: true,
    app: appName,
    version: await appVersion(),
    root,
    desktopPathOk: await desktopPathOk(),
    ...extra
  };
}

export function isExpectedHealth(payload = {}) {
  return payload.ok === true
    && payload.app === appName
    && payload.root === root
    && payload.desktopPathOk === true;
}
