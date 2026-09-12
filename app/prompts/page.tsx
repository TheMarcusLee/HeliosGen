"use client";
import { Suspense } from "react";
import PromptLibrary from "@/components/PromptLibrary";
export default function PromptsPage() {
  return <Suspense fallback={null}><PromptLibrary /></Suspense>;
}
