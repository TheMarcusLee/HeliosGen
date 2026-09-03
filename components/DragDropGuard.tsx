"use client";

import { useEffect } from "react";

// Without this, a file dropped outside a handled drop zone makes the webview
// NAVIGATE to the file (the window "becomes" the image) — especially in the
// desktop build now that Tauri's drag-drop interception is disabled and HTML5
// drops reach the webview. Component-level onDrop handlers still run first on
// their own targets; this only kills the default navigate-on-drop everywhere.
export function DragDropGuard() {
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);
  return null;
}
