import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { HeliosClient, type JsonObject, type Workflow } from "./client.js";

const jsonObject = z.record(z.string(), z.json());
const position = z.object({ x: z.number(), y: z.number() });
const providerRoute = z.object({ provider: z.enum(["kie", "wavespeed", "comfyui", "azure", "codex"]), modelId: z.string().min(1).max(240) }).strict();
const workflowMetadata = z.object({
  contentClass: z.enum(["sfw", "adult"]),
  routingRequired: z.boolean().optional(),
  routes: z.object({ sfw: providerRoute.optional(), adult: providerRoute.optional() }).strict(),
  adultAssurances: z.object({ allSubjectsAdults: z.boolean(), consentVerified: z.boolean() }).strict().optional(),
}).strict();
const identityReference = z.object({ url: z.string().url(), kind: z.enum(["face", "body"]), label: z.string().max(80).optional() }).strict();
const identityDefaults = z.object({
  contentClass: z.enum(["sfw", "adult"]).default("sfw"),
  provider: z.enum(["kie", "wavespeed", "comfyui", "azure", "codex"]).optional(),
  modelId: z.string().min(1).max(240).optional(),
  aspectRatio: z.string().min(1).max(24).optional(),
}).strict();

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
  const server = new McpServer({ name: "heliosgen-mcp-server", version: "0.3.0" });
  const client = new HeliosClient();

  server.registerTool("helios_get_status", {
    title: "Get HeliosGen status",
    description: "Check whether the local HeliosGen app is reachable and report workflow, model, and Kie key status.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const [spaces, models, key, waveSpeedKey, comfy] = await Promise.all([
      client.getWorkflows(),
      client.json<JsonObject>("/api/models"),
      client.json<{ hasToken: boolean }>("/api/settings/kie-key"),
      client.json<{ hasToken: boolean }>("/api/settings/wavespeed-key"),
      client.json<{ hasApiKey: boolean; baseUrl: string }>("/api/settings/comfy"),
    ]);
    const textGroups = Array.isArray(models.text) ? models.text as JsonObject[] : [];
    const textCount = textGroups.reduce((count, group) => count + (Array.isArray(group.models) ? group.models.length : 0), 0);
    return result({ reachable: true, baseUrl: client.baseUrl, kieKeyConfigured: key.hasToken, waveSpeedKeyConfigured: waveSpeedKey.hasToken, comfyApiKeyConfigured: comfy.hasApiKey, comfyBaseUrl: comfy.baseUrl, workflowCount: spaces.length, textModelCount: textCount, imageModelCount: Array.isArray(models.image) ? models.image.length : 0, videoModelCount: Array.isArray(models.video) ? models.video.length : 0 });
  });

  server.registerTool("helios_list_models", {
    title: "List HeliosGen models",
    description: "List the configured text, image, or video models and their capabilities.",
    inputSchema: z.object({ type: z.enum(["text", "image", "video"]).optional().describe("Omit to return every model family.") }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ type }) => {
    const models = await client.json<JsonObject>("/api/models");
    return result(type ? { type, models: models[type] } : models);
  });

  server.registerTool("helios_list_workflows", {
    title: "List workflows",
    description: "Search and paginate local HeliosGen workflows, returning compact summaries.",
    inputSchema: z.object({ query: z.string().optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(25) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ query, offset, limit }) => {
    const all = await client.getWorkflows();
    const filtered = query ? all.filter((workflow) => workflow.name.toLowerCase().includes(query.toLowerCase()) || workflow.id.includes(query)) : all;
    return result({ total: filtered.length, offset, limit, workflows: filtered.slice(offset, offset + limit).map(summary) });
  });

  server.registerTool("helios_get_workflow", {
    title: "Get workflow",
    description: "Get a complete workflow graph, including nodes, edges, counters, and viewport.",
    inputSchema: z.object({ workflowId: z.string().min(1) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ workflowId }) => {
    const workflow = (await client.getWorkflows()).find((candidate) => candidate.id === workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
    return result(workflow as unknown as JsonObject);
  });

  server.registerTool("helios_get_job", {
    title: "Get generation job",
    description: "Get the current state and output URL of an image or video generation job.",
    inputSchema: z.object({ taskId: z.string().min(1) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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
    description: "Start an image generation or edit job with a configured HeliosGen image model, optionally attributed to an identity and workflow.",
    inputSchema: z.object({ prompt: z.string().min(1), model: z.string().default("nano-banana-2"), imageUrls: z.array(z.string().url()).default([]), aspectRatio: z.string().default("1:1"), quality: z.string().default("1k"), workflowId: z.string().max(240).optional(), nodeId: z.string().max(240).optional(), identityAssetId: z.string().max(240).optional(), workflowMetadata: workflowMetadata.optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (input) => result(await client.json<JsonObject>("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })));

  server.registerTool("helios_generate_video", {
    title: "Start video generation",
    description: "Start a text-, image-, or reference-to-video job with a configured HeliosGen video model, optionally attributed to an identity and workflow.",
    inputSchema: z.object({ prompt: z.string().default(""), videoModel: z.string().default("kling-3.0"), startFrameUrl: z.string().url().optional(), endFrameUrl: z.string().url().optional(), referenceImageUrls: z.array(z.string().url()).default([]), referenceVideoUrls: z.array(z.string().url()).default([]), referenceAudioUrls: z.array(z.string().url()).default([]), sound: z.boolean().default(false), duration: z.number().positive().default(5), aspectRatio: z.string().default("16:9"), mode: z.string().default("pro"), resolution: z.string().optional(), workflowId: z.string().max(240).optional(), nodeId: z.string().max(240).optional(), identityAssetId: z.string().max(240).optional(), workflowMetadata: workflowMetadata.optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (input) => result(await client.json<JsonObject>("/api/generate-video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })));

  server.registerTool("helios_list_wavespeed_models", {
    title: "List WaveSpeed models",
    description: "Search and paginate the live WaveSpeed catalog. Returns compact model metadata, capability type, and base price; use helios_get_wavespeed_model to inspect a model's request schema before generation.",
    inputSchema: z.object({
      query: z.string().max(200).optional().describe("Case-insensitive search across model ID, name, description, and type."),
      type: z.string().max(100).optional().describe("Exact WaveSpeed type such as text-to-image, image-to-image, text-to-video, or image-to-video."),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(25),
    }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ query, type, offset, limit }) => {
    const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
    if (query) params.set("query", query);
    if (type) params.set("type", type);
    return result(await client.json<JsonObject>(`/api/wavespeed/models?${params}`));
  });

  server.registerTool("helios_get_wavespeed_model", {
    title: "Get WaveSpeed model schema",
    description: "Get one WaveSpeed model and its live JSON request schema, including required parameters, defaults, enums, and numeric bounds. Call this before helios_generate_wavespeed.",
    inputSchema: z.object({
      modelId: z.string().min(3).max(240).describe("Exact WaveSpeed model ID, for example wavespeed-ai/z-image/turbo."),
    }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ modelId }) => {
    const params = new URLSearchParams({ modelId, includeSchema: "true" });
    return result(await client.json<JsonObject>(`/api/wavespeed/models?${params}`));
  });

  server.registerTool("helios_generate_wavespeed", {
    title: "Start WaveSpeed generation",
    description: "Start a billable WaveSpeed image or video generation using an exact model ID and that model's schema-specific input object. Returns a HeliosGen task ID for helios_wait_for_job. Inspect the model with helios_get_wavespeed_model first; unsupported or missing parameters are rejected by WaveSpeed.",
    inputSchema: z.object({
      modelId: z.string().min(3).max(240).describe("Exact WaveSpeed model ID."),
      mediaType: z.enum(["image", "video"]).describe("How HeliosGen should store and expose the completed media."),
      input: jsonObject.describe("WaveSpeed model parameters, including prompt and any model-specific image, size, duration, seed, or quality fields."),
      fallbackModelIds: z.array(z.string().min(3).max(240)).max(8).default([]).describe("Ordered compatible fallback model IDs."),
      maxCost: z.number().nonnegative().optional().describe("Maximum estimated USD spend across the primary model and attempted fallbacks."),
      workflowId: z.string().max(240).optional(),
      nodeId: z.string().max(240).optional(),
      identityAssetId: z.string().max(240).optional(),
      workflowMetadata: workflowMetadata.optional().describe("Audited SFW/adult routing metadata. Adult requests require assurances and an exact matching provider/model route."),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (input) => result(await client.json<JsonObject>("/api/wavespeed/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })));

  server.registerTool("helios_add_wavespeed_node", {
    title: "Add schema-driven WaveSpeed node",
    description: "Add a configured WaveSpeed image or video node to a workflow. The live model schema, defaults, pricing estimate, ordered fallbacks, and cost ceiling are stored with the node so it is immediately editable on the canvas.",
    inputSchema: z.object({
      workflowId: z.string().min(1),
      modelId: z.string().min(3).max(240),
      mediaType: z.enum(["image", "video"]),
      position,
      parameters: jsonObject.default({}),
      fallbackModelIds: z.array(z.string().min(3).max(240)).max(8).default([]),
      maxCost: z.number().nonnegative().optional(),
      label: z.string().min(1).max(120).default("WaveSpeed"),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ workflowId, modelId, mediaType, position: nodePosition, parameters, fallbackModelIds, maxCost, label }) => {
    const response = await client.json<{ model: JsonObject }>(`/api/wavespeed/models?modelId=${encodeURIComponent(modelId)}&includeSchema=true`);
    const model = response.model;
    const id = `waveSpeedNode-${randomUUID()}`;
    const workflow = await client.mutateWorkflow(workflowId, (current) => ({
      ...current,
      nodes: [...current.nodes, {
        id, type: "waveSpeedNode", position: nodePosition, style: { width: 380, height: 560 },
        data: {
          label, status: "idle", waveSpeedFamily: mediaType, waveSpeedModelId: modelId,
          waveSpeedModelName: model.name, waveSpeedModelType: model.type,
          waveSpeedSchema: model.requestSchema, waveSpeedBasePrice: model.basePrice,
          waveSpeedParameters: parameters, waveSpeedFallbacks: fallbackModelIds,
          ...(maxCost !== undefined ? { waveSpeedMaxCost: maxCost } : {}),
        },
      }],
    }));
    return result({ nodeId: id, workflow: summary(workflow!), model });
  });

  server.registerTool("helios_list_identity_assets", {
    title: "List identity assets",
    description: "List reusable versioned identity matrices containing face/body references, a trigger word, and base prompts. This is read-only and omits version history.",
    inputSchema: z.object({ offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(25) }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ offset, limit }) => {
    const body = await client.json<{ identities?: JsonObject[] }>("/api/identities");
    const all = body.identities ?? [];
    return result({ total: all.length, count: all.slice(offset, offset + limit).length, offset, identities: all.slice(offset, offset + limit), hasMore: offset + limit < all.length, nextOffset: offset + limit < all.length ? offset + limit : null });
  });

  server.registerTool("helios_get_identity_asset", {
    title: "Get identity asset",
    description: "Get the current identity matrix and every immutable prior version for provenance or rollback planning.",
    inputSchema: z.object({ identityId: z.string().min(1) }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ identityId }) => result(await client.json<JsonObject>(`/api/identities/${encodeURIComponent(identityId)}`)));

  server.registerTool("helios_create_identity_asset", {
    title: "Create identity asset",
    description: "Create version 1 of a reusable identity matrix. References must be URLs already accessible to the configured generation provider.",
    inputSchema: z.object({ name: z.string().min(1).max(120), triggerWord: z.string().max(120).default(""), basePrompts: z.array(z.string().min(1).max(2000)).max(20).default([]), references: z.array(identityReference).max(24).default([]), defaults: identityDefaults.default({ contentClass: "sfw" }) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input) => result(await client.json<JsonObject>("/api/identities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })));

  server.registerTool("helios_update_identity_asset", {
    title: "Create new identity version",
    description: "Replace the current identity matrix fields and append an immutable version-history snapshot. Existing workflows retain their embedded snapshot until deliberately refreshed.",
    inputSchema: z.object({ identityId: z.string().min(1), name: z.string().min(1).max(120), triggerWord: z.string().max(120).default(""), basePrompts: z.array(z.string().min(1).max(2000)).max(20).default([]), references: z.array(identityReference).max(24).default([]), defaults: identityDefaults.default({ contentClass: "sfw" }) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ identityId, ...input }) => result(await client.json<JsonObject>(`/api/identities/${encodeURIComponent(identityId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })));

  server.registerTool("helios_delete_identity_asset", {
    title: "Delete identity asset",
    description: "Permanently delete an identity asset and its version history. Workflow nodes keep their embedded snapshot, but can no longer refresh from the deleted asset.",
    inputSchema: z.object({ identityId: z.string().min(1) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ identityId }) => result(await client.json<JsonObject>(`/api/identities/${encodeURIComponent(identityId)}`, { method: "DELETE" })));

  server.registerTool("helios_create_clone_workflow", {
    title: "Create CloneMe production workflow",
    description: "Create an editable identity scene-replacement or pose/outfit batch workflow from the built-in production templates.",
    inputSchema: z.object({ templateId: z.enum(["scene-replacement", "pose-outfit-batch"]), name: z.string().min(1).max(120).optional(), identityAssetId: z.string().min(1).optional() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input) => result(await client.json<JsonObject>("/api/clone-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })));

  server.registerTool("helios_set_workflow_routing", {
    title: "Set workflow content routing",
    description: "Save explicit SFW/adult provider routing with a workflow. Only set adult assurances when the user has explicitly confirmed all subjects are adults and every real person consented. Generation still rejects child sexual content and non-consensual intimate imagery.",
    inputSchema: z.object({ workflowId: z.string().min(1), metadata: workflowMetadata }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ workflowId, metadata }) => {
    if (!metadata.routes[metadata.contentClass]) throw new Error(`Routing requires an exact ${metadata.contentClass.toUpperCase()} provider/model pair.`);
    if (metadata.contentClass === "adult" && (!metadata.routes.adult || !metadata.adultAssurances?.allSubjectsAdults || !metadata.adultAssurances?.consentVerified)) throw new Error("Adult routing requires an exact adult route plus both user-confirmed assurances.");
    const savedMetadata = { ...metadata, routingRequired: true };
    const workflow = await client.mutateWorkflow(workflowId, (current) => ({ ...current, metadata: savedMetadata }));
    return result({ workflow: summary(workflow!), metadata: savedMetadata });
  });

  server.registerTool("helios_list_identity_batches", {
    title: "List identity batches",
    description: "List persisted pose/outfit batch runs and their explicit idle, analysis, generation, paused, completed, or error states.",
    inputSchema: z.object({ workflowId: z.string().optional() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ workflowId }) => result(await client.json<JsonObject>(`/api/batches${workflowId ? `?workflowId=${encodeURIComponent(workflowId)}` : ""}`)));

  server.registerTool("helios_get_identity_batch", {
    title: "Get identity batch",
    description: "Get one persisted pose/outfit batch including every item prompt, attempt count, state, output, and error.",
    inputSchema: z.object({ batchId: z.string().min(1) }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ batchId }) => result(await client.json<JsonObject>(`/api/batches?id=${encodeURIComponent(batchId)}`)));

  server.registerTool("helios_create_identity_batch", {
    title: "Create identity batch plan",
    description: "Create and persist the cross-product of poses and outfits using one precomputed scene analysis. This plans the queue; use WaveSpeed generation plus helios_update_identity_batch to execute and record individual items from an agent.",
    inputSchema: z.object({ workflowId: z.string().min(1), nodeId: z.string().optional(), identityAssetId: z.string().min(1), provider: z.enum(["wavespeed", "kie"]), modelId: z.string().min(1).max(240), poses: z.array(z.string().min(1)).min(1).max(50), outfits: z.array(z.string().min(1)).min(1).max(50), scene: z.string().max(4000).optional(), analysis: z.string().max(12000).optional(), extra: z.string().max(4000).optional(), concurrency: z.number().int().min(1).max(8).default(2) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input) => {
    const workflow = (await client.getWorkflows()).find((candidate) => candidate.id === input.workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${input.workflowId}`);
    return result(await client.json<JsonObject>("/api/batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, workflowMetadata: workflow.metadata }) }));
  });

  server.registerTool("helios_update_identity_batch", {
    title: "Update identity batch state",
    description: "Pause/resume a batch or update one item's generation state, attempts, task ID, output URL, or error while an agent executes the persisted plan.",
    inputSchema: z.object({ batchId: z.string().min(1), status: z.enum(["idle", "analysis", "generation", "paused", "completed", "error"]).optional(), itemId: z.string().optional(), itemPatch: z.object({ status: z.enum(["idle", "analysis", "generation", "completed", "error"]).optional(), attempts: z.number().int().min(0).optional(), taskId: z.string().optional(), outputUrl: z.string().url().optional(), error: z.string().optional() }).strict().optional() }).strict().refine((value) => value.status !== undefined || (value.itemId && value.itemPatch), "Provide a batch status or an item update."),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ batchId, status, itemId, itemPatch }) => result(await client.json<JsonObject>("/api/batches", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: batchId, status, itemId, itemPatch }) })));

  server.registerTool("helios_list_generation_ledger", {
    title: "List generation cost ledger",
    description: "List recent provider generation attempts and aggregated quoted/estimated spend. Filter by workflow or node to audit routing, fallbacks, provenance, and costs across WaveSpeed, Kie, Azure, Codex, and ComfyUI.",
    inputSchema: z.object({ workflowId: z.string().optional(), nodeId: z.string().optional(), identityAssetId: z.string().optional(), limit: z.number().int().min(1).max(500).default(100) }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ workflowId, nodeId, identityAssetId, limit }) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (workflowId) params.set("workflowId", workflowId);
    if (nodeId) params.set("nodeId", nodeId);
    if (identityAssetId) params.set("identityAssetId", identityAssetId);
    return result(await client.json<JsonObject>(`/api/ledger?${params}`));
  });

  server.registerTool("helios_list_community_workflows", {
    title: "List community workflows",
    description: "Browse the Node Banana community workflow catalog with names, authors, tags, node counts, and download sizes. Large media-embedded workflows are clearly identified before import.",
    inputSchema: z.object({ query: z.string().max(200).optional() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ query }) => {
    const body = await client.json<{ workflows?: JsonObject[] }>("/api/community-workflows");
    const workflows = body.workflows ?? [];
    const filtered = query ? workflows.filter((workflow) => JSON.stringify(workflow).toLowerCase().includes(query.toLowerCase())) : workflows;
    return result({ count: filtered.length, workflows: filtered });
  });

  server.registerTool("helios_import_community_workflow", {
    title: "Import community workflow",
    description: "Download a Node Banana community workflow, convert supported nodes and edges into HeliosGen format, preserve provider model choices where possible, and save it as a new editable workflow. Files over 25 MB require allowLarge=true.",
    inputSchema: z.object({ workflowId: z.string().min(1).max(180).describe("Community catalog ID."), allowLarge: z.boolean().default(false).describe("Explicitly allow downloading media-embedded files over 25 MB.") }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ workflowId, allowLarge }) => result(await client.json<JsonObject>(`/api/community-workflows/${encodeURIComponent(workflowId)}/import`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowLarge }),
  })));

  server.registerTool("helios_run_comfy_workflow", {
    title: "Run ComfyUI workflow",
    description: "Execute an API-format ComfyUI workflow through the configured local server or Comfy Cloud endpoint. Bindings override exposed primitive/media inputs; completed files are copied into HeliosGen media storage.",
    inputSchema: z.object({
      workflow: jsonObject.describe("ComfyUI workflow exported with Save (API Format)."),
      bindings: z.array(z.object({
        id: z.string(), nodeId: z.string(), inputName: z.string(), nodeTitle: z.string(),
        kind: z.enum(["prompt", "image", "video", "audio", "value"]),
        value: z.json(), valueType: z.enum(["string", "number", "boolean"]),
      }).strict()).default([]),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (input) => result(await client.json<JsonObject>("/api/comfyui/run", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  })));

  server.registerTool("helios_wait_for_job", {
    title: "Wait for generation job",
    description: "Poll an image or video generation job until it completes, fails, disappears, or reaches the timeout.",
    inputSchema: z.object({ taskId: z.string().min(1), timeoutSeconds: z.number().int().min(1).max(600).default(300), pollSeconds: z.number().min(1).max(10).default(3) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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
