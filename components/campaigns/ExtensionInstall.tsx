"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface ExtensionStatus { available: boolean; bundledVersion?: string; installedPath?: string; installedVersion?: string }
/** One-click unpack of the bundled InstaVault extension to a stable folder, with the Chrome steps that follow. */
export function ExtensionInstall({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<ExtensionStatus>();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const refresh = () => fetch("/api/campaigns/extension", { cache: "no-store" }).then(r => r.json()).then(setStatus).catch(() => {});
  useEffect(() => { void refresh(); }, []);
  async function install() {
    setBusy(true); setError("");
    try { const r = await fetch("/api/campaigns/extension", { method: "POST" }); const data = await r.json(); if (!r.ok) throw new Error(data.error); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const outdated = !!status?.installedPath && status.bundledVersion !== status.installedVersion;
  return <div className={compact ? "space-y-2 text-xs" : "space-y-3 text-sm"}>
    {status?.installedPath ? <p className="text-muted-foreground">Extension folder: <code className="break-all">{status.installedPath}</code>{outdated ? ` · update available (${status.bundledVersion})` : ` · v${status.installedVersion}`}</p> : <p className="text-muted-foreground">Send Instagram Reels from your own browser session into UGC{"{"}Gen{"}"} as source clips.</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="flex flex-wrap items-center gap-2"><Button type="button" size="sm" variant={status?.installedPath && !outdated ? "outline" : "default"} disabled={busy || status?.available === false} onClick={() => void install()}>{status?.installedPath ? outdated ? "Update extension folder" : "Reveal extension folder" : "Get the browser extension"}</Button>{status?.available === false && <span className="text-muted-foreground">Not bundled with this build.</span>}</div>
    <ol className="list-decimal space-y-1 pl-5 text-muted-foreground"><li>In Chrome open <code>chrome://extensions</code>, turn on Developer mode, choose Load unpacked, and pick the folder above.</li><li>Browse Instagram as usual, open a Reel you may use, and choose “Send selected to UGC{"{"}Gen{"}"}” in the side panel.</li></ol>
  </div>;
}
