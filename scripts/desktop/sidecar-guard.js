// Preloaded before the Next.js server (node -r) in the packaged desktop app.
//
// If the Tauri shell that spawned us dies without killing us (a crash, a
// force-quit, SIGKILL), macOS reparents this process to launchd (pid 1). Watch
// for that and exit, so we don't leave an orphaned server holding the port.
const parentAtStart = process.ppid;

setInterval(() => {
  if (process.ppid !== parentAtStart || process.ppid === 1) {
    console.error("[sidecar-guard] parent process gone — shutting down");
    process.exit(0);
  }
}, 2000).unref();
