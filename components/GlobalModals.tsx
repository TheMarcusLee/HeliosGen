"use client";
import SettingsModal from "@/components/SettingsModal";
import Toaster from "@/components/Toaster";
import DesktopLinkHandler from "@/components/DesktopLinkHandler";
import { useWorkflowStore } from "@/lib/store";

export default function GlobalModals() {
  const settingsOpen    = useWorkflowStore((s) => s.settingsOpen);
  const setSettingsOpen = useWorkflowStore((s) => s.setSettingsOpen);

  return (
    <>
      <DesktopLinkHandler />
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <Toaster />
    </>
  );
}
