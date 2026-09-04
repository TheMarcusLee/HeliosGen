# Node Banana review and provider roadmap

Reviewed project: [shrimbly/node-banana](https://github.com/shrimbly/node-banana)

Audit commits: node-banana `5c0e0ae6150f29a6de819f8d6f1dedba15151f7c`; CloneMe Studio `cf08e95982fc64c7c734ce8de852b1d86929eab7`.

## Adopted now

- **Provider-scoped API boundary.** WaveSpeed submission, discovery, status parsing, and polling live outside the UI and expose one normalized HeliosGen job contract.
- **Dynamic model discovery.** HeliosGen reads WaveSpeed's live `/api/v3/models` catalog instead of shipping a stale model list. Model request schemas remain available to MCP clients.
- **Browsable WaveSpeed settings catalog.** Image and video panels now search and paginate the authenticated live catalog, filter by generated media type, and show input counts and base pricing.
- **Normalized polling.** WaveSpeed jobs use the existing `pending` / `done` / `error` contract, adaptive 2–10 second polling, all documented terminal states, restart recovery, and local media mirroring.
- **Agent-first model execution.** The MCP can search models, inspect a model's schema, start a billable generation, and wait for the result.
- **Portable workflow media.** HeliosGen exports a self-contained zip with content-addressed media and restores those assets during import.

## Where the shared node-banana workflows actually live

The GitHub repository currently contains six hard-coded starter templates and one standalone example (`examples/Seedance-2-Parametric-Prompt.json`). The larger shared workflows are not checked into Git. Node Banana loads them from its hosted community catalog at `https://nodebananapro.com/api/public/community-workflows`.

Catalog observed on 2026-09-04:

| Workflow | Author | Nodes | Size | Providers |
| --- | --- | ---: | ---: | --- |
| Fashion Ad Automation | @ReflctWillie | 71 | 130.2 MB | Kie |
| Seedance 2 Parametric Prompt | @ReflctWillie | 8 | 83 KB | Kie |
| Fashion Image to Video | @ReflctWillie | 61 | 262.9 MB | Gemini, Fal |
| Bills Supra | @ReflctWillie | 82 | 78.6 MB | Gemini |
| Chris Walkman | @ReflctWillie | 64 | 82.5 MB | Gemini |
| Cars I2V | @ReflctWillie | 67 | 262.9 MB | Fal |
| Invisible Mannequin | @ReflctWillie | 10 | 109.2 MB | Gemini |
| Fashion I2V - Marco | @MarcoBorin | 60 | 198.3 MB | Kie |
| Apply Material - Ecom | @ReflctWillie | 38 | 86 KB | Fal, Gemini |

The large files embed reference media. Importing them directly would duplicate hundreds of megabytes and still would not execute because Node Banana node and handle names differ from HeliosGen. The correct integration is a catalog browser plus a versioned converter that externalizes assets and reports unsupported nodes before committing an import.

The small Seedance example confirms the important conversion map:

- `prompt` → `promptNode`
- `imageInput` → `imageInputNode`
- `generateVideo` → `videoGeneratorNode`
- `llmGenerate` → `assistantNode`
- `promptConstructor` has no native equivalent yet and needs a template/variable node
- Node Banana's indexed handles (`text-0`, `image-2`) need semantic HeliosGen handle mapping

## CloneMe Studio ideas worth bringing into HeliosGen

CloneMe Studio is not a node-workflow library, but it has a useful production pipeline to express as reusable HeliosGen templates:

1. **Identity matrix input.** Keep multiple face/body references plus a trigger word and reusable base prompts as one versioned identity asset.
2. **Scene replacement workflow.** Target scene → vision analysis → identity-aware prompt construction → provider generation → gallery output.
3. **Pose/outfit batch workflow.** Cross-product selected poses and outfits into a queue without repeating vision analysis.
4. **Concurrent queue with explicit states.** Idle → analysis → generation → completed/error, with bounded concurrency, pause, and retries.
5. **Provider transaction ledger.** Record provider, operation, estimate/actual cost, status, and output provenance for every run.
6. **SFW/adult routing as workflow metadata.** Provider/model selection should be explicit and auditable; do not infer capability from a model name. Provider rules still apply, and workflows must reject child sexual content and non-consensual intimate imagery.

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
4. Node Banana community catalog browser and versioned converter.
5. ComfyUI node import.
6. Annotation tools.
