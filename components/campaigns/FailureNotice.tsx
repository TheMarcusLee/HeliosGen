import { cn } from "@/lib/utils";

/** A failed step's one-line error, with the provider diagnostic behind a "More info" toggle. */
export function FailureNotice({ error, detail, className }: { error: string; detail?: string; className?: string }) {
  return <div className={cn("mt-2", className)}>
    <p role="alert" className="text-sm text-destructive">{error}</p>
    {detail && <details className="mt-1 text-xs text-muted-foreground"><summary className="cursor-pointer">More info</summary><pre className="campaign-error-detail">{detail}</pre></details>}
  </div>;
}
