import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

export function BrandIcon({ className }: { className?: string }) {
  return (
    <span
      aria-label={`${APP_NAME} logo`}
      role="img"
      className={cn(
        "relative inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-primary/30 bg-primary/10 font-mono text-[10px] font-bold tracking-[-0.12em] text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        className,
      )}
    >
      <span aria-hidden="true">{"{G}"}</span>
      <span aria-hidden="true" className="absolute inset-x-1 bottom-0 h-px bg-primary/50" />
    </span>
  );
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span
      aria-label={APP_NAME}
      className={cn(
        "inline-flex select-none items-baseline font-mono text-xl font-semibold leading-none tracking-[-0.08em] text-foreground",
        className,
      )}
    >
      <span aria-hidden="true">UGC</span>
      <span aria-hidden="true" className="font-bold text-primary">{"{Gen}"}</span>
    </span>
  );
}
