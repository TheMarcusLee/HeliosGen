"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useWorkflowStore } from "@/lib/store";
import { useChatSessionStore } from "@/lib/chatSessionStore";
import { useCampaignStore } from "@/lib/campaigns/client";
import { useFolderStore } from "@/lib/folderStore";
import {
  Workflow,
  Image as ImageIcon,
  Video as VideoIcon,
  Package,
  MessageSquare,
  Settings,
  MoreHorizontal,
  Bot,
  Pencil,
  Trash2,
  Folder,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  ChevronRight,
  ChevronDown,
  ScanFace,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import { BrandIcon, BrandWordmark } from "@/components/Brand";

// ── Deterministic pixel-art avatar ───────────────────────────────────────────
function fnv1a(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function PixelAvatar({ seed, size = 36 }: { seed: string; size?: number }) {
  const rand = lcg(fnv1a(seed || "guest"));
  const hue1 = Math.floor(rand() * 360);
  const hue2 = (hue1 + 100 + Math.floor(rand() * 120)) % 360;

  const palette = [
    `hsl(${hue1}, 22%, 10%)`,  // 0 = bg
    `hsl(${hue1}, 68%, 58%)`,  // 1 = primary
    `hsl(${hue2}, 62%, 48%)`,  // 2 = secondary
    `hsl(${hue1}, 18%, 5%)`,   // 3 = dark
  ];

  const ROWS = 8, COLS = 8, HALF = 4;
  const cells: number[][] = Array.from({ length: ROWS }, () => {
    const row = new Array(COLS).fill(0);
    for (let c = 0; c < HALF; c++) {
      const v = Math.floor(rand() * 4);
      row[c] = v;
      row[COLS - 1 - c] = v;
    }
    return row;
  });

  const px = size / COLS;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ display: "block", imageRendering: "pixelated" }}>
      <rect width={size} height={size} fill={palette[0]} />
      {cells.flatMap((row, r) =>
        row.map((v, c) =>
          v === 0 ? null : (
            <rect key={`${r}-${c}`} x={c * px} y={r * px} width={px} height={px} fill={palette[v]} />
          )
        )
      )}
    </svg>
  );
}

// ── Module-level drag tracker (avoids stale closures across re-renders) ──────
let _dragFolderId: string | null = null;

const FOLDER_COLORS: { color: string | null; label: string }[] = [
  { color: null, label: "Default" },
  { color: "#3B82F6", label: "Blue" },
  { color: "#2DD4BF", label: "Cyan" },
  { color: "#A855F7", label: "Purple" },
  { color: "#EC4899", label: "Pink" },
  { color: "#EF4444", label: "Red" },
  { color: "#F97316", label: "Orange" },
  { color: "#EAB308", label: "Yellow" },
  { color: "#22C55E", label: "Green" },
];

// ── Clean failed pending generations from localStorage + notify gallery page ──
function cleanFailedJobs(folderId: string | null) {
  try {
    const stored = localStorage.getItem("aiui-pending-gens");
    if (stored) {
      const parsed = JSON.parse(stored) as Array<{ error?: string; folderId?: string | null }>;
      const cleaned = parsed.filter(pg => {
        if (!pg.error) return true;
        if (folderId === null) return false;
        return pg.folderId !== folderId;
      });
      localStorage.setItem("aiui-pending-gens", JSON.stringify(cleaned));
    }
  } catch {}
  window.dispatchEvent(new CustomEvent("clean-failed-jobs", { detail: { folderId } }));
}

// ── FolderRow — defined at module level so React never remounts it on parent re-renders ──
interface FolderRowProps {
  folder: import("@/lib/folderStore").Folder;
  allFolders: import("@/lib/folderStore").Folder[];
  depth: number;
  expandedIds: Set<string>;
  selectedFolderId: string | null;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onColorChange: (id: string, color: string | null) => void;
  onMove: (id: string, newParentId: string | null, newOrderIndex: number) => void;
  creatingInFolderId: string | null;
  newFolderName: string;
  onNameChange: (v: string) => void;
  onNameKeyDown: (e: React.KeyboardEvent) => void;
  onNameBlur: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  getCount: (id: string) => number;
  generatingFolderIds: string[];
  unseenFolderIds: string[];
}

const FolderRow = React.memo(function FolderRow({
  folder, allFolders, depth, expandedIds, selectedFolderId,
  onToggleExpand, onSelect, onDelete, onRename, onColorChange, onMove,
  creatingInFolderId, newFolderName, onNameChange, onNameKeyDown, onNameBlur, inputRef,
  getCount, generatingFolderIds, unseenFolderIds,
}: FolderRowProps) {
  const [drop, setDrop] = React.useState<"before" | "after" | "inside" | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [menuPos, setMenuPos] = React.useState<{ x: number; y: number } | null>(null);
  const [isRenaming, setIsRenaming] = React.useState(false);
  const [renameValue, setRenameValue] = React.useState("");
  const menuRef = React.useRef<HTMLDivElement>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const renameInputRef = React.useRef<HTMLInputElement>(null);

  // Focus rename input once it mounts
  React.useEffect(() => {
    if (isRenaming) renameInputRef.current?.focus();
  }, [isRenaming]);

  // Close menu on click outside
  React.useEffect(() => {
    if (!menuOpen) return;
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [menuOpen]);

  function openMenu(e: React.MouseEvent) {
    e.stopPropagation();
    const rect = btnRef.current!.getBoundingClientRect();
    setMenuPos({ x: rect.right, y: rect.bottom + 4 });
    setMenuOpen(true);
  }

  function startRename() {
    setMenuOpen(false);
    setRenameValue(folder.name);
    setIsRenaming(true);
  }

  function confirmRename() {
    const name = renameValue.trim();
    if (name && name !== folder.name) onRename(folder.id, name);
    setIsRenaming(false);
  }

  const children = allFolders
    .filter(f => f.parentId === folder.id)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const hasChildren = children.length > 0;
  const isCreatingHere = creatingInFolderId === folder.id;
  const isExpanded = expandedIds.has(folder.id);
  const isActive = selectedFolderId === folder.id;

  function getPos(e: React.DragEvent<HTMLDivElement>): "before" | "after" | "inside" {
    const { top, height } = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientY - top) / height;
    return pct < 0.3 ? "before" : pct > 0.7 ? "after" : "inside";
  }

  const isGenerating = generatingFolderIds.includes(folder.id);
  const hasUnseen = unseenFolderIds.includes(folder.id);

  const sharedChildProps = {
    allFolders, expandedIds, selectedFolderId,
    onToggleExpand, onSelect, onDelete, onRename, onColorChange, onMove,
    creatingInFolderId, newFolderName, onNameChange, onNameKeyDown, onNameBlur, inputRef,
    getCount, generatingFolderIds, unseenFolderIds,
  };

  return (
    <React.Fragment>
      {drop === "before" && (
        <div style={{ height: 1, background: "#2DD4BF", margin: "1px 8px", borderRadius: 1, pointerEvents: "none" }} />
      )}
      <div
        draggable
        onDragStart={e => {
          _dragFolderId = folder.id;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", folder.id);
        }}
        onDragOver={e => {
          e.preventDefault();
          e.stopPropagation();
          if (_dragFolderId === folder.id) return;
          setDrop(getPos(e));
        }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null);
        }}
        onDrop={e => {
          e.preventDefault();
          e.stopPropagation();
          const dragged = _dragFolderId;
          setDrop(null);
          _dragFolderId = null;
          if (!dragged || dragged === folder.id) return;
          const pos = getPos(e);
          if (pos === "inside") {
            const sibs = allFolders.filter(f => f.parentId === folder.id).sort((a, b) => a.orderIndex - b.orderIndex);
            onMove(dragged, folder.id, sibs.length > 0 ? Math.max(...sibs.map(f => f.orderIndex)) + 1 : 0);
          } else {
            const sibs = allFolders.filter(f => f.parentId === folder.parentId && f.id !== dragged).sort((a, b) => a.orderIndex - b.orderIndex);
            const idx = sibs.findIndex(f => f.id === folder.id);
            onMove(dragged, folder.parentId, pos === "before" ? idx : idx + 1);
          }
        }}
        onDragEnd={() => { _dragFolderId = null; setDrop(null); }}
        onClick={() => !isRenaming && onSelect(folder.id)}
        className={cn(
          "group flex items-center gap-2 py-2 rounded-lg cursor-pointer transition-colors select-none",
          isActive ? "bg-white/[0.07]" : "hover:bg-white/[0.04]",
        )}
        style={{
          paddingLeft: `${8 + depth * 14}px`,
          paddingRight: "8px",
          outline: drop === "inside" ? "1px solid rgba(45,212,191,0.7)" : "none",
          outlineOffset: -1,
        }}
      >
        {/* Expand toggle */}
        <button
          onClick={e => { e.stopPropagation(); onToggleExpand(folder.id); }}
          style={{
            width: 10, height: 10, display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, opacity: (hasChildren || isCreatingHere) ? 0.45 : 0,
            pointerEvents: (hasChildren || isCreatingHere) ? "auto" : "none",
            background: "none", border: "none", padding: 0, cursor: "pointer",
          }}
        >
          {isExpanded ? <ChevronDown size={10} color="white" /> : <ChevronRight size={10} color="white" />}
        </button>

        {isActive
          ? <FolderOpen size={13} className="shrink-0" style={{ color: folder.color ?? "rgba(255,255,255,0.70)" }} />
          : <Folder size={13} className="shrink-0" style={{ color: folder.color ?? "rgba(255,255,255,0.35)" }} />}

        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); confirmRename(); }
              if (e.key === "Escape") { e.stopPropagation(); setIsRenaming(false); }
            }}
            onBlur={confirmRename}
            onClick={e => e.stopPropagation()}
            className="flex-1 bg-transparent text-[12px] text-white/90 outline-none border-b border-white/30 pb-0.5 min-w-0"
          />
        ) : (
          <span className={cn(
            "flex-1 text-[12px] truncate leading-tight",
            isActive ? "text-white/90" : "text-white/55",
          )}>
            {folder.name}
          </span>
        )}

        {!isRenaming && (() => { const c = getCount(folder.id); return c > 0 ? (
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
            {c}
          </span>
        ) : null; })()}
        {!isRenaming && isGenerating && (
          <svg width="10" height="10" viewBox="0 0 10 10" style={{ flexShrink: 0, animation: "spin 0.9s linear infinite" }}>
            <circle cx="5" cy="5" r="3.5" fill="none" stroke="rgba(45,212,191,0.2)" strokeWidth="1.5" />
            <path d="M5 1.5A3.5 3.5 0 0 1 8.5 5" fill="none" stroke="url(#fg-spin)" strokeWidth="1.5" strokeLinecap="round" />
            <defs>
              <linearGradient id="fg-spin" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#3B82F6" />
                <stop offset="100%" stopColor="#2DD4BF" />
              </linearGradient>
            </defs>
          </svg>
        )}
        {!isRenaming && !isGenerating && hasUnseen && (
          <span style={{
            width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
            background: "linear-gradient(135deg, #3B82F6 0%, #2DD4BF 100%)",
            boxShadow: "0 0 5px rgba(45,212,191,0.6)",
          }} />
        )}

        {/* ⋯ context menu button */}
        <button
          ref={btnRef}
          onClick={openMenu}
          className="w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 text-white/35 hover:text-white/70 hover:bg-white/[0.08] transition-all shrink-0"
        >
          <MoreHorizontal size={12} />
        </button>
      </div>

      {/* Context menu — fixed-position to escape overflow:auto clipping */}
      {menuOpen && menuPos && (
        <div
          ref={menuRef}
          onMouseDown={e => e.preventDefault()}
          style={{
            position: "fixed",
            left: menuPos.x,
            top: menuPos.y,
            transform: "translateX(-100%)",
            zIndex: 9999,
            background: "#16181f",
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: 8,
            padding: 4,
            minWidth: 130,
            boxShadow: "0 6px 24px rgba(0,0,0,0.6)",
          }}
        >
          {/* Color swatches */}
          <div style={{ padding: "6px 10px 6px", display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
            {FOLDER_COLORS.map(({ color, label }) => {
              const isSelected = color === null ? !folder.color : folder.color === color;
              return (
                <button
                  key={label}
                  title={label}
                  onClick={e => { e.stopPropagation(); setMenuOpen(false); onColorChange(folder.id, color); }}
                  style={{
                    width: 14, height: 14, borderRadius: "50%",
                    background: color ?? "rgba(255,255,255,0.18)",
                    border: isSelected ? "2px solid rgba(255,255,255,0.85)" : "2px solid transparent",
                    outline: isSelected ? "1px solid rgba(0,0,0,0.4)" : "none",
                    outlineOffset: -1,
                    cursor: "pointer",
                    padding: 0,
                    flexShrink: 0,
                    position: "relative",
                  }}
                >
                  {color === null && (
                    <svg width="10" height="10" viewBox="0 0 10 10" style={{ position: "absolute", inset: 0, margin: "auto", display: "block" }}>
                      <line x1="2" y1="8" x2="8" y2="2" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
          <div style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "2px 0 4px" }} />
          <button
            onClick={e => { e.stopPropagation(); startRename(); }}
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "6px 10px", borderRadius: 5, fontSize: 12,
              color: "rgba(255,255,255,0.72)", background: "none", border: "none", cursor: "pointer",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
            onMouseLeave={e => (e.currentTarget.style.background = "none")}
          >
            Rename
          </button>
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(false); cleanFailedJobs(folder.id); }}
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "6px 10px", borderRadius: 5, fontSize: 12,
              color: "rgba(255,255,255,0.72)", background: "none", border: "none", cursor: "pointer",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
            onMouseLeave={e => (e.currentTarget.style.background = "none")}
          >
            Clean failed jobs
          </button>
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete(folder.id); }}
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "6px 10px", borderRadius: 5, fontSize: 12,
              color: "rgba(248,113,113,0.85)", background: "none", border: "none", cursor: "pointer",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(248,113,113,0.08)")}
            onMouseLeave={e => (e.currentTarget.style.background = "none")}
          >
            Delete
          </button>
        </div>
      )}

      {drop === "after" && (
        <div style={{ height: 1, background: "#2DD4BF", margin: "1px 8px", borderRadius: 1, pointerEvents: "none" }} />
      )}
      {isExpanded && (hasChildren || isCreatingHere) && (
        <>
          {children.map(child => (
            <FolderRow key={child.id} folder={child} depth={depth + 1} {...sharedChildProps} />
          ))}
          {isCreatingHere && (
            <div
              className="flex items-center gap-2 py-1"
              style={{ paddingLeft: `${8 + (depth + 1) * 14}px`, paddingRight: "8px" }}
            >
              <Folder size={13} className="shrink-0 text-white/40" />
              <input
                ref={inputRef}
                value={newFolderName}
                onChange={e => onNameChange(e.target.value)}
                onKeyDown={onNameKeyDown}
                onBlur={onNameBlur}
                placeholder="Folder name…"
                className="flex-1 bg-transparent text-[12px] text-white/80 placeholder:text-white/25 outline-none border-b border-white/20 pb-0.5 min-w-0"
              />
            </div>
          )}
        </>
      )}
    </React.Fragment>
  );
});

// ── AllAssetsRow — "All assets" item with its own "..." menu ─────────────────
interface AllAssetsRowProps {
  isActive: boolean;
  count: number;
  onSelect: () => void;
  isGenerating?: boolean;
  hasUnseen?: boolean;
}

const AllAssetsRow = React.memo(function AllAssetsRow({ isActive, count, onSelect, isGenerating, hasUnseen }: AllAssetsRowProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [menuPos, setMenuPos] = React.useState<{ x: number; y: number } | null>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [menuOpen]);

  function openMenu(e: React.MouseEvent) {
    e.stopPropagation();
    const rect = btnRef.current!.getBoundingClientRect();
    setMenuPos({ x: rect.right, y: rect.bottom + 4 });
    setMenuOpen(true);
  }

  return (
    <React.Fragment>
      <div
        onClick={onSelect}
        className={cn(
          "group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors",
          isActive ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
        )}
      >
        <LayoutGrid size={13} className={cn("shrink-0", isActive ? "text-white/70" : "text-white/35")} />
        <span className={cn(
          "flex-1 text-[12px] truncate leading-tight",
          isActive ? "text-white/90" : "text-white/55"
        )}>
          All assets
        </span>
        {count > 0 && (
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
            {count}
          </span>
        )}
        {isGenerating && (
          <svg width="10" height="10" viewBox="0 0 10 10" style={{ flexShrink: 0, animation: "spin 0.9s linear infinite" }}>
            <circle cx="5" cy="5" r="3.5" fill="none" stroke="rgba(45,212,191,0.2)" strokeWidth="1.5" />
            <path d="M5 1.5A3.5 3.5 0 0 1 8.5 5" fill="none" stroke="url(#fg-spin-all)" strokeWidth="1.5" strokeLinecap="round" />
            <defs>
              <linearGradient id="fg-spin-all" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#3B82F6" />
                <stop offset="100%" stopColor="#2DD4BF" />
              </linearGradient>
            </defs>
          </svg>
        )}
        {!isGenerating && hasUnseen && (
          <span style={{
            width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
            background: "linear-gradient(135deg, #3B82F6 0%, #2DD4BF 100%)",
            boxShadow: "0 0 5px rgba(45,212,191,0.6)",
          }} />
        )}
        <button
          ref={btnRef}
          onClick={openMenu}
          className="w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 text-white/35 hover:text-white/70 hover:bg-white/[0.08] transition-all shrink-0"
        >
          <MoreHorizontal size={12} />
        </button>
      </div>

      {menuOpen && menuPos && (
        <div
          ref={menuRef}
          onMouseDown={e => e.preventDefault()}
          style={{
            position: "fixed",
            left: menuPos.x,
            top: menuPos.y,
            transform: "translateX(-100%)",
            zIndex: 9999,
            background: "#16181f",
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: 8,
            padding: 4,
            minWidth: 130,
            boxShadow: "0 6px 24px rgba(0,0,0,0.6)",
          }}
        >
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(false); cleanFailedJobs(null); }}
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "6px 10px", borderRadius: 5, fontSize: 12,
              color: "rgba(255,255,255,0.72)", background: "none", border: "none", cursor: "pointer",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
            onMouseLeave={e => (e.currentTarget.style.background = "none")}
          >
            Clean failed jobs
          </button>
        </div>
      )}
    </React.Fragment>
  );
});

function CreditIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}

// ── Sidebar component ─────────────────────────────────────────────────────────
export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") ?? "images";
  const activeChatId = searchParams.get("id");

  const [balance, setBalance] = React.useState<number | null>(null);

  const setSettingsOpen   = useWorkflowStore((s) => s.setSettingsOpen);
  const setKieKeySet      = useWorkflowStore((s) => s.setKieKeySet);
  const setAzureKeySet    = useWorkflowStore((s) => s.setAzureKeySet);

  React.useEffect(() => {
    fetch("/api/settings/kie-key")
      .then((r) => r.json())
      .then((d) => setKieKeySet(!!d.hasToken))
      .catch(() => setKieKeySet(null));
    fetch("/api/settings/azure-key")
      .then((r) => r.json())
      .then((d) => setAzureKeySet(!!d.hasToken))
      .catch(() => setAzureKeySet(null));
  }, [setKieKeySet, setAzureKeySet]);

  React.useEffect(() => {
    const fetchBalance = async () => {
      try {
        const res = await fetch("/api/credit");
        if (!res.ok) return;
        const data = await res.json();
        const val = typeof data?.data === "number"
          ? data.data
          : (data?.data?.balance ?? data?.balance ?? null);
        setBalance(val);
      } catch { /* ignore */ }
    };
    fetchBalance();
    const id = setInterval(fetchBalance, 60_000);
    window.addEventListener("credits-refresh", fetchBalance);
    return () => { clearInterval(id); window.removeEventListener("credits-refresh", fetchBalance); };
  }, []);

  const { sessions, deleteSession } = useChatSessionStore();
  const campaigns = useCampaignStore(s => s.campaigns);
  const [chatSearch, setChatSearch] = React.useState("");

  const {
    folders, selectedFolderId, itemFolderMap,
    createFolder, deleteFolder, selectFolder,
    updateFolder, moveFolder, folderItemCount,
    galleryImageCount, galleryVideoCount,
    loadFromServer, generatingFolderIds, unseenFolderIds,
    generatingAllAssets, unseenAllAssets,
  } = useFolderStore();
  const [creatingFolder, setCreatingFolder] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState("");
  const newFolderInputRef = React.useRef<HTMLInputElement>(null);
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    loadFromServer();
  }, [loadFromServer]);

  function startNewChat() {
    router.push("/chat");
  }

  function handleDeleteChat(id: string, isActive: boolean) {
    deleteSession(id);
    if (isActive) {
      const next = sessions.find(s => s.id !== id);
      router.push(next ? `/chat?id=${next.id}` : "/chat");
    }
  }

  function handleCreateFolder() {
    setCreatingFolder(true);
    setNewFolderName("");
    // Auto-expand parent folder so the inline input is visible
    if (selectedFolderId) {
      setExpandedIds(prev => new Set([...prev, selectedFolderId]));
    }
    setTimeout(() => newFolderInputRef.current?.focus(), 50);
  }

  function confirmCreateFolder() {
    const name = newFolderName.trim();
    if (name) {
      // If a folder is currently selected, create subfolder under it
      const parentId = selectedFolderId ?? null;
      createFolder(name, parentId);
    }
    setCreatingFolder(false);
    setNewFolderName("");
  }

  function handleFolderKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") confirmCreateFolder();
    if (e.key === "Escape") { setCreatingFolder(false); setNewFolderName(""); }
  }

  // ── Folder tree helpers ──────────────────────────────────────────────────────
  function buildTree(parentId: string | null): typeof folders {
    return folders
      .filter((f) => f.parentId === parentId)
      .sort((a, b) => a.orderIndex - b.orderIndex);
  }

  function handleToggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const displayName = "";
  const avatarSeed = "guest";

  const folderParam = selectedFolderId ? `&folder=${selectedFolderId}` : "";
  const navItems = [
    { label: "Chat", href: "/chat", icon: MessageSquare, active: pathname === "/chat" },
    { label: "Image", href: `/gallery?tab=images${folderParam}`, icon: ImageIcon, active: pathname === "/gallery" && tab === "images" },
    { label: "Video", href: `/gallery?tab=videos${folderParam}`, icon: VideoIcon, active: pathname === "/gallery" && tab === "videos" },
    { label: "Identities", href: "/identities", icon: ScanFace, active: pathname.startsWith("/identities") },
    { label: "Workflow", href: "/workflow", icon: Workflow, active: pathname === "/workflow" || (pathname.startsWith("/workflow/") && pathname !== "/workflow") },
    { label: "Assets", href: "#", icon: Package, active: false, disabled: true },
    { label: "Settings", href: "#", icon: Settings, active: false, onClick: (e: React.MouseEvent) => { e.preventDefault(); setSettingsOpen(true); } },
  ];

  const itemCls = (active: boolean, disabled?: boolean) => cn(
    "flex items-center gap-3.5 px-3 h-11 w-full rounded-xl transition-colors duration-150 text-left",
    "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:w-10 group-data-[collapsible=icon]:h-10 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:mx-auto",
    active ? "bg-white/[0.08] text-white" : "text-white/50 hover:text-white/80 hover:bg-white/[0.05]",
    disabled && "opacity-35 cursor-not-allowed pointer-events-none",
  );

  return (
    <Sidebar collapsible="icon" className="border-r-0 bg-[#0B0E14]" style={{ borderRight: "none" }}>

      {/* ── Header ── */}
      <SidebarHeader className="flex-row items-center justify-between px-4 pt-5 pb-2 gap-0">
        <div className="flex items-center gap-2.5 group-data-[collapsible=icon]:hidden">
          <BrandIcon />
          <BrandWordmark />
        </div>
        {/* Collapsed: logo fades to trigger on hover */}
        <div className="hidden group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:py-1">
          <div className="relative group/logo-area w-10 h-10 flex items-center justify-center">
            <div className="pointer-events-none transition-opacity duration-200 group-hover/logo-area:opacity-0">
              <BrandIcon />
            </div>
            <SidebarTrigger className="absolute inset-0 opacity-0 group-hover/logo-area:opacity-100 transition-opacity duration-200 text-white/50 hover:text-white hover:bg-white/[0.05] w-full h-full rounded-xl p-0 [&_svg]:size-4" />
          </div>
        </div>
        <SidebarTrigger className="group-data-[collapsible=icon]:hidden text-white/30 hover:text-white/70 hover:bg-white/[0.05] transition-colors p-1.5 rounded-lg -mr-1 [&_svg]:size-4" />
      </SidebarHeader>

      {/* ── Nav + Chat history ── */}
      <SidebarContent className="overflow-y-auto flex flex-col">
        {/* Nav items */}
        <div className="px-2 py-3 flex flex-col gap-0.5 shrink-0">
          {navItems.map((item) => {
            const content = (
              <>
                {React.createElement(item.icon, { size: 20, strokeWidth: 1.5, className: "shrink-0" })}
                <span className="text-[14px] font-medium group-data-[collapsible=icon]:hidden leading-none">
                  {item.label}
                </span>
              </>
            );
            if (item.disabled) return (
              <div key={item.label} className={itemCls(item.active, true)} title={item.label}>{content}</div>
            );
            if (!item.href || item.href === "#") return (
              <button key={item.label} className={itemCls(item.active)} onClick={item.onClick} title={item.label}>{content}</button>
            );
            return (
              <Link key={item.label} href={item.href} onClick={item.onClick} className={itemCls(item.active)} title={item.label}>{content}</Link>
            );
          })}
        </div>

        {/* Folders section — hidden in icon mode */}
        <div className="group-data-[collapsible=icon]:hidden flex flex-col shrink-0 px-2">
          <div className="border-t border-white/[0.06] mb-1" />

          {/* Section header */}
          <div className="flex items-center justify-between px-1 py-2 shrink-0">
            <span className="text-[10px] font-bold tracking-[0.08em] uppercase text-white/25">Folders</span>
            <button
              onClick={handleCreateFolder}
              title="New folder"
              className="w-6 h-6 rounded-lg flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
            >
              <FolderPlus size={12} />
            </button>
          </div>

          {/* Folder list — max 7 rows, scrollable */}
          <div className="flex flex-col gap-0.5" style={{ maxHeight: "calc(7 * 36px)", overflowY: "auto" }}>
            {/* All assets row */}
            <AllAssetsRow
              isActive={selectedFolderId === null}
              count={pathname === "/gallery" ? (tab === "videos" ? galleryVideoCount : galleryImageCount) : 0}
              onSelect={() => selectFolder(null)}
              isGenerating={generatingAllAssets}
              hasUnseen={unseenAllAssets}
            />

            {/* Recursive folder tree — root folders only, children rendered inside FolderRow */}
            {buildTree(null).map((folder) => (
              <FolderRow
                key={folder.id}
                folder={folder}
                allFolders={folders}
                depth={0}
                expandedIds={expandedIds}
                selectedFolderId={selectedFolderId}
                onToggleExpand={handleToggleExpand}
                onSelect={selectFolder}
                onDelete={deleteFolder}
                onRename={(id, name) => updateFolder(id, { name })}
                onColorChange={(id, color) => updateFolder(id, { color })}
                onMove={moveFolder}
                creatingInFolderId={creatingFolder ? selectedFolderId : null}
                newFolderName={newFolderName}
                onNameChange={setNewFolderName}
                onNameKeyDown={handleFolderKeyDown}
                onNameBlur={confirmCreateFolder}
                inputRef={newFolderInputRef}
                getCount={folderItemCount}
                generatingFolderIds={generatingFolderIds}
                unseenFolderIds={unseenFolderIds}
              />
            ))}

            {/* Root-level new folder input — shown at bottom when no folder is selected */}
            {creatingFolder && selectedFolderId === null && (
              <div className="flex items-center gap-2 px-2 py-1">
                <Folder size={13} className="shrink-0 text-white/40" />
                <input
                  ref={newFolderInputRef}
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={handleFolderKeyDown}
                  onBlur={confirmCreateFolder}
                  placeholder="Folder name…"
                  className="flex-1 bg-transparent text-[12px] text-white/80 placeholder:text-white/25 outline-none border-b border-white/20 pb-0.5 min-w-0"
                />
              </div>
            )}
          </div>
        </div>

        {/* Chat history — hidden in icon mode */}
        <div className="group-data-[collapsible=icon]:hidden flex flex-col flex-1 min-h-0 px-2 pb-2">
          <div className="border-t border-white/[0.06] mb-1" />

          {/* Section header */}
          <div className="flex items-center justify-between px-1 py-2 shrink-0">
            <span className="text-[10px] font-bold tracking-[0.08em] uppercase text-white/25">Campaigns & chats</span>
            <button
              onClick={startNewChat}
              title="New chat"
              className="w-6 h-6 rounded-lg flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
            >
              <Pencil size={12} />
            </button>
          </div>

          {/* Session list */}
          <input aria-label="Search chat history" placeholder="Search campaigns…" value={chatSearch} onChange={e => setChatSearch(e.target.value)} className="mx-1 mb-2 min-w-0 rounded-md border border-white/10 bg-transparent px-2 py-1.5 text-xs outline-none focus:border-white/30" />
          <div className="flex-1 overflow-y-auto flex flex-col gap-0.5 min-h-0">
            {campaigns.filter(c => c.title.toLowerCase().includes(chatSearch.toLowerCase())).map(c => <button key={c.id} onClick={() => router.push(`/chat?id=${c.id}`)} className={cn("flex items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition-colors", pathname === "/chat" && c.id === activeChatId ? "bg-white/[0.07] text-white/90" : "text-white/55 hover:bg-white/[0.04]")}><Bot size={13} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{c.title}</span><span className="text-[10px] text-white/30">{c.running ? "●" : c.assetCount || ""}</span></button>)}
            {sessions.length === 0 && campaigns.length === 0 ? (
              <p className="text-center text-[11px] text-white/20 px-2 py-4">No chats yet</p>
            ) : sessions.filter(s => s.title.toLowerCase().includes(chatSearch.toLowerCase())).map(sess => {
              const isActive = pathname === "/chat" && sess.id === activeChatId;
              return (
                <div
                  key={sess.id}
                  onClick={() => router.push(`/chat?id=${sess.id}`)}
                  className={cn(
                    "group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors",
                    isActive ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                  )}
                >
                  <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                    style={{ background: "rgba(45,212,191,0.08)", border: "1px solid rgba(45,212,191,0.12)" }}>
                    <Bot size={11} style={{ color: "rgba(45,212,191,0.7)" }} />
                  </div>
                  <span className={cn(
                    "flex-1 text-[12px] truncate leading-tight",
                    isActive ? "text-white/90" : "text-white/55"
                  )}>
                    {sess.title}
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteChat(sess.id, isActive); }}
                    className="w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400/70 hover:bg-red-400/10 transition-all shrink-0"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </SidebarContent>

      {/* ── Footer ── */}
      <SidebarFooter className="px-2 pb-4">
        <DropdownMenu>

          {/* Trigger: pixel avatar + name + credits */}
          <DropdownMenuTrigger
            render={
              <button
                title={displayName}
                className={cn(
                  "flex items-center gap-3 w-full px-2.5 py-2 rounded-xl hover:bg-white/[0.05] transition-colors cursor-pointer",
                  "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:w-10 group-data-[collapsible=icon]:h-10 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:mx-auto",
                )}
              >
                <Avatar className="size-9 rounded-xl shrink-0 after:rounded-xl after:border-white/15">
                  <AvatarFallback className="rounded-xl bg-transparent p-0 overflow-hidden">
                    <PixelAvatar seed={avatarSeed} size={36} />
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left group-data-[collapsible=icon]:hidden min-w-0">
                  {displayName && <div className="text-[13px] font-semibold text-white/90 truncate leading-tight">{displayName}</div>}
                  <div className="flex items-center gap-1 mt-0.5 text-[11px] text-white/40">
                    <CreditIcon />
                    <span>{balance !== null ? `${balance.toLocaleString()} Credits` : "0 Credits"}</span>
                  </div>
                </div>
                <MoreHorizontal size={15} className="text-white/30 shrink-0 group-data-[collapsible=icon]:hidden" />
              </button>
            }
          />

          {/* Menu popup */}
          <DropdownMenuContent
            side="top"
            align="start"
            sideOffset={8}
            className="!p-0 !rounded-2xl !bg-[#0f0f0f] !border-white/[0.12] !ring-0 !shadow-[0_8px_48px_rgba(0,0,0,0.85)] overflow-hidden !w-auto !min-w-[280px]"
          >
            {/* User header — non-interactive */}
            <div className="flex items-center gap-3.5 px-4 pt-4 pb-3.5">
              <Avatar className="size-14 rounded-xl shrink-0 after:rounded-xl after:border-white/15">
                <AvatarFallback className="rounded-xl bg-transparent p-0 overflow-hidden">
                  <PixelAvatar seed={avatarSeed} size={56} />
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                {displayName && <div className="text-[15px] font-semibold text-white truncate">{displayName}</div>}
                <div className="flex items-center gap-1.5 mt-0.5 text-[12px] text-white/40">
                  <CreditIcon size={13} />
                  <span>{balance !== null ? `${balance.toLocaleString()} Credits` : "0 Credits"}</span>
                </div>
              </div>
            </div>

            <DropdownMenuSeparator className="!bg-white/[0.07] !my-0 !mx-0" />

            {/* Purchase Kie Credits */}
            <DropdownMenuItem
              className="flex items-center justify-between rounded-none px-4 py-3 text-[14px] text-white/60 hover:text-white focus:text-white focus:bg-white/[0.06] cursor-pointer"
              onClick={() => window.open("https://kie.ai?ref=25abb3f2236cbff9780ab9c2f84479ec", "_blank")}
            >
              <span>Purchase Kie Credits</span>
              <CreditIcon size={15} />
            </DropdownMenuItem>

            <DropdownMenuSeparator className="!bg-white/[0.07] !my-0 !mx-0" />

            {/* Settings */}
            <DropdownMenuItem
              className="rounded-none px-4 pb-4 pt-3 text-[14px] text-white/60 hover:text-white focus:text-white focus:bg-white/[0.06] cursor-pointer"
              onClick={() => setSettingsOpen(true)}
            >
              Settings
            </DropdownMenuItem>
          </DropdownMenuContent>

        </DropdownMenu>
      </SidebarFooter>

    </Sidebar>
  );
}
