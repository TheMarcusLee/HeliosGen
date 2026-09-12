"use client";
import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useWorkflowStore } from "@/lib/store";
import { useSpaceSync } from "@/lib/useSpaceSync";
import { QuickAssist } from "@/components/QuickAssist";

const WorkflowCanvas = dynamic(() => import("@/components/WorkflowCanvas"), {
  ssr: false,
});

export default function WorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const switchSpace = useWorkflowStore((s) => s.switchSpace);

  const { loaded } = useSpaceSync();

  // Guard: once the DB copy has loaded, an unknown ID goes back to the
  // dashboard. Before that the persisted store may not hold a workflow that
  // was written server-side (a finished campaign run), so wait rather than
  // bounce to the chat page.
  useEffect(() => {
    if (!loaded) return;
    const spaces = useWorkflowStore.getState().spaces;
    if (!spaces.some((sp) => sp.id === id)) {
      router.replace("/workflow");
      return;
    }
    switchSpace(id);
  }, [id, loaded, switchSpace, router]);

  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      <WorkflowCanvas />
      <QuickAssist />
    </div>
  );
}
