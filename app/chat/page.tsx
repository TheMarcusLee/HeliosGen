"use client";
import { BrandIcon } from "@/components/Brand";
import { Suspense } from "react";
import { CampaignWorkspace } from "@/components/campaigns/CampaignWorkspace";
export default function ChatPage() {
  return <Suspense fallback={<div className="flex items-center gap-3 p-8 text-muted-foreground"><BrandIcon />Loading creative workspace…</div>}><CampaignWorkspace /></Suspense>;
}
