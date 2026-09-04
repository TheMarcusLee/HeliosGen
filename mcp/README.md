# HeliosGen MCP server

This local stdio server lets an MCP-capable agent inspect and operate the running HeliosGen app through 37 read/write tools. It includes workflow CRUD, node and edge editing, identity/version management, CloneMe production templates and batch plans, explicit content routing, model discovery, text generation, image/video job creation, provider ledger auditing, community imports, ComfyUI execution, WaveSpeed catalog and generation tools, and job polling.

## Run

Start HeliosGen first, then build and run the server:

```sh
pnpm mcp:build
pnpm mcp:start
```

The server targets `http://127.0.0.1:3000` by default. Set `HELIOSGEN_BASE_URL` if the app is listening elsewhere.

Use this command in an MCP client configuration after building:

```json
{
  "command": "node",
  "args": ["/Users/marcuslee/Documents/projects/HeliosGen-product/mcp/dist/index.js"],
  "env": {
    "HELIOSGEN_BASE_URL": "http://127.0.0.1:3000"
  }
}
```

On this machine it is registered globally in Codex as `heliosgen`.

WaveSpeed tools:

- `helios_list_wavespeed_models` searches the live catalog.
- `helios_get_wavespeed_model` returns a model's current request schema.
- `helios_generate_wavespeed` starts a billable image or video job.
- `helios_wait_for_job` waits for either a Kie or WaveSpeed job and returns its local output URL.

Identity production tools:

- `helios_list_identity_assets` and `helios_get_identity_asset` inspect saved identities and immutable version history.
- `helios_create_identity_asset`, `helios_update_identity_asset`, and `helios_delete_identity_asset` manage identity assets.
- `helios_create_clone_workflow` creates either built-in scene-replacement or pose/outfit-batch workflow.
- `helios_set_workflow_routing` stores an explicit SFW/adult provider and model route with the required adult/consent assurances.
- `helios_list_identity_batches`, `helios_get_identity_batch`, `helios_create_identity_batch`, and `helios_update_identity_batch` plan and track persistent concurrent batches.

Destructive workflow tools are marked with MCP `destructiveHint`; compatible clients can require confirmation. Provider API keys stay in HeliosGen's local SQLite settings and are never returned by the MCP server.
