<p align="center">
  <img src="public/ugc-gen-mark.svg" alt="UGC{Gen}" width="72" />
</p>

<h1 align="center">UGC{Gen}</h1>

<p align="center">
  <strong>Local-first AI production workflows for images, video, text, and reusable identities.</strong><br />
  Build, run, inspect, and automate generation pipelines on a visual canvas.
</p>

UGC{Gen} is a local-first desktop and browser application for building production-grade AI media workflows. This product extends the original HeliosGen canvas with live provider catalogs, identity dossiers, reusable production templates, cost and provenance tracking, community workflow imports, ComfyUI interoperability, and a writable MCP server for agent control.

The application, workflow database, settings, and generated-media library run locally. Generations still send the prompt and any required reference media to the provider you explicitly select, such as Kie.ai, WaveSpeed, Azure Foundry, or ComfyUI Cloud. Local ComfyUI and Codex CLI routes can remain on the machine, subject to their own configuration.

> The current product work is on the `codex/wavespeed-provider` branch. Use the source instructions below to run this version; an upstream release does not include the features documented here.

## Run locally

From an existing checkout, start the browser development app:

```bash
corepack enable
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). If an older UGC{Gen} process is already using port 3000, stop it with `Ctrl+C` in its terminal and run `pnpm dev` again from this directory.

API keys are normally added inside **Settings → API Keys**. They are stored in the local SQLite database and are never returned by the MCP server. `.env.local` is optional; see [`.env.example`](.env.example) for supported development fallbacks.

## Clone the current product branch

```bash
git clone --branch codex/wavespeed-provider https://github.com/TheMarcusLee/HeliosGen.git
cd HeliosGen
corepack enable
pnpm install
pnpm dev
```

Requirements:

- Node.js 22.13 or newer
- pnpm 9.15.9, selected through the repository's `packageManager` field
- Provider credentials for the remote services you choose to use

## What this fork adds

### Provider and model layer

- Kie.ai image, video, and text generation
- Authenticated WaveSpeed model discovery with a live image/video catalog
- Schema-generated WaveSpeed canvas controls, typed inputs, defaults, and validation
- Ordered compatible fallbacks and per-node estimated-cost ceilings
- Azure Foundry and optional Codex CLI routing for supported operations
- Local ComfyUI and ComfyUI Cloud API-workflow execution
- Persistent provider transaction ledger with provider, model, operation, estimate, status, fallback, workflow, identity, and output provenance

WaveSpeed models are discovered live instead of being frozen into the repository. After saving a WaveSpeed key, browse them in **Settings → Image Models** or **Settings → Video Models**, or add a WaveSpeed node to a workflow. The model's current request schema determines the controls shown on the canvas.

The configured text catalog currently includes:

- Anthropic: Opus 5, Sonnet 5, plus legacy Opus 4.7, Sonnet 4.6, and Haiku 4.5 compatibility
- OpenAI: GPT 5.6 Sol, GPT 5.6 Terra, GPT 5.6 Luna, GPT 5.5, GPT 5.4, and GPT 5.2
- Google: Gemini 3.8 Flash, 3.7 Flash, 3.6 Flash, 3.5 Flash, 3.1 Pro, and 3 Flash
- Azure Auto routing

Kie.ai image/video entries are maintained by the application catalog. The WaveSpeed portion is deliberately dynamic, so the provider's current model list is the source of truth.

### Identity layer

**Identities** is a first-class production asset library rather than a loose collection of prompt fields. Each dossier can contain:

- multiple face and body reference images
- a stable trigger word
- reusable base prompts (prompt DNA)
- explicit SFW or adult content classification
- provider, model, and aspect-ratio defaults
- immutable version snapshots used by linked workflows
- import/export JSON, workflow links, run activity, and provenance

Multiple images can be dropped into the reference area at once and classified individually as face or body references. Editing an identity creates a new version, so an existing workflow keeps its embedded snapshot until it is intentionally refreshed.

### Production workflows

Built-in CloneMe-style templates turn identities into repeatable production pipelines:

- **Scene replacement:** target scene → Opus 5 vision analysis → identity-aware prompt construction → provider generation → gallery and ledger output
- **Pose × outfit batch:** analyze once, cross-product selected poses and outfits, then execute with bounded concurrency
- Persistent queue states: idle, analysis, generation, completed, paused, and error
- Pause, resume, retry, and explicit per-item status tracking

Workflow metadata controls SFW/adult routing explicitly and auditably. UGC{Gen} does not infer adult capability from a model name. Provider rules still apply, and server-side validation rejects sexual content involving minors and non-consensual intimate imagery.

### Workflow portability and interoperability

- Node Banana community workflow browser and versioned converter
- ComfyUI workflows imported from **Save (API Format)**
- Portable workflow ZIP exports containing `workflow.json` and referenced media
- Prompt-template nodes, annotations, and non-destructive image markup
- Imported public Helios workflows remain editable on the native canvas

See [the implemented provider and workflow roadmap](docs/node-banana-review.md) for design notes and feature provenance.

## Agent control with MCP

The repository includes a local stdio MCP server with 37 read/write tools. It can inspect and mutate complete workflow graphs, manage identities and their versions, create production templates and batches, set explicit content routes, discover and run models, wait for jobs, import community workflows, execute ComfyUI graphs, and audit provider activity.

Keep UGC{Gen} running, then build the MCP server:

```bash
pnpm mcp:build
```

Example MCP client configuration:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/HeliosGen/mcp/dist/index.js"],
  "env": {
    "UGCGEN_BASE_URL": "http://127.0.0.1:3000"
  }
}
```

The default base URL is `http://127.0.0.1:3000`. Set `UGCGEN_BASE_URL` when the app uses another port. The legacy `HELIOSGEN_BASE_URL` variable remains supported for existing MCP configurations. See [the MCP guide](mcp/README.md) for the available tool groups and the configuration already used on this machine.

## Desktop app

For a native window with hot reload:

```bash
pnpm desktop:dev
```

The first run compiles the Rust/Tauri shell and can take a few minutes. Desktop development additionally requires Rust, the platform's Tauri prerequisites, and on macOS the Xcode Command Line Tools.

Build a packaged app on the target operating system:

```bash
pnpm desktop:build
```

Artifacts are written beneath `src-tauri/target/release/bundle/`. Tauri does not cross-compile, so macOS, Windows, and Linux packages must each be built on their target platform. See [DESKTOP.md](DESKTOP.md) for architecture, signing, local paths, and packaging details.

## Local data

Browser development stores data inside the checkout:

- SQLite data: `data/`
- generated media: `public/generated/`

The packaged desktop app stores its writable data in the operating system's app-data directory:

| Operating system | Location |
| --- | --- |
| macOS | `~/Library/Application Support/cash.sdd.helios.desktop/` |
| Windows | `%APPDATA%\cash.sdd.helios.desktop\` |
| Linux | `~/.local/share/cash.sdd.helios.desktop/` |

Back up the SQLite database and `generated/` directory before removing an app-data folder. Deleting it resets local workflows, identities, settings, history, and media.

## Optional local tools

Some operations use command-line tools from the login shell's `PATH`:

- `ffmpeg` and `ffprobe` for video trimming and frame extraction
- `codex` and `codex-imagegen` for the optional Codex CLI image route

Missing optional tools disable only their related feature. For the Codex route, install and authenticate the Codex CLI, install [`codex-imagegen-cli`](https://github.com/jdmnk/codex-imagegen-cli), then choose **Codex CLI** for GPT Image 2 in **Settings → Image Models**.

## Development checks

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm exec tsx --test tests/*.test.ts
pnpm mcp:build
pnpm build
```

## Fork maintenance

This repository deliberately keeps two remotes:

- `origin`: `https://github.com/TheMarcusLee/HeliosGen.git` — this product fork
- `upstream`: `https://github.com/SegFault42/HeliosGen.git` — the original project

Review upstream changes without modifying the current branch:

```bash
git fetch origin
git fetch upstream
git log --oneline --left-right --cherry-pick HEAD...upstream/main
```

Integrate useful upstream work through a dedicated branch or pull request, then run the full development checks. This keeps provider, identity, workflow-import, MCP, and local-data behavior reviewable instead of silently overwriting the product fork.

## Tech stack

| Layer | Technology |
| --- | --- |
| Desktop shell | Tauri 2 and Rust |
| Application | Next.js 16, React 19, and TypeScript |
| Workflow canvas | React Flow |
| Database | local SQLite through Node 22 `node:sqlite` |
| Media storage | local filesystem |
| Providers | Kie.ai, WaveSpeed, Azure Foundry, Codex CLI, and ComfyUI |
| Agent interface | Model Context Protocol over local stdio |

## Project lineage

UGC{Gen} is a maintained fork of [SegFault42/HeliosGen](https://github.com/SegFault42/HeliosGen). The original project provided the visual workflow foundation; this fork carries the provider expansion, identity production layer, workflow interoperability, cost/provenance controls, and writable agent interface described above.

## Licensing

The checkout does not currently contain a license file. Add or confirm the intended license before distributing binaries or accepting outside contributions.
