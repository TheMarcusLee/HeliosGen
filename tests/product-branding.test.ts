import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sidebarSource = readFileSync(new URL("../components/AppSidebar.tsx", import.meta.url), "utf8");
const updateRouteSource = readFileSync(new URL("../app/api/update-check/route.ts", import.meta.url), "utf8");

test("the product shell does not promote or query the upstream repositories", () => {
  assert.doesNotMatch(sidebarSource, /segfault42|workflowai/i);
  assert.doesNotMatch(updateRouteSource, /segfault42|workflowai/i);
  assert.doesNotMatch(sidebarSource, /api\.github\.com\/repos\//i);
});

test("updates target this fork and stay disabled without an application version", () => {
  assert.match(updateRouteSource, /TheMarcusLee\/HeliosGen/);
  assert.doesNotMatch(updateRouteSource, /CURRENT_VERSION\s*=.*\|\|\s*["']0\.0\.0["']/);
});
