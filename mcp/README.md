# UGC{Gen} MCP server

This local stdio server lets an MCP-capable agent inspect and operate the running UGC{Gen} app through 41 read/write tools. It includes workflow CRUD, node and edge editing, identity/version management, CloneMe production templates and batch plans, explicit content routing, model discovery, text generation, image/video job creation, provider ledger auditing, community imports, ComfyUI execution, WaveSpeed catalog and generation tools, and job polling.

## Run

Start UGC{Gen} first, then build and run the server:

```sh
pnpm mcp:build
pnpm mcp:start
```

The server targets `http://127.0.0.1:3000` by default. Set `UGCGEN_BASE_URL` if the app is listening elsewhere. `HELIOSGEN_BASE_URL` remains available as a compatibility fallback.

Use this command in an MCP client configuration after building:

```json
{
  "command": "node",
    "args": ["/absolute/path/to/HeliosGen/mcp/dist/index.js"],
  "env": {
    "UGCGEN_BASE_URL": "http://127.0.0.1:3000"
  }
}
```

Existing MCP registrations and tool names keep the `heliosgen` / `helios_*` identifiers for compatibility; the server and user-facing descriptions identify the product as UGC{Gen}.

WaveSpeed tools:

- `helios_list_wavespeed_models` searches the live catalog.
- `helios_get_wavespeed_model` returns a model's current request schema.
- `helios_generate_wavespeed` starts a billable image or video job.
- `helios_wait_for_job` waits for either a Kie or WaveSpeed job and returns its local output URL.

Identity production tools:

- `helios_list_identity_assets` and `helios_get_identity_asset` inspect saved identities and immutable version history.
- `helios_create_identity_asset`, `helios_update_identity_asset`, and `helios_delete_identity_asset` manage identity assets, their content class, and provider/model/aspect-ratio defaults.
- `helios_create_clone_workflow` creates either built-in scene-replacement or pose/outfit-batch workflow, optionally pre-bound to a saved identity snapshot and its compatible defaults.
- `helios_set_workflow_routing` stores an explicit SFW/adult provider and model route with the required adult/consent assurances.
- `helios_list_identity_batches`, `helios_get_identity_batch`, `helios_create_identity_batch`, and `helios_update_identity_batch` plan and track persistent concurrent batches.
- Image, video, WaveSpeed, and ledger tools accept or expose `identityAssetId` for end-to-end provenance.

Destructive workflow tools are marked with MCP `destructiveHint`; compatible clients can require confirmation. Provider API keys stay in UGC{Gen}'s local SQLite settings and are never returned by the MCP server.

Campaign tools:

- `helios_list_campaigns` and `helios_get_campaign` read campaign history, plans, runs, assets, and review states.
- `helios_create_campaign` creates an empty durable workspace.
- `helios_campaign_action` uses the same service as the UI for planning, identity selection/approval, plan authorization, generation advancement, pause/resume/stop, asset review, and campaign settings. Planning uses the configured text provider. Starting a plan authorizes its listed media calls; show the plan to the user before starting. The server worker advances authorized runs independently of any client. The same tool also supports versioned memory, budgets, discovery/selection of trend sources, caption revisions, and local publishing drafts. Use `queue-post` only after the user authorizes the exact assets, caption, accounts, and time. Budget dollars are estimates; generation counts are hard limits. Uncertain submissions are never automatically retried. See the tool description for request forms.

Research & adapt uses `director-start`, `director-approve`, `director-control`, and `director-advance` through `helios_campaign_action`. Read the campaign's `directors` array for source videos, frame evidence, assessments, selection, tool events, quota, and provider jobs. `director-start` takes `objective`, optional `sourceUrls`, `reels` (1–3), `stillsPerReel` (0–3), `searchProvider` (`tiktok` default: built-in live browser search, free; or `web`: OpenAI account web search), and optional `videoModel` (any Kie.ai model that accepts a reference video). Research authorizes up to four searches. Wait for `awaiting_approval`; show selected clips, background reuse, model route and bounded allowance before `director-approve` with `runId`, `maxGenerations`, optional `motionEstimateUsd`, and `referenceReuseConfirmed:true`. Automatic visual QA never authorizes publishing.
