import { db } from "../guest/sqlite";
export type Integration = "youtube" | "postbridge";
export function integrationKey(name: Integration): string | undefined {
  const row = db().prepare("SELECT value FROM settings WHERE key=?").get(`campaign_${name}_key`) as { value: string } | undefined;
  return row?.value || process.env[name === "youtube" ? "YOUTUBE_API_KEY" : "POSTBRIDGE_API_KEY"];
}
export function saveIntegrationKey(name: Integration, value: string) {
  if (value) db().prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(`campaign_${name}_key`, value);
  else db().prepare("DELETE FROM settings WHERE key=?").run(`campaign_${name}_key`);
}
export async function postBridge(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  const key = integrationKey("postbridge");
  if (!key) throw new Error("Connect PostBridge in Campaign controls first.");
  const response = await fetch(`https://api.post-bridge.com/v1${path}`, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45000), redirect: "error", cache: "no-store" });
  if (!response.ok) throw new Error(`PostBridge returned ${response.status}. Check account access and post requirements in PostBridge.`);
  return response.status === 204 ? {} : response.json();
}
export interface SocialAccount { id: number; username: string; platform: string; needs_reconnect: boolean; }
export async function socialAccounts(): Promise<SocialAccount[]> {
  const accounts: SocialAccount[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await postBridge(`/social-accounts?limit=100&offset=${offset}`);
    accounts.push(...page.data);
    if (!page.meta?.next) break;
  }
  return accounts;
}
