# HeliosGen MCP server

This local stdio server lets an MCP-capable agent inspect and operate the running HeliosGen app. It includes workflow CRUD, node and edge editing, model discovery, text generation, image/video job creation, and job polling.

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

Destructive workflow tools are marked with MCP `destructiveHint`; compatible clients can require confirmation. The server never returns or stores the Kie API key.
