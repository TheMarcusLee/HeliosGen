import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A native <select> styled like Input. Used wherever a plain option list is
 * enough and a custom popover would only add weight (campaign settings,
 * filters, model pickers).
 */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
        className
      )}
      {...props}
    />
  )
}

export { NativeSelect }
