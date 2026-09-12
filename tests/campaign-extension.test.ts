import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
process.env.HELIOS_DATA_DIR ??= mkdtempSync(join(tmpdir(), "ugc-extension-test-"));
process.env.HELIOS_MEDIA_DIR ??= mkdtempSync(join(tmpdir(), "ugc-extension-media-"));
test("the bundled browser extension is discoverable and installs to a stable app-data folder", async () => {
  const { GET, POST, installedExtensionDir } = await import("../app/api/campaigns/extension/route");
  const before = await (await GET()).json();
  assert.equal(before.available, true); assert.equal(before.installedPath, undefined); assert.match(before.bundledVersion, /^\d+\.\d+\.\d+$/);
  const installed = await (await POST(new NextRequest("http://localhost/api/campaigns/extension?reveal=0", { method: "POST" }))).json();
  assert.equal(installed.path, installedExtensionDir()); assert.ok(existsSync(join(installed.path, "manifest.json"))); assert.ok(existsSync(join(installed.path, "shared", "ugcgen-client.js")));
  const after = await (await GET()).json();
  assert.equal(after.installedPath, installedExtensionDir()); assert.equal(after.installedVersion, before.bundledVersion);
});
