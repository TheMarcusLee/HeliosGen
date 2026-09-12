import { randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep, basename } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { MEDIA_DIR } from "../guest/paths";
import { getCampaign, saveCampaign } from "./db";
import { claimLease } from "./lease";
import { postBridge, socialAccounts } from "./integrations";
import type { CampaignPost } from "./operations";
export const postDraftSchema = z.object({ assetIds: z.array(z.string()).min(1).max(10), caption: z.string().trim().min(1).max(5000), accountIds: z.array(z.number().int().positive()).min(1).max(10), scheduledAt: z.string().datetime({ offset: true }) });
export function draftPost(id: string, input: z.infer<typeof postDraftSchema>) {
  const c = getCampaign(id);
  input = postDraftSchema.parse(input);
  if (input.assetIds.some(a => !c.assets.some(asset => asset.id === a && asset.review === "approved" && asset.kind !== "text" && asset.url))) throw new Error("Only approved image or video assets can be scheduled.");
  c.posts ??= [];
  c.posts.push({ ...input, assetIds: [...new Set(input.assetIds)], accountIds: [...new Set(input.accountIds)], id: randomUUID(), status: "draft", createdAt: Date.now() });
  return saveCampaign(c);
}
export function queuePost(id: string, postId: string) {
  const c = getCampaign(id), post = c.posts?.find(p => p.id === postId);
  if (!post) throw new Error("Post not found.");
  if (post.status !== "draft") return c;
  if (Date.parse(post.scheduledAt) < Date.now() + 120000) throw new Error("Schedule at least two minutes in the future.");
  if (post.assetIds.some(id => c.assets.find(a => a.id === id)?.review !== "approved")) throw new Error("All post assets must still be approved.");
  post.status = "queued"; post.approvedAt = Date.now();
  return saveCampaign(c);
}
function updatePost(id: string, postId: string, patch: Partial<CampaignPost>) {
  const c = getCampaign(id), post = c.posts?.find(p => p.id === postId);
  if (!post) throw new Error("Post not found.");
  Object.assign(post, patch); return saveCampaign(c);
}
export async function uploadPostMedia(url: string): Promise<{ media?: string; url?: string }> {
  if (url.startsWith("https://")) return { url };
  if (!url.startsWith("/generated/")) throw new Error("Unsupported media location.");
  const root = await realpath(MEDIA_DIR);
  const path = await realpath(resolve(root, decodeURIComponent(url.slice(11))));
  if (!path.startsWith(root + sep)) throw new Error("Invalid media path.");
  let data: Buffer = await readFile(path);
  if (data.length > 150 * 1024 * 1024) throw new Error("Use a media file smaller than 150 MB.");
  let name = basename(path); const mime = /\.mp4$/i.test(name) ? "video/mp4" : /\.mov$/i.test(name) ? "video/quicktime" : "image/png";
  if (mime === "image/png") { data = await sharp(data).png().toBuffer(); name = name.replace(/\.[^.]+$/, "") + ".png"; }
  const upload = await postBridge("/media/create-upload-url", { mime_type: mime, size_bytes: data.length, name });
  if (!upload.media_id || !upload.upload_url || new URL(upload.upload_url).protocol !== "https:") throw new Error("PostBridge returned an invalid upload target.");
  const response = await fetch(upload.upload_url, { method: "PUT", body: new Uint8Array(data), headers: { "Content-Type": mime }, signal: AbortSignal.timeout(120000), redirect: "error" });
  if (!response.ok) throw new Error("PostBridge media upload failed.");
  return { media: upload.media_id };
}
export interface PublishingAdapter { accounts: typeof socialAccounts; upload: typeof uploadPostMedia; request: typeof postBridge; }
const adapter: PublishingAdapter = { accounts: socialAccounts, upload: uploadPostMedia, request: postBridge };
export async function advancePublishing(id: string, api = adapter) {
  const release = claimLease(`publishing:${id}`);
  if (!release) return;
  try {
    const c = getCampaign(id);
    for (const post of c.posts ?? []) {
      if (post.status === "submitting") { updatePost(id, post.id, { status: "uncertain", error: "Submission was interrupted. Check PostBridge before creating another post; it may already be scheduled." }); continue; }
      if (["scheduled", "processing"].includes(post.status) && post.providerId && Date.now() - (post.checkedAt ?? 0) > 60000) {
        try {
          const result = await api.request(`/posts/${encodeURIComponent(post.providerId)}`);
          if (["scheduled", "processing", "posted", "failed"].includes(result.status)) updatePost(id, post.id, { status: result.status, checkedAt: Date.now(), error: result.status === "failed" ? "Publishing failed. Review platform results in PostBridge." : undefined });
        } catch { updatePost(id, post.id, { checkedAt: Date.now(), error: "Could not refresh PostBridge status. Will retry." }); }
        continue;
      }
      if (post.status !== "queued") continue;
      // Persist before network work. Never repeat an uncertain create-post request.
      updatePost(id, post.id, { status: "submitting" });
      let submittingPost = false;
      try {
        if (Date.parse(post.scheduledAt) < Date.now() + 60000) throw new Error("Scheduled time has passed or is too close. Create a new draft with a later time.");
        const accounts = await api.accounts();
        if (post.accountIds.some(id => !accounts.some(a => a.id === id && !a.needs_reconnect))) throw new Error("A selected social account is unavailable or needs reconnection.");
        const assets = post.assetIds.map(id => getCampaign(c.id).assets.find(a => a.id === id));
        if (assets.some(a => !a?.url || a.review !== "approved")) throw new Error("Post assets must remain approved.");
        const media = await Promise.all(assets.map(a => api.upload(a!.url!)));
        // The API ignores media_urls when media is present; do not send a mixed set.
        if (media.some(m => m.media) && media.some(m => m.url)) throw new Error("Use either uploaded local assets or hosted assets in one post, not a mixture.");
        if (Date.parse(post.scheduledAt) < Date.now() + 30000) throw new Error("Upload finished too close to the scheduled time. Choose a later time.");
        if (post.assetIds.some(assetId => getCampaign(id).assets.find(a => a.id === assetId)?.review !== "approved")) throw new Error("Asset approval changed during upload. Review the assets before scheduling again.");
        release.assertOwned();
        submittingPost = true;
        const result = await api.request("/posts", { caption: post.caption, social_accounts: post.accountIds, scheduled_at: post.scheduledAt, is_draft: false, processing_enabled: true, ...(media[0]?.media ? { media: media.map(m => m.media) } : { media_urls: media.map(m => m.url) }) });
        if (!result.id) throw new Error("No post ID returned.");
        release.assertOwned();
        updatePost(id, post.id, { providerId: result.id, status: ["posted", "processing", "failed"].includes(result.status) ? result.status : "scheduled", checkedAt: Date.now(), error: undefined });
      } catch (e) { release.assertOwned(); updatePost(id, post.id, { status: submittingPost ? "uncertain" : "failed", error: submittingPost ? "PostBridge submission could not be confirmed. Check PostBridge before creating another post." : (e as Error).message }); }
    }
  } finally { release(); }
}
export async function cancelPost(id: string, postId: string) {
  const release = claimLease(`publishing:${id}`);
  if (!release) throw new Error("Publishing is updating. Try again shortly.");
  try {
    const post = getCampaign(id).posts?.find(p => p.id === postId);
    if (!post) throw new Error("Post not found.");
    if (["submitting", "uncertain", "processing", "posted"].includes(post.status)) throw new Error("Manage this post in PostBridge; its publishing state cannot be safely cancelled here.");
    if (post.providerId) await postBridge(`/posts/${encodeURIComponent(post.providerId)}`, undefined, "DELETE");
    return updatePost(id, postId, { status: "cancelled" });
  } finally { release(); }
}
