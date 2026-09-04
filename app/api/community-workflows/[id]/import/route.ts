import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { convertNodeBananaWorkflow } from "@/lib/nodeBananaConverter";
import { getSpaces, saveSpaces } from "@/lib/guest/spaces";

const URL = "https://nodebananapro.com/api/public/community-workflows";
const LARGE_BYTES = 25 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as { allowLarge?: boolean };
    const catalogResponse = await fetch(URL, { cache: "no-store" });
    const catalog = await catalogResponse.json() as { workflows?: Array<{ id: string; name: string; size: number }> };
    const metadata = catalog.workflows?.find((workflow) => workflow.id === id);
    if (!metadata) return NextResponse.json({ error: `Community workflow not found: ${id}` }, { status: 404 });
    if (metadata.size > LARGE_BYTES && !body.allowLarge) {
      return NextResponse.json({ error: `This workflow is ${Math.round(metadata.size / 1024 / 1024)} MB. Retry with allowLarge=true to download its embedded media.`, requiresLargeConfirmation: true }, { status: 409 });
    }
    const linkResponse = await fetch(`${URL}/${encodeURIComponent(id)}`, { cache: "no-store" });
    const link = await linkResponse.json() as { downloadUrl?: string; error?: string };
    if (!link.downloadUrl) throw new Error(link.error ?? "Unable to obtain workflow download URL.");
    const download = await fetch(link.downloadUrl);
    if (!download.ok) throw new Error("Community workflow download failed.");
    const conversion = convertNodeBananaWorkflow(await download.json());
    const timestamp = Date.now();
    const workflow = { id: randomUUID(), name: `${metadata.name} · Node Banana`, nodes: conversion.nodes, edges: conversion.edges, nodeCounters: conversion.nodeCounters, createdAt: timestamp, updatedAt: timestamp };
    const spaces = getSpaces();
    saveSpaces([...spaces, workflow]);
    return NextResponse.json({ workflow: { id: workflow.id, name: workflow.name, nodeCount: workflow.nodes.length, edgeCount: workflow.edges.length }, warnings: conversion.warnings, unsupportedNodeTypes: conversion.unsupportedNodeTypes, converterVersion: conversion.version });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Community workflow import failed." }, { status: 502 });
  }
}
