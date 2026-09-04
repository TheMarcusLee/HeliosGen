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

## CloneMe Studio production pipeline — implemented

CloneMe Studio is not a node-workflow library, but its production pipeline is now expressed as native, reusable HeliosGen capabilities:

1. ✅ **Identity layer and matrix input.** The dedicated Identities library and Identity Matrix canvas node save multiple face/body references, a trigger word, reusable base prompts, content class, provider/model preference, and aspect ratio as one portable identity asset. Every edit creates an immutable version; the library exposes linked workflows and provider activity; workflows retain their embedded snapshot even if the saved asset later changes.
2. ✅ **Scene replacement workflow.** The dashboard template connects a target scene to Opus 5 vision analysis, combines that result with the selected identity, sends the identity-aware prompt and references to generation, and records the gallery/ledger provenance.
3. ✅ **Pose/outfit batch workflow.** The dashboard template creates the cross-product of selected poses and outfits while reusing one scene analysis for the complete batch.
4. ✅ **Concurrent queue with explicit states.** Batch runs and items persist in SQLite with `idle`, `analysis`, `generation`, `paused`, `completed`, and `error` states; concurrency is bounded from 1–8 and the canvas supports pause, resume, and error-only retry.
5. ✅ **Provider transaction ledger.** WaveSpeed, Kie, Azure, Codex, and ComfyUI submissions record provider, operation/model, estimate/actual cost fields, status, routing context, workflow/node attribution, task IDs, output URLs, and fallback provenance.
6. ✅ **SFW/adult routing as workflow metadata.** Workflows carry explicit content class and provider/model routes through save, duplicate, import, and export. Adult routes require recorded adult/consent assurances. Server routes reject child sexual content and non-consensual intimate imagery and enforce the configured route instead of guessing from model names.

## Roadmap implementation status

1. ✅ **Schema-driven provider nodes.** WaveSpeed image/video canvas controls are generated from the authenticated live request schema, including required typed handles, enums, numeric limits, booleans, defaults, and disabled provider-managed fields.
2. ✅ **Per-run cost capture.** SQLite records provider attempts across WaveSpeed, Kie, Azure, Codex, and ComfyUI, including quoted/estimated spend, final state, workflow/node provenance, and fallback skips. Settings includes aggregate and recent usage views.
3. ✅ **Ordered fallback models.** Nodes accept compatible ordered fallbacks and a maximum estimated spend. Inputs are semantically remapped between schemas, incompatible attempts are skipped with audit entries, and processing continues through the ordered list.
4. ✅ **Community catalog and converter.** The dashboard browses the hosted Node Banana library and a versioned converter maps supported nodes and semantic handles, while preserving unsupported content as notes with warnings.
5. ✅ **ComfyUI workflow nodes.** API-format workflows expose typed primitive/media handles and execute against a configured local ComfyUI server or Comfy Cloud, with outputs copied to HeliosGen storage.
6. ✅ **Portable workflow media.** Export archives externalize media and imports restore it, keeping workflows self-contained across machines.
7. ✅ **Annotation node.** Rectangle, ellipse, arrow, freehand, and text overlays remain non-destructive until the user exports a flattened PNG.
8. ✅ **Graph integrity and history hardening.** Workflow writes and imports remove orphan/self/duplicate edges, group membership is repaired, cycles fail safely before execution, and undo snapshots omit large blob URLs and volatile job state.
9. ✅ **Writable MCP.** Agents can inspect and mutate complete workflow graphs, identities and their immutable versions, CloneMe templates, content routing, and batch plans; discover and run WaveSpeed models; set fallbacks/cost ceilings; audit the ledger; import community workflows; run ComfyUI workflows; and wait for generation results.

## Ideas not to copy directly

- Do not adopt a fixed one-second WaveSpeed polling loop; current WaveSpeed guidance requires at least two seconds and recommends backing off for long jobs.
- Do not replace HeliosGen's SQLite and file-backed job recovery with browser-only state.
- Do not couple provider discovery to React components. The same catalog and schema layer must serve the canvas, gallery, HTTP routes, and MCP.

## Delivered implementation order

1. Schema-to-control renderer for WaveSpeed image/video nodes.
2. Cost fields and generation ledger migration.
3. Compatible-model fallback runner.
4. Node Banana community catalog browser and versioned converter.
5. ComfyUI node import.
6. Annotation tools.
7. Graph/history hardening and writable MCP coverage.
8. CloneMe identity assets, production templates, persistent batch queues, explicit routing, and provider-wide provenance.
