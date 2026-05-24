import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("..", import.meta.url));
export const port = process.env.CLAUDE_PET_PORT || process.env.PORT || "37421";
export const buildDir = process.env.CLAUDE_PET_BUILD_DIR || join(homedir(), "Library", "Application Support", "claude-pet");
export const swiftModuleCacheDir = join(buildDir, "module-cache");
export const logDir = join(buildDir, "logs");
export const overlayPath = join(buildDir, "robot-pet-overlay");
export const overlayPidFile = join(buildDir, "robot-pet-overlay.pid");
export const serverPidFile = join(buildDir, "claude-pet-server.pid");
export const sessionsFile = join(buildDir, "active-claude-sessions.json");
export const lifecycleLockDir = join(buildDir, "claude-pet-lifecycle.lock");
export const swiftSource = join(root, "macos", "RobotPetOverlay.swift");
export const prebuiltOverlayPath = join(root, "prebuilt", "macos", "robot-pet-overlay");
export const healthUrl = `http://127.0.0.1:${port}/health`;
export const eventsUrl = `http://127.0.0.1:${port}/events`;
export const desktopUrl = `http://127.0.0.1:${port}/desktop.html`;
