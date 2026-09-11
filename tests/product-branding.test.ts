import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sidebarSource = readFileSync(new URL("../components/AppSidebar.tsx", import.meta.url), "utf8");
const updateRouteSource = readFileSync(new URL("../app/api/update-check/route.ts", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const brandSource = readFileSync(new URL("../lib/brand.ts", import.meta.url), "utf8");
const desktopConfigSource = readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8");
const loadingSource = readFileSync(new URL("../src-tauri/loading/index.html", import.meta.url), "utf8");
const chatSource = readFileSync(new URL("../app/chat/page.tsx", import.meta.url), "utf8");

test("the product shell does not promote or query the upstream repositories", () => {
  assert.doesNotMatch(sidebarSource, /segfault42|workflowai/i);
  assert.doesNotMatch(updateRouteSource, /segfault42|workflowai/i);
  assert.doesNotMatch(sidebarSource, /api\.github\.com\/repos\//i);
});

test("updates target this fork and stay disabled without an application version", () => {
  assert.match(updateRouteSource, /TheMarcusLee\/HeliosGen/);
  assert.doesNotMatch(updateRouteSource, /CURRENT_VERSION\s*=.*\|\|\s*["']0\.0\.0["']/);
});

test("the browser and desktop shells use the UGC{Gen} product name", () => {
  assert.match(sidebarSource, /BrandWordmark/);
  assert.match(brandSource, /APP_NAME = "UGC\{Gen\}"/);
  assert.match(layoutSource, /title: APP_NAME/);
  assert.match(desktopConfigSource, /"productName": "UGC\{Gen\}"/);
  assert.match(desktopConfigSource, /"title": "UGC\{Gen\}"/);
  assert.match(loadingSource, /Starting UGC\{Gen\}/);
  assert.match(chatSource, /BrandIcon/);
  assert.doesNotMatch(chatSource, /HG\.svg/);
});
