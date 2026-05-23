import { mkdir, rmdir, stat } from "node:fs/promises";

export async function withFileLock(lockDir, fn, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  const retryMs = options.retryMs ?? 50;
  const staleMs = options.staleMs ?? 15000;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      await mkdir(lockDir, { recursive: false });
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const details = await stat(lockDir);
        if (Date.now() - details.mtimeMs > staleMs) await rmdir(lockDir);
      } catch {
        // If the lock disappeared between checks, retry immediately.
      }
      if (Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, retryMs));
    }
  }

  try {
    return await fn();
  } finally {
    try {
      await rmdir(lockDir);
    } catch {
      // Another cleanup path may already have removed it.
    }
  }
}
