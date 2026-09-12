import https from "node:https";
import { lookup } from "node:dns";
import { BlockList, isIP } from "node:net";
import { uploadBuffer } from "../../guest/localStorage";
const privateNetworks = new BlockList();
for (const [ip, prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.168.0.0",16],["192.0.0.0",24],["198.18.0.0",15],["224.0.0.0",4],["240.0.0.0",4]] as const) privateNetworks.addSubnet(ip, prefix);
/** Resolve and pin a public IPv4 address on each request/redirect; never attach account/API credentials. */
export async function downloadPublic(url: string, limit = 100 * 1024 * 1024, redirects = 3): Promise<{ buffer: Buffer; contentType: string }> {
  const u = new URL(url);
  if (u.protocol !== "https:" || isIP(u.hostname.replace(/^\[|\]$/g, "")) || u.username || u.password || u.port || redirects < 0) throw new Error("Use a public HTTPS media URL.");
  return new Promise((resolve, reject) => {
    const req = https.get(u, { signal: AbortSignal.timeout(60000), lookup: (hostname, options, callback) => {
      lookup(hostname, { family: 4, all: true }, (error, addresses) => {
        if (error || !addresses?.length || addresses.some(a => privateNetworks.check(a.address))) { callback(new Error("Media host must resolve to a public address."), [], 4); return; }
        if (options.all) callback(null, addresses); else callback(null, addresses[0].address, 4);
      });
    } }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); void downloadPublic(new URL(res.headers.location, u).toString(), limit, redirects - 1).then(resolve, reject); return; }
      if (res.statusCode !== 200 || Number(res.headers["content-length"] ?? 0) > limit) { res.resume(); reject(new Error("Media download failed or exceeded its size limit.")); return; }
      let size = 0; const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => { size += chunk.length; if (size > limit) res.destroy(new Error("Media exceeds its size limit.")); else chunks.push(chunk); });
      res.on("error", reject); res.on("end", () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers["content-type"] ?? "application/octet-stream" }));
    });
    req.on("error", () => reject(new Error("Public media download failed or timed out.")));
  });
}
export async function storeMedia(url: string, folder: string, type: "image" | "video") {
  if (url.startsWith("/generated/")) return url;
  const result = await downloadPublic(url, (type === "image" ? 15 : 100) * 1024 * 1024);
  if (!result.contentType.startsWith(`${type}/`)) throw new Error(`Expected ${type} media.`);
  return uploadBuffer(result.buffer, result.contentType, folder);
}
