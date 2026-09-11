"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWorkflowStore, Toast } from "@/lib/store";
import { BrandIcon } from "@/components/Brand";

const COLORS: Record<Toast["type"], { bg: string; border: string; icon: string }> = {
  error:   { bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.3)",  icon: "rgba(239,68,68,0.9)"  },
  success: { bg: "rgba(74,222,128,0.10)", border: "rgba(74,222,128,0.3)", icon: "rgba(74,222,128,0.9)" },
  info:    { bg: "rgba(96,165,250,0.10)", border: "rgba(96,165,250,0.3)", icon: "rgba(96,165,250,0.9)" },
};

const ICONS: Record<Toast["type"], string> = {
  error:   "M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z",
  success: "M20 6 9 17l-5-5",
  info:    "M12 16v-4m0-4h.01M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z",
};

function DismissButton({ onDismiss }: { onDismiss: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onDismiss}
      style={{
        background: "none", border: "none", cursor: "pointer",
        color: "rgba(255,255,255,0.3)", padding: "0", flexShrink: 0, lineHeight: 1,
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  );
}

// macOS-style rich notification — used when toast has title + preview
function RichToastItem({ toast, onDismiss, onClick }: { toast: Toast; onDismiss: (e: React.MouseEvent) => void; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "14px 14px",
        borderRadius: "14px",
        background: "rgba(28,28,30,0.96)",
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: "0 12px 36px rgba(0,0,0,0.6)",
        backdropFilter: "blur(20px)",
        width: "340px",
        animation: "toastIn 220ms cubic-bezier(0.22,1,0.36,1) both",
        cursor: "pointer",
      }}
    >
      {/* Close button — top right */}
      <button
        onClick={onDismiss}
        style={{
          position: "absolute", top: "8px", right: "8px",
          width: "18px", height: "18px", borderRadius: "50%",
          background: "rgba(255,255,255,0.1)",
          border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "rgba(255,255,255,0.5)",
          transition: "background 120ms",
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.18)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.1)"; }}
      >
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>

      {/* App icon */}
      <div style={{
        width: "44px", height: "44px", borderRadius: "10px",
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.08)",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, overflow: "hidden",
      }}>
        <BrandIcon className="size-8" />
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px", paddingRight: "12px" }}>
        <span style={{
          fontSize: "13px", fontWeight: 600, color: "#fff",
          letterSpacing: "-0.01em", lineHeight: 1.3,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {toast.title}
        </span>
        <span style={{
          fontSize: "12px", color: "rgba(255,255,255,0.45)", lineHeight: 1.4,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {toast.preview}
        </span>
      </div>
    </div>
  );
}

// Simple toast — errors, info, generic success
function SimpleToastItem({ toast, onDismiss, onClick }: { toast: Toast; onDismiss: (e: React.MouseEvent) => void; onClick: () => void }) {
  const c = COLORS[toast.type];
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "12px 14px",
        borderRadius: "10px",
        background: c.bg,
        border: `1px solid ${c.border}`,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        backdropFilter: "blur(8px)",
        maxWidth: "360px",
        animation: "toastIn 200ms cubic-bezier(0.22,1,0.36,1) both",
        cursor: toast.href ? "pointer" : "default",
      }}
    >
      <svg
        width="16" height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke={c.icon}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0, marginTop: "1px" }}
      >
        <path d={ICONS[toast.type]} />
      </svg>
      <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.85)", lineHeight: 1.45, flex: 1 }}>
        {toast.message}
      </span>
      <DismissButton onDismiss={onDismiss} />
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useWorkflowStore((s) => s.removeToast);
  const router = useRouter();
  const isRich = !!(toast.title && toast.preview);
  const dismissDuration = isRich ? null : toast.href ? 8000 : 4000;

  useEffect(() => {
    if (dismissDuration === null) return;
    const t = setTimeout(() => removeToast(toast.id), dismissDuration);
    return () => clearTimeout(t);
  }, [toast.id, removeToast, dismissDuration]);

  function handleClick() {
    if (toast.href) {
      removeToast(toast.id);
      router.push(toast.href);
    }
  }

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    removeToast(toast.id);
  }

  if (toast.title && toast.preview) {
    return <RichToastItem toast={toast} onDismiss={handleDismiss} onClick={handleClick} />;
  }

  return <SimpleToastItem toast={toast} onDismiss={handleDismiss} onClick={handleClick} />;
}

export default function Toaster() {
  const toasts = useWorkflowStore((s) => s.toasts);

  return (
    <>
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(-10px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0)     scale(1); }
        }
      `}</style>
      <div
        style={{
          position: "fixed",
          top: "24px",
          right: "24px",
          zIndex: 99999,
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          pointerEvents: toasts.length ? "auto" : "none",
        }}
      >
        {toasts.map((t) => <ToastItem key={t.id} toast={t} />)}
      </div>
    </>
  );
}
