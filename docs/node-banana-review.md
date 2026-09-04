# Node Banana review and provider roadmap

Reviewed project: [shrimbly/node-banana](https://github.com/shrimbly/node-banana)

## Adopted now

- **Provider-scoped API boundary.** WaveSpeed submission, discovery, status parsing, and polling live outside the UI and expose one normalized HeliosGen job contract.
- **Dynamic model discovery.** HeliosGen reads WaveSpeed's live `/api/v3/models` catalog instead of shipping a stale model list. Model request schemas remain available to MCP clients.
- **Normalized polling.** WaveSpeed jobs use the existing `pending` / `done` / `error` contract, adaptive 2–10 second polling, all documented terminal states, restart recovery, and local media mirroring.
- **Agent-first model execution.** The MCP can search models, inspect a model's schema, start a billable generation, and wait for the result.

## Best ideas to port next

1. **Schema-driven provider nodes.** Build image and video node controls from each provider's request schema. This is the right way to expose the full WaveSpeed catalog in the canvas without hard-coded fields per model.
2. **Per-run cost capture.** Persist quoted and actual provider cost alongside every generation. Surface workflow and node totals before execution.
3. **Ordered fallback models.** Let a node specify a primary model and compatible fallbacks, with explicit rules for retryable provider failures and budget ceilings.
4. **ComfyUI workflow nodes.** Import a ComfyUI schema and turn its inputs/outputs into typed HeliosGen handles while preserving the original workflow JSON.
5. **Portable workflow media.** Externalize embedded blobs when exporting, then restore or relink them during import. This keeps workflow files small and shareable.
6. **Annotation node.** Add non-destructive paint, mask, and markup controls as a first-class workflow input.
7. **Graph integrity and history hardening.** Port the ideas behind orphan-edge cleanup and blob-aware undo snapshots so long editing sessions remain safe and memory-bounded.

## Ideas not to copy directly

- Do not adopt a fixed one-second WaveSpeed polling loop; current WaveSpeed guidance requires at least two seconds and recommends backing off for long jobs.
- Do not replace HeliosGen's SQLite and file-backed job recovery with browser-only state.
- Do not couple provider discovery to React components. The same catalog and schema layer must serve the canvas, gallery, HTTP routes, and MCP.

## Proposed implementation order

1. Schema-to-control renderer for WaveSpeed image/video nodes.
2. Cost fields and generation ledger migration.
3. Compatible-model fallback runner.
4. ComfyUI node import.
5. Portable media export/import and annotation tools.
