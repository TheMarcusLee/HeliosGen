"use client";
import AuthModal from "@/components/AuthModal";
import ResetPasswordModal from "@/components/ResetPasswordModal";
import SettingsModal from "@/components/SettingsModal";
import Toaster from "@/components/Toaster";
import { useWorkflowStore } from "@/lib/store";

// The desktop/guest build is fully local — no accounts, no auth UI.
const GUEST = process.env.NEXT_PUBLIC_GUEST_MODE === "true";

export default function GlobalModals() {
  const settingsOpen    = useWorkflowStore((s) => s.settingsOpen);
  const setSettingsOpen = useWorkflowStore((s) => s.setSettingsOpen);

  return (
    <>
      {!GUEST && <AuthModal />}
      {!GUEST && <ResetPasswordModal />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <Toaster />
    </>
  );
}
