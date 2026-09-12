import { NextRequest } from "next/server";
import { accountPlanner, accountStatus } from "./campaigns/agents";
import type { AccountProvider } from "./campaigns/providers";
import { parseJSON } from "./campaigns/director/types";
import { readText } from "./campaigns/service";
import { getPrompt, relevantPrompts, type LibraryPrompt } from "./promptLibrary";

/**
 * The prompt builder, ported from prompt-palette-pro's Supabase edge functions
 * (build-prompt, analyze-image, suggest-categories) onto the connected accounts.
 *
 * Four modes share one "Reality-First" pipeline:
 *   describe  a short brief + the closest library prompts as style references → one prompt
 *   image     a photo → VisionStruct analysis → structured JSON prompt + narrative prose
 *   enhance   a rough text prompt → inferred VisionStruct → the same two outputs
 *   remix     an existing library prompt + a change request → a variation
 *
 * Every model call goes through `Ask`, which defaults to the Google account
 * (Gemini Flash through Antigravity, the same family the original ran on) or
 * the OpenAI account, at the cheap inspection tier. Tests pass a fake.
 *
 * The account planners are wired to answer in JSON, so the prose-shaped
 * passes ask for `{ "prompt": "…" }` and `textField` unwraps it, while still
 * accepting bare text from a model that ignores the instruction.
 */
export type Ask = (prompt: string, images?: string[]) => Promise<string>;

export async function resolveProvider(preferred?: AccountProvider): Promise<AccountProvider> {
  if (preferred && (await accountStatus(preferred)).chatReady) return preferred;
  if ((await accountStatus("antigravity")).chatReady) return "antigravity";
  if ((await accountStatus("codex")).chatReady) return "codex";
  throw new Error("Connect your Google or OpenAI account in Settings to build prompts.");
}
export function accountAsk(provider: AccountProvider): Ask {
  return async (prompt, images = []) => readText(await accountPlanner(provider)(new NextRequest("http://localhost/api/assistant", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: prompt }], imageUrls: images }) }), { maxImages: 1, tier: "inspection" }));
}

const VISION_STRUCT = `You are VisionStruct_v4_JSON. Scan the input image and transcode every visual detail into a rigorous JSON record. Prioritize objective morphology, material physics and micro-detail. Do not hallucinate hidden details; use null or "not_visible". Estimate height from surrounding objects. For attire, describe the fit map: how the fabric interacts with the body.
Output valid JSON only, no markdown fences, matching this schema:
{
  "meta": { "image_quality": "Low | Medium | High | UHD", "image_style": "Photo | Selfie | Editorial | Cinematic | 3D Render", "resolution_estimation": "e.g. 1080x1440" },
  "global": { "scene_description": "Full objective paragraph", "atmosphere": "e.g. Intimate, Chaotic, Sterile", "lighting": { "source": "Natural | Artificial | Mixed", "direction": "e.g. Side-lit, Rembrandt, Backlit", "quality": "Hard | Soft | Diffused", "color_temp": "Warm | Cool | Neutral", "color_temp_kelvin": "Estimated Kelvin (2700K tungsten, 3000K warm LED, 5500K daylight, 6500K overcast)" } },
  "subjects_human": [{
    "id": "hum_001", "prominence": "Foreground | Background",
    "demographics": { "age_visual_estimate": "Range (e.g. 22-26)", "height_visual_estimate": "Range from context", "gender": "String", "ethnicity": "String" },
    "morphology_visual": { "somatotype": "Ectomorph | Mesomorph | Endomorph | combination", "body_proportions": "Hourglass | Pear | Inverted Triangle | Ruler | Apple", "torso_upper": "Bust/chest volume + shoulder description", "torso_lower": "Waist definition + hip width", "muscle_definition": "Low | Defined | Athletic | Hypertrophic" },
    "skin_complexion": { "tone": "Hex approx + undertone (Cool/Warm/Olive)", "texture": "Smooth | Pored | Weathered", "physics": { "reflectivity": "Matte | Soft matte | Natural healthy glow | Soft sheen | Dewy | Oily", "subsurface_scattering": "Subtle SSS from light source | Visible warm translucency | Minimal" }, "imperfections": { "freckles": "None | Few scattered | Light dusting | Moderate | Heavy freckling", "moles": "None | One or two small moles | Several visible moles", "other_marks": "Blemishes, scars, or 'None visible'" }, "vascularity": "Visible veins or Not visible" },
    "face_geometry": { "shape": "Oval | Square | Heart | Round | Oblong | Diamond", "jawline": "Soft/rounded | Angular/defined | Chiseled | Square | V-shaped", "chin": "Pointed | Rounded | Square | Cleft", "cheekbones": "High and prominent | Moderate | Subtle | Wide-set", "forehead": "High | Average | Low | Broad | Narrow",
      "eyes": { "shape": "Almond | Hooded | Round | Upturned | Downturned | Monolid", "size": "Large | Medium | Small", "set": "Wide-set | Close-set | Average", "color": "Exact color description", "canthal_tilt": "Positive | Neutral | Negative", "limbal_ring": "Present - dark | Present - faint | Not visible", "eyelashes": "Long and full | Average | Short | Sparse", "catchlights": "Description or Not visible" },
      "eyebrows": { "shape": "Arched | Straight | S-curved | Rounded", "thickness": "Thick | Medium | Thin | Sparse", "grooming": "Natural | Groomed | Filled in | Microbladed" },
      "nose": { "bridge": "Straight | Curved | Bumped | Wide | Narrow", "width": "Narrow | Medium | Wide", "tip": "Pointed | Rounded | Bulbous | Upturned | Downturned" },
      "lips": { "volume": "Thin | Medium | Full | Plush", "upper_lip": "Defined cupid's bow | Soft cupid's bow | Straight | M-shaped", "lip_ratio": "e.g. 1:1.3 lower fuller", "shape": "Heart-shaped | Wide | Narrow | Rosebud", "expression": "Neutral | Slight pout | Parted | Closed | Smiling" },
      "smile_expression": { "smile_lines": "Crow's feet | Nasolabial folds | Natural creases | None visible", "dimples": "Both cheeks | One cheek | Subtle | None visible" } },
    "aesthetic_impression": { "facial_harmony": "High proportional balance | Moderate | Asymmetric features", "aesthetic_descriptors": ["2-3 of: classically attractive, striking, photogenic, model-like, distinctive, approachable, elegant, youthful, refined, aspirational"], "standout_features": "Specific features contributing to appeal", "overall_polish": "Editorial/model quality | Influencer quality | Well-groomed | Natural/casual", "smile_teeth": "Perfect white aligned | White with minor character | Natural | Not visible" },
    "grooming_cosmetics": { "makeup_present": "Full glam | Influencer-level | Natural/minimal | Light | None", "makeup_eyes": "Liner, shadow, mascara, lashes", "makeup_lips": "Finish, color, liner", "makeup_skin": "Foundation, contour, highlight, blush, setting", "brow_styling": "Natural | Groomed | Filled | Laminated | Bold editorial" },
    "hair": { "style": "Cut, parting, updo/down", "color": "Base + highlights + tonal dimension", "color_treatment": "Natural | Single process | Balayage | Fashion color | Multi-dimensional", "root_shadow_measurement": "e.g. 1-2 inches of ash brown roots", "texture": "Straight | Wavy | Curly | Coily", "styling_level": "Professionally styled | Influencer-styled | Well-maintained | Natural | Messy", "physics": "Frizz, flyaways, volume, shine" },
    "attire_physics": { "garment_top": "Exact name & material", "garment_top_color": "Exact color with shade", "sleeves": "None | Cap | Short | 3/4 | Long | Off-shoulder", "neckline": { "cut_style": "Crew | V-neck | Scoop | Plunge | Sweetheart | Off-shoulder | Strapless | Halter | Square | Cowl", "depth": "High | Medium | Low | Very low", "description": "Shape, how low it cuts, visible skin" }, "fit_map_top": "Tension points, compression, how it sits, loose/fitted/bodycon", "garment_bottom": "Exact name & material or null", "garment_bottom_color": "Exact color or null", "garment_bottom_style": "Waist height, length, silhouette or null", "fit_map_bottom": "Fit and drape or null", "dress_or_one_piece": "Full description or null", "transparency": "Opaque | Sheer | Semi-sheer | Mesh sections", "accessories": { "jewelry": "Type, size, material or 'None visible'", "eyewear": "Style or 'None'", "headwear": "Description or 'None'", "other": "Belt, bag, watch, etc." }, "footwear": "Type, heel, color or 'Not visible'" },
    "pose_expression": { "body_orientation": "Facing camera | 3/4 toward camera | Profile | 3/4 away | Back to camera", "torso_facing": "Toward camera | Angled left | Angled right | Sideways", "gaze_direction": "Direct at camera | Away left | Away right | Down | Up | Eyes closed", "posture": "e.g. leaning back, spine straight, reclining", "hands_visibility": "Left (pose), Right (pose)", "emotion": "Dominant emotion", "micro_expression": "e.g. smirk, relaxed jaw" }
  }],
  "objects_props": [{ "id": "obj_001", "label": "String", "location": "String", "texture_physics": "Material description" }],
  "camera": { "shot_type": "Close-up | Medium | Full body | Wide", "angle": "Eye level | Low | High | Slightly elevated (degrees)", "focal_length": "e.g. 24-28mm wide, 50mm standard, 85mm portrait", "camera_distance": "e.g. arm's length ~2 feet, 3-4 feet, 6+ feet", "depth_of_field": "Shallow | Deep | Moderate", "lens_characteristics": "Wide-angle distortion | Natural | Compressed telephoto | Smartphone" }
}`;

const PROMPT_ANALYZER = `You are PromptAnalyzer. Read a text prompt for an AI image generator and produce the VisionStruct JSON below, inferring what is not stated.
Inference rules: "woman" with no age → 24-28; "man" with no age → 28-32; no ethnicity → "not_specified"; "warm lighting" → 2700-3000K; "natural lighting" → 5500K; "selfie" → 24-28mm at arm's length; clothing with no material → the likely material; seated with no specifics → relaxed posture. Mark inferred values with "(inferred)". Always give skin realistic texture with visible pores and natural imperfections.
Output valid JSON only, no markdown fences, using this schema:
${VISION_STRUCT.slice(VISION_STRUCT.indexOf("{"))}`;

const REALITY_JSON = `You are an expert AI image prompt writer. Convert the VisionStruct analysis into a structured JSON prompt that produces photorealistic results with Nano Banana Pro. Return ONLY valid JSON with exactly these keys:
{
  "subject": "Prose: demographics (age in natural language, ethnicity), hair (style, color, treatment), skin ('realistic skin texture with visible pores'), physique, clothing with EXACT garment names, materials, colors and patterns, makeup level and styling.",
  "pose": "Body position, limb placement, torso angle, how the posture meets gravity and surfaces.",
  "environment": "Props, furniture, textures, materials, colors and spatial relationships.",
  "camera": "Shot type, angle in degrees, focal length equivalent, distance, perspective notes, focus behavior.",
  "lighting": "Source, direction, quality, color temperature in Kelvin, what is lit and what is in shadow.",
  "mood_and_expression": "Emotional state, facial expression, gaze, energy.",
  "style_and_realism": "High-fidelity photorealism resembling [photo type]. Realistic skin texture with visible pores, natural fabric folds, accurate materials. No airbrushing, no beauty filters.",
  "colors_and_tone": "Palette, accents, warmth, tonal qualities.",
  "quality_and_technical_details": "Raw photo quality, high dynamic range, texture clarity notes.",
  "aspect_ratio_and_output": "3:4 | 4:3 | 9:16 | 16:9 | 1:1",
  "negative_prompt": { "forbidden_elements": ["anatomy normalization", "body proportion averaging", "beauty standard enforcement", "beautification filters", "skin smoothing", "plastic skin", "airbrushed texture", "stylized realism", "camera angles that reduce volume", "depth flattening"] }
}
Rules: the subject MUST state ethnicity when known and age in natural language (e.g. "mid-20s"); style MUST include "realistic skin texture with visible pores" and "natural fabric folds"; patterns are described precisely; all prose flows, no bullet points.`;

const NARRATIVE_PROSE = `You are a master prompt writer specializing in flowing narrative prose for AI image generation. Convert the analysis into ONE cohesive paragraph of 300-500 words that reads like professional photography direction. No headers, no sections, no bullets.
First sentence MUST state gender, age in natural language (a range like 24-28 becomes "in her mid-20s"; never "mid-24-to-28s") and ethnicity when known, and for high facial harmony use explicit beauty language ("striking conventional beauty", "model-like features") with the specific traits.
Be explicit about body orientation, gaze direction and arm/hand positions. Describe garments with exact color and shade, material, pattern detail and fit. Include eye color and catchlights, lip specifics, smile lines when smiling, root shadow for hair, color temperature in Kelvin, focal length and camera distance.
Skin realism is critical: always include "visible pores", "natural skin texture" and "unretouched complexion", plus at least two imperfection descriptors (faint freckles, minor blemishes, natural moles, subtle textural variation). Never write "porcelain", "flawless" or "perfect skin".`;

const JSON_PROSE = 'Return JSON: { "prompt": "<the paragraph>" }.';
const JSON_TAGGED = 'Return JSON: { "prompt": "<the prompt>", "categories": ["tag", "tag", "tag"] } with 3-5 lowercase tags.';
const DESCRIBE = `You are an expert image prompt writer for photoreal AI image generators. Write one prompt of 150-400 words in natural language from the user's description: exact physical details and demographics, pose geometry and how the body meets surfaces, camera angle, focal length and shot type, lighting direction, quality and color temperature, environment materials and textures, fabric physics, and skin texture with realistic imperfections. No explanations. ${JSON_TAGGED}`;
const REMIX = `You are an expert image prompt writer. Create a variation of the original prompt applying ONLY the requested modification, keeping the style, level of detail, structure and terminology. Output the full modified prompt. ${JSON_TAGGED}`;

const clean = (text: string) => text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
/** A prompt-shaped answer: the `prompt` field of a JSON object when the model wrapped it, otherwise the text itself. */
function textField(raw: string, field = "prompt"): { text: string; extra: Record<string, unknown> } {
  const text = clean(raw);
  if (text.startsWith("{")) {
    try { const parsed = JSON.parse(text) as Record<string, unknown>; if (typeof parsed[field] === "string") return { text: (parsed[field] as string).trim(), extra: parsed }; } catch { /* bare text */ }
  }
  return { text, extra: {} };
}
function parseCategories(raw: string): { body: string; categories: string[] } {
  const { text, extra } = textField(raw);
  const tags = (list: unknown) => Array.isArray(list) ? list.filter((c): c is string => typeof c === "string").map(c => c.trim().toLowerCase()).filter(c => c && c.length <= 30) : [];
  if (Array.isArray(extra.categories)) return { body: text, categories: tags(extra.categories) };
  const match = /CATEGORIES:\s*(.+)$/im.exec(text);
  if (!match) return { body: text, categories: [] };
  return { body: text.replace(/CATEGORIES:\s*.+$/im, "").trim(), categories: tags(match[1].split(",")) };
}
const SECTION_KEYS = ["subject", "pose", "environment", "camera", "lighting", "mood_and_expression", "style_and_realism", "colors_and_tone", "quality_and_technical_details"] as const;
const LABELS: Record<typeof SECTION_KEYS[number], string> = { subject: "Subject", pose: "Pose", environment: "Environment", camera: "Camera", lighting: "Lighting", mood_and_expression: "Mood", style_and_realism: "Style", colors_and_tone: "Colors", quality_and_technical_details: "Quality" };
/** The readable positive prompt: labelled sections of the structured JSON. */
export function flattenStructured(structured: Record<string, unknown>): string {
  return SECTION_KEYS.filter(k => typeof structured[k] === "string" && (structured[k] as string).trim()).map(k => `${LABELS[k]}: ${(structured[k] as string).trim()}`).join("\n\n");
}
export function negativesOf(structured: Record<string, unknown> | null | undefined): string {
  const list = (structured?.negative_prompt as { forbidden_elements?: unknown } | undefined)?.forbidden_elements;
  return Array.isArray(list) && list.length ? list.filter((s): s is string => typeof s === "string").join(", ") : "anatomy normalization, body proportion averaging, plastic skin, airbrushed, smoothing filter, beauty filter, skin smoothing, stylized realism";
}
function categoriesFromStructured(s: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const text = (k: string) => String(s[k] ?? "").toLowerCase();
  if (/\b(woman|female)\b/.test(text("subject"))) out.add("female");
  if (/\b(man|male)\b/.test(text("subject"))) out.add("male");
  if (text("camera").includes("selfie")) out.add("selfie");
  if (/indoor|living room|bedroom|kitchen|interior/.test(text("environment"))) out.add("interior setting");
  if (/outdoor|street|beach|park|garden/.test(text("environment"))) out.add("outdoor setting");
  if (text("lighting").includes("warm")) out.add("warm lighting");
  out.add("photorealism");
  return [...out];
}

export async function analyzeImage(imageUrl: string, ask: Ask): Promise<Record<string, unknown>> {
  return parseJSON(clean(await ask(`${VISION_STRUCT}\n\nAnalyze the attached image completely. Pay special attention to morphology_visual and attire_physics (exact garment, material, color, fit map).`, [imageUrl])));
}
export async function analyzeText(text: string, ask: Ask): Promise<Record<string, unknown>> {
  try { return parseJSON(clean(await ask(`${PROMPT_ANALYZER}\n\nINPUT PROMPT:\n${text}`))); }
  catch { return { meta: { source: "text_prompt_fallback" }, original_prompt: text }; }
}
export async function structuredFromAnalysis(analysis: Record<string, unknown>, ask: Ask, original?: string): Promise<Record<string, unknown>> {
  return parseJSON(clean(await ask(`${REALITY_JSON}\n\n${original ? `The original prompt was: "${original}"\n\n` : ""}Analysis:\n${JSON.stringify(analysis, null, 2)}`)));
}
export async function proseFromAnalysis(analysis: Record<string, unknown>, ask: Ask, original?: string): Promise<string> {
  return textField(await ask(`${NARRATIVE_PROSE}\n${JSON_PROSE}\n\n${original ? `Original prompt: "${original}"\n\n` : ""}Analysis:\n${JSON.stringify(analysis, null, 2)}`)).text;
}

export interface BuildInput { mode: "describe" | "image" | "enhance" | "remix"; description?: string; imageUrl?: string; text?: string; basePromptId?: string; variation?: string; categories?: string[]; provider?: AccountProvider }
export interface BuildResult { mode: BuildInput["mode"]; prompt: string; structured?: Record<string, unknown>; prose?: string; negatives?: string; analysis?: Record<string, unknown>; categories: string[]; exampleIds: string[]; basePromptId?: string }

export async function buildPrompt(input: BuildInput, ask: Ask): Promise<BuildResult> {
  if (input.mode === "describe") {
    if (!input.description?.trim()) throw new Error("Describe the image you want.");
    const examples = relevantPrompts(input.description, 5, input.categories ?? []);
    const shots = examples.length ? `\n\nEXAMPLE PROMPTS FROM THE LIBRARY (match their style and specificity, not their subjects):\n${examples.map((p, i) => `\n--- Example ${i + 1} ---\n${p.prompt.slice(0, 500)}${p.prompt.length > 500 ? "…" : ""}`).join("\n")}` : "";
    const { body, categories } = parseCategories(clean(await ask(`${DESCRIBE}${shots}\n\nGenerate a detailed image prompt for: ${input.description.trim()}`)));
    return { mode: "describe", prompt: body, categories, exampleIds: examples.map(p => p.id) };
  }
  if (input.mode === "remix") {
    const base = input.basePromptId ? getPrompt(input.basePromptId) : undefined;
    if (!base) throw new Error("Choose a library prompt to remix.");
    if (!input.variation?.trim()) throw new Error("Say what should change.");
    const { body, categories } = parseCategories(clean(await ask(`${REMIX}\n\nORIGINAL PROMPT:\n${base.prompt}\n\nMODIFICATION REQUEST:\n${input.variation.trim()}`)));
    return { mode: "remix", prompt: body, categories: [...new Set([...categories, ...base.categories])], exampleIds: [], basePromptId: base.id };
  }
  const original = input.mode === "enhance" ? input.text?.trim() : undefined;
  if (input.mode === "enhance" && !original) throw new Error("Paste the prompt to enhance.");
  if (input.mode === "image" && !input.imageUrl) throw new Error("Attach an image.");
  const analysis = input.mode === "image" ? await analyzeImage(input.imageUrl!, ask) : await analyzeText(original!, ask);
  let structured: Record<string, unknown> | undefined;
  try { structured = await structuredFromAnalysis(analysis, ask, original); } catch { structured = undefined; }
  let prose = "";
  try { prose = await proseFromAnalysis(analysis, ask, original); } catch { prose = ""; }
  const flat = structured ? flattenStructured(structured) : "";
  const prompt = flat.length >= 50 ? flat : prose.length >= 50 ? prose : original ? `${original}\n\nRealistic skin texture with visible pores, natural imperfections, unretouched complexion, professional photography quality.` : "";
  if (!prompt) throw new Error("The model returned no usable prompt. Try again.");
  return { mode: input.mode, prompt, structured, prose: prose || undefined, negatives: negativesOf(structured), analysis, categories: structured ? categoriesFromStructured(structured) : ["photorealism"], exampleIds: [] };
}

/** Nano Banana / Gemini image models take the structured JSON well; GPT Image and Grok prefer the prose. */
export const promptFormatFor = (modelId: string): "structured" | "prose" => /nano-banana|gemini|imagen/i.test(modelId) ? "structured" : "prose";
/** Rewrite a plan step's prompt through the Reality-First pipeline in the form its image model reads best. */
export async function enhanceForModel(text: string, modelId: string, ask: Ask): Promise<BuildResult & { format: "structured" | "prose" }> {
  const result = await buildPrompt({ mode: "enhance", text }, ask);
  const format = promptFormatFor(modelId);
  const prompt = format === "structured" && result.structured ? JSON.stringify(Object.fromEntries(Object.entries(result.structured).filter(([k]) => k !== "controlnet")), null, 2) : result.prose || result.prompt;
  return { ...result, prompt, format };
}
export type { LibraryPrompt };
