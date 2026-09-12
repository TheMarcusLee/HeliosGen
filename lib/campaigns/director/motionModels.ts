import { VIDEO_MODELS, type VideoModel } from "../../modelConfig";

/**
 * Motion adaptation can run on any Kie.ai video model that accepts a reference
 * video. Two request shapes exist and this module hides the difference:
 *  - motion control (Kling): anchor image + motion clip, follows the subject's motion.
 *  - reference video (Seedance, MiniMax, Gemini Omni): clip as a reference, anchor as
 *    first frame or identity reference.
 * Adding a model is a modelConfig entry; nothing here names a vendor.
 */
export const DEFAULT_MOTION_MODEL = "kling-3.0-motion-control";
export const MOTION_MODELS: VideoModel[] = VIDEO_MODELS.filter(m => m.handles.includes("videoRef") || m.handles.includes("referenceVideo"));
export function motionModel(id: string | undefined): VideoModel {
  const model = MOTION_MODELS.find(m => m.id === (id ?? DEFAULT_MOTION_MODEL));
  if (!model) throw new Error("Choose a video model that accepts a reference video for motion adaptation.");
  return model;
}
export interface ClipLimits { minSeconds: number; maxSeconds: number; minSide?: number; minRatio?: number; maxRatio?: number }
/** What the selected clip must satisfy before it is sent as a reference. */
export function clipLimits(model: VideoModel): ClipLimits {
  const { apiInput } = model;
  if (apiInput.useMotionControl) return { minSeconds: 3, maxSeconds: Math.min(10, apiInput.videoRefMaxDuration ?? 10), minSide: 341, minRatio: 0.4, maxRatio: 2.5 };
  if (apiInput.useGeminiOmniVideo) return { minSeconds: 3, maxSeconds: 10 }; // the route samples the first 10 seconds of a reference video
  const longest = apiInput.videoRefMaxDuration ?? (model.durations.length ? Math.max(...model.durations) : apiInput.durationMax > 0 ? apiInput.durationMax : 10);
  return { minSeconds: 3, maxSeconds: Math.min(30, longest) };
}
export function motionModelSummary(model: VideoModel) {
  const limits = clipLimits(model);
  return `${model.name} (${model.provider}) · ${model.defaultResolution ?? "default resolution"} · ${limits.minSeconds}–${limits.maxSeconds} second clip`;
}
/** How the model consumes the reference. Shown to the planning model so prompts fit the route. */
export function motionModelBehavior(model: VideoModel) {
  return model.apiInput.useMotionControl
    ? "It transfers the source subject's motion onto the anchor and keeps the source background."
    : "It uses the clip as a motion and pacing reference and the anchor as the first frame or identity reference; describe the scene and background in the prompt.";
}
export interface MotionRequest { prompt: string; anchorUrl: string; clipUrl: string; clipDuration: number; identityUrls: string[] }
/** Request body for /api/generate-video, shaped for the model's payload branch. */
export function motionRequestBody(model: VideoModel, input: MotionRequest): Record<string, unknown> {
  const { apiInput } = model;
  const base = { videoModel: model.id, prompt: input.prompt, resolution: model.defaultResolution };
  if (apiInput.useMotionControl) return { ...base, startFrameUrl: input.anchorUrl, videoRefUrl: input.clipUrl, mode: model.defaultMode ?? "video" };
  const aspectRatio = model.ratios.includes("9:16") ? "9:16" : model.ratios.includes("adaptive") ? "adaptive" : model.defaultRatio;
  const duration = model.durations.length ? model.durations.reduce((best, d) => Math.abs(d - input.clipDuration) < Math.abs(best - input.clipDuration) ? d : best) : undefined;
  const references = [input.anchorUrl, ...input.identityUrls];
  const withDuration = duration === undefined ? {} : { duration };
  if (apiInput.useMinimaxH3) return { ...base, referenceImageUrls: references.slice(0, model.maxResources ?? 9), referenceVideoUrls: [input.clipUrl], aspectRatio, ...withDuration };
  if (apiInput.useGeminiOmniVideo) return { ...base, referenceImageUrls: references.slice(0, 5), referenceVideoUrls: [input.clipUrl], aspectRatio };
  if (model.handles.includes("startFrame")) return { ...base, startFrameUrl: input.anchorUrl, referenceVideoUrls: [input.clipUrl], aspectRatio, ...withDuration };
  return { ...base, referenceImageUrls: references.slice(0, model.maxResources ?? 3), referenceVideoUrls: [input.clipUrl], aspectRatio, ...withDuration };
}
