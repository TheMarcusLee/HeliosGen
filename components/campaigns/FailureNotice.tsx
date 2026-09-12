import { cn } from "@/lib/utils";

/** A failed step's one-line error, with the provider diagnostic behind a "More info" toggle. */
export function FailureNotice({ error, detail, className, tone = "error" }: { error: string; detail?: string; className?: string; tone?: "error" | "muted" }) {
  return <div className={cn("mt-2", className)}>
    <p role={tone === "error" ? "alert" : undefined} className={cn("text-sm", tone === "error" ? "text-destructive" : "text-xs text-muted-foreground")}>{error}</p>
    {detail && <details className="mt-1 text-xs text-muted-foreground"><summary className="cursor-pointer">More info</summary><pre className="campaign-error-detail">{detail}</pre></details>}
  </div>;
}
