import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { HeliosClient, type JsonObject, type Workflow } from "./client.js";

const jsonObject = z.record(z.string(), z.unknown());
const position = z.object({ x: z.number(), y: z.number() });

function result(value: JsonObject) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function summary(workflow: Workflow): JsonObject {
  return {
    id: workflow.id,
    name: workflow.name,
    nodeCount: workflow.nodes.length,
    edgeCount: workflow.edges.length,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt ?? workflow.createdAt,
  };
}

function createServer(): McpServer {
  const server = new McpServer({ name: "heliosgen", version: "0.1.0" });
  const client = new HeliosClient();

  server.registerTool("helios_get_status", {
    title: "Get HeliosGen status",
    description: "Check whether the local HeliosGen app is reachable and report workflow, model, and Kie key status.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    const [spaces, models, key] = await Promise.all([
      client.getWorkflows(),
      client.json<JsonObject>("/api/models"),
      client.json<{ hasToken: boolean }>("/api/settings/kie-key"),
    ]);
    const textGroups = Array.isArray(models.text) ? models.text as JsonObject[] : [];
    const textCount = textGroups.reduce((count, group) => count + (Array.isArray(group.models) ? group.models.length : 0), 0);
    return result({ reachable: true, baseUrl: client.baseUrl, kieKeyConfigured: key.hasToken, workflowCount: spaces.length, textModelCount: textCount, imageModelCount: Array.isArray(models.image) ? models.image.length : 0, videoModelCount: Array.isArray(models.video) ? models.video.length : 0 });
  });

  server.registerTool("helios_list_models", {
    title: "List HeliosGen models",
    description: "List the configured text, image, or video models and their capabilities.",
    inputSchema: z.object({ type: z.enum(["text", "image", "video"]).optional().describe("Omit to return every model family.") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ type }) => {
    const models = await client.json<JsonObject>("/api/models");
    return result(type ? { type, models: models[type] } : models);
  });

  server.registerTool("helios_list_workflows", {
    title: "List workflows",
    description: "Search and paginate local HeliosGen workflows, returning compact summaries.",
    inputSchema: z.object({ query: z.string().optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(25) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ query, offset, limit }) => {
    const all = await client.getWorkflows();
    const filtered = query ? all.filter((workflow) => workflow.name.toLowerCase().includes(query.toLowerCase()) || workflow.id.includes(query)) : all;
    return result({ total: filtered.length, offset, limit, workflows: filtered.slice(offset, offset + limit).map(summary) });
  });

  server.registerTool("helios_get_workflow", {
    title: "Get workflow",
    description: "Get a complete workflow graph, including nodes, edges, counters, and viewport.",
    inputSchema: z.object({ workflowId: z.string().min(1) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ workflowId }) => {
    const workflow = (await client.getWorkflows()).find((candidate) => candidate.id === workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
    return result(workflow as unknown as JsonObject);
  });

  server.registerTool("helios_get_job", {
    title: "Get generation job",
    description: "Get the current state and output URL of an image or video generation job.",
    inputSchema: z.object({ taskId: z.string().min(1) }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ taskId }) => result(await client.json<JsonObject>(`/api/job-status?taskId=${encodeURIComponent(taskId)}`)));

  server.registerTool("helios_create_workflow", {
    title: "Create workflow",
    description: "Create a new local HeliosGen workflow, optionally initialized with a graph.",
    inputSchema: z.object({ name: z.string().min(1), workflowId: z.string().min(1).optional().describe("Optional stable ID; fails if it already exists."), nodes: z.array(jsonObject).default([]), edges: z.array(jsonObject).default([]), viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }).optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ name, workflowId, nodes, edges, viewport }) => {
    const now = Date.now();
    const workflow: Workflow = { id: workflowId ?? randomUUID(), name, nodes, edges, nodeCounters: {}, createdAt: now, updatedAt: now, ...(viewport ? { viewport } : {}) };
    await client.appendWorkflow(workflow);
    return result({ workflow: summary(workflow) });
  });

  server.registerTool("helios_rename_workflow", {
    title: "Rename workflow",
    description: "Rename an existing HeliosGen workflow without changing its graph.",
    inputSchema: z.object({ workflowId: z.string().min(1), name: z.string().min(1) }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ workflowId, name }) => {
    const workflow = await client.mutateWorkflow(workflowId, (current) => ({ ...current, name }));
    return result({ workflow: summary(workflow!) });
  });

  server.registerTool("helios_replace_workflow", {
    title: "Replace workflow graph",
    description: "Replace a workflow's complete node and edge graph. Omitted metadata is preserved.",
    inputSchema: z.object({ workflowId: z.string().min(1), name: z.string().min(1).optional(), nodes: z.array(jsonObject), edges: z.array(jsonObject), nodeCounters: z.record(z.string(), z.number().int().min(0)).optional(), viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }).optional() }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ workflowId, name, nodes, edges, nodeCounters, viewport }) => {
    const workflow = await client.mutateWorkflow(workflowId, (current) => ({ ...current, ...(name ? { name } : {}), nodes, edges, ...(nodeCounters ? { nodeCounters } : {}), ...(viewport ? { viewport } : {}) }));
    return result({ workflow: summary(workflow!) });
  });

  server.registerTool("helios_delete_workflow", {
    title: "Delete workflow",
    description: "Permanently delete one local workflow and its graph.",
    inputSchema: z.object({ workflowId: z.string().min(1) }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ workflowId }) => {
    await client.mutateWorkflow(workflowId, () => null);
    return result({ deleted: true, workflowId });
  });

  server.registerTool("helios_add_node", {
    title: "Add workflow node",
    description: "Add a React Flow node to a workflow. Provide the HeliosGen node type, position, and node data.",
    inputSchema: z.object({ workflowId: z.string().min(1), nodeType: z.string().min(1), position, data: jsonObject, nodeId: z.string().min(1).optional(), width: z.number().positive().optional(), height: z.number().positive().optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ workflowId, nodeType, position: nodePosition, data, nodeId, width, height }) => {
    const id = nodeId ?? randomUUID();
    const workflow = await client.mutateWorkflow(workflowId, (current) => {
      if (current.nodes.some((node) => node.id === id)) throw new Error(`Node already exists: ${id}`);
      return { ...current, nodes: [...current.nodes, { id, type: nodeType, position: nodePosition, data, ...(width ? { width } : {}), ...(height ? { height } : {}) }] };
    });
    return result({ nodeId: id, workflow: summary(workflow!) });
  });

  server.registerTool("helios_update_node", {
    title: "Update workflow node",
    description: "Merge fields into a node and optionally merge its data object or change its position.",
    inputSchema: z.object({ workflowId: z.string().min(1), nodeId: z.string().min(1), patch: jsonObject.default({}), dataPatch: jsonObject.optional(), position: position.optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ workflowId, nodeId, patch, dataPatch, position: nodePosition }) => {
    const workflow = await client.mutateWorkflow(workflowId, (current) => {
      const index = current.nodes.findIndex((node) => node.id === nodeId);
      if (index < 0) throw new Error(`Node not found: ${nodeId}`);
      const prior = current.nodes[index];
      const next = { ...prior, ...patch, ...(nodePosition ? { position: nodePosition } : {}), ...(dataPatch ? { data: { ...(typeof prior.data === "object" && prior.data ? prior.data as JsonObject : {}), ...dataPatch } } : {}) };
      return { ...current, nodes: current.nodes.map((node, candidate) => candidate === index ? next : node) };
    });
    return result({ nodeId, workflow: summary(workflow!) });
  });

  server.registerTool("helios_remove_node", {
    title: "Remove workflow node",
    description: "Remove a node and every edge connected to it.",
    inputSchema: z.object({ workflowId: z.string().min(1), nodeId: z.string().min(1) }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ workflowId, nodeId }) => {
    const workflow = await client.mutateWorkflow(workflowId, (current) => {
      if (!current.nodes.some((node) => node.id === nodeId)) throw new Error(`Node not found: ${nodeId}`);
      return { ...current, nodes: current.nodes.filter((node) => node.id !== nodeId), edges: current.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId) };
    });
    return result({ removed: true, nodeId, workflow: summary(workflow!) });
  });

  server.registerTool("helios_connect_nodes", {
    title: "Connect workflow nodes",
    description: "Add a directed React Flow edge between two existing workflow nodes.",
    inputSchema: z.object({ workflowId: z.string().min(1), source: z.string().min(1), target: z.string().min(1), sourceHandle: z.string().optional(), targetHandle: z.string().optional(), edgeId: z.string().min(1).optional(), data: jsonObject.optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ workflowId, source, target, sourceHandle, targetHandle, edgeId, data }) => {
    const id = edgeId ?? randomUUID();
    const workflow = await client.mutateWorkflow(workflowId, (current) => {
      const nodeIds = new Set(current.nodes.map((node) => String(node.id)));
      if (!nodeIds.has(source) || !nodeIds.has(target)) throw new Error("Source and target nodes must both exist in the workflow.");
      if (current.edges.some((edge) => edge.id === id)) throw new Error(`Edge already exists: ${id}`);
      return { ...current, edges: [...current.edges, { id, source, target, ...(sourceHandle ? { sourceHandle } : {}), ...(targetHandle ? { targetHandle } : {}), ...(data ? { data } : {}) }] };
    });
    return result({ edgeId: id, workflow: summary(workflow!) });
  });

  server.registerTool("helios_disconnect_edge", {
    title: "Disconnect workflow edge",
    description: "Remove one workflow edge by ID.",
    inputSchema: z.object({ workflowId: z.string().min(1), edgeId: z.string().min(1) }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ workflowId, edgeId }) => {
    const workflow = await client.mutateWorkflow(workflowId, (current) => {
      if (!current.edges.some((edge) => edge.id === edgeId)) throw new Error(`Edge not found: ${edgeId}`);
      return { ...current, edges: current.edges.filter((edge) => edge.id !== edgeId) };
    });
    return result({ disconnected: true, edgeId, workflow: summary(workflow!) });
  });

  server.registerTool("helios_generate_text", {
    title: "Generate text",
    description: "Run a HeliosGen text model and return the complete streamed response.",
    inputSchema: z.object({ prompt: z.string().min(1), model: z.string().optional(), systemPrompt: z.string().optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (input) => result({ model: input.model ?? "claude-sonnet-4-6", text: await client.generateText(input) }));

  server.registerTool("helios_generate_image", {
    title: "Start image generation",
    description: "Start an image generation or edit job with a configured HeliosGen image model.",
    inputSchema: z.object({ prompt: z.string().min(1), model: z.string().default("nano-banana-2"), imageUrls: z.array(z.string().url()).default([]), aspectRatio: z.string().default("1:1"), quality: z.string().default("1k") }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (input) => result(await client.json<JsonObject>("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })));

  server.registerTool("helios_generate_video", {
    title: "Start video generation",
    description: "Start a text-, image-, or reference-to-video job with a configured HeliosGen video model.",
    inputSchema: z.object({ prompt: z.string().default(""), videoModel: z.string().default("kling-3.0"), startFrameUrl: z.string().url().optional(), endFrameUrl: z.string().url().optional(), referenceImageUrls: z.array(z.string().url()).default([]), referenceVideoUrls: z.array(z.string().url()).default([]), referenceAudioUrls: z.array(z.string().url()).default([]), sound: z.boolean().default(false), duration: z.number().positive().default(5), aspectRatio: z.string().default("16:9"), mode: z.string().default("pro"), resolution: z.string().optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (input) => result(await client.json<JsonObject>("/api/generate-video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })));

  server.registerTool("helios_wait_for_job", {
    title: "Wait for generation job",
    description: "Poll an image or video generation job until it completes, fails, disappears, or reaches the timeout.",
    inputSchema: z.object({ taskId: z.string().min(1), timeoutSeconds: z.number().int().min(1).max(600).default(300), pollSeconds: z.number().min(1).max(10).default(3) }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ taskId, timeoutSeconds, pollSeconds }) => {
    const deadline = Date.now() + timeoutSeconds * 1000;
    let state: JsonObject = { status: "pending" };
    while (Date.now() < deadline) {
      state = await client.json<JsonObject>(`/api/job-status?taskId=${encodeURIComponent(taskId)}`);
      if (state.status !== "pending") return result({ taskId, ...state });
      await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
    }
    return result({ taskId, ...state, timedOut: true });
  });

  return server;
}

void serveStdio(createServer, { onerror: (error) => console.error("[heliosgen-mcp]", error) });
