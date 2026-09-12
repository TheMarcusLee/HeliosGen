import { randomUUID } from "node:crypto";
import { db } from "../guest/sqlite";
/** SQLite fencing across server instances. A live holder renews during long calls. */
export function claimLease(key: string, now = Date.now(), duration = 120000) {
  const d = db();
  d.exec("CREATE TABLE IF NOT EXISTS campaign_leases (key TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL)");
  const owner = randomUUID();
  const result = d.prepare("INSERT INTO campaign_leases VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET owner=excluded.owner, expires=excluded.expires WHERE campaign_leases.expires < ?").run(key, owner, now + duration, now);
  if (!result.changes) return null;
  const heartbeat = setInterval(() => d.prepare("UPDATE campaign_leases SET expires=? WHERE key=? AND owner=?").run(Date.now() + duration, key, owner), duration / 3);
  heartbeat.unref();
  const release = () => { clearInterval(heartbeat); d.prepare("DELETE FROM campaign_leases WHERE key=? AND owner=?").run(key, owner); };
  release.assertOwned = () => {
    const row = d.prepare("SELECT owner, expires FROM campaign_leases WHERE key=?").get(key) as { owner: string; expires: number } | undefined;
    if (row?.owner !== owner || row.expires < Date.now()) throw new Error("Worker lease expired; another worker will recover this operation.");
  };
  return release;
}
