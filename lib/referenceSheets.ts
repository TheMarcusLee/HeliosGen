/**
 * Reference sheet styles for a locked identity, ported from App Promo
 * Factory's influencer prompt generator. Each style is a scene the identity is
 * placed into, with the realism tokens that keep the result photographic, and
 * the reference kind the finished image should be filed under.
 */
export interface ReferenceStyle { id: string; label: string; description: string; aspectRatio: string; kind: "face" | "body"; scene: string; tokens: string }
const REALISM = "Photorealistic, no CGI, no 3D render, no cartoon/anime, no plastic skin, natural skin texture with pores visible, realistic lighting, subtle film grain, lifelike detail.";
export const REFERENCE_STYLES: ReferenceStyle[] = [
  { id: "comp-card", label: "Model comp card", description: "Front, three-quarter and profile full-body poses plus a beauty close-up on one white cyclorama canvas. The strongest single consistency reference.", aspectRatio: "3:4", kind: "body",
    scene: "A comprehensive model comp card layout: four distinct sections on a seamless white cyclorama studio background, professionally arranged: a full-body front pose, a full-body three-quarter angle pose, a full-body profile pose, and a beauty close-up from the shoulders up. Wearing a simple white ribbed tank top and classic blue jeans. Professional studio strobe lighting with soft shadows and even illumination across all poses. Neutral but approachable expression. NOT a video game character sheet: real model agency casting photos shot by a professional fashion photographer on a Canon EOS R5 with an 85mm portrait lens, RAW photo quality, no airbrushing, minimal retouching.",
    tokens: "Canon_EOS_R5.CR2, studio_strobe_lighting.fx, white_cyclorama.fx, natural_skin_pores, no_airbrushing, model_agency_photography.fx, minimal_retouching, RAW_photo_quality" },
  { id: "headshots", label: "Beauty headshot", description: "Tight face-and-shoulders framing on white seamless with butterfly lighting. Carries facial geometry.", aspectRatio: "3:4", kind: "face",
    scene: "A professional model headshot: tight beauty framing of the face and upper shoulders only, clean white seamless background, butterfly beauty lighting from a soft beauty dish, hair styled away from the face, natural minimal styling, neutral expression with a hint of a smile, looking straight into the lens. Real casting headshot by a professional photographer, RAW photo quality, no airbrushing.",
    tokens: "Canon_EOS_R5.CR2, beauty_lighting.fx, white_seamless.fx, natural_skin_pores, no_airbrushing, casting_headshot.fx, minimal_retouching, RAW_photo_quality" },
  { id: "turnaround", label: "Full-body turnaround", description: "Front, three-quarter, side and back views standing on white. Locks proportions and silhouette.", aspectRatio: "16:9", kind: "body",
    scene: "A 360-degree turnaround: the full body shown from four angles side by side (front, three-quarter, side profile, back) in a natural standing pose on a seamless white background with even studio lighting, wearing a simple fitted white tank top and blue jeans, cinematic photo-realism.",
    tokens: "studio_lighting.fx, turnaround_view.fx, white_background.fx, subsurface_scattering, cinematic_realism.fx" },
  { id: "expression-sheet", label: "Expression sheet", description: "Eight head-and-shoulder shots across emotions in an even grid. Useful for talking-head video.", aspectRatio: "4:3", kind: "face",
    scene: "An expression sheet: eight head-and-shoulders shots in an equally spaced grid showing joy, calm, surprise, focus, sadness, laughter, confidence and a neutral face, front view on a white background with soft studio lighting, identical hair and styling in every cell.",
    tokens: "studio_lighting.fx, expression_grid.fx, white_background.fx, subsurface_scattering, cinematic_realism.fx" },
  { id: "iphone-selfie", label: "iPhone selfie", description: "Casual first-person selfie in natural light. A face reference in the platform's native style.", aspectRatio: "9:16", kind: "face",
    scene: "A casual iPhone selfie taken from a first-person perspective at arm's length: natural window light, an intimate relaxed angle, a genuine easy expression, a simple everyday top, a softly blurred home interior behind. Don't show the phone. No text.",
    tokens: "iPhone14.Pro.front.cam, natural_grain.fx, selfie_angle.fx, casual_lighting.fx" },
  { id: "mirror-selfie", label: "Mirror selfie", description: "Full-length mirror shot in a clean modern space. A body reference with outfit and posture.", aspectRatio: "9:16", kind: "body",
    scene: "A full-length mirror selfie in a clean modern bedroom: the whole figure visible in the mirror, a stylish everyday outfit, phone held at chest height, soft natural window light, confident relaxed posture.",
    tokens: "IMG_5101.CR2, mirror_reflection.fx, natural_grain.fx, smartphone_quality.fx" },
  { id: "lifestyle-candid", label: "Lifestyle candid", description: "An unposed everyday moment in soft light, waist-up. Shows how the face reads in real scenes.", aspectRatio: "3:4", kind: "face",
    scene: "A candid lifestyle moment: waist-up, an everyday setting like a sunlit café or kitchen, a relatable outfit, a spontaneous unposed expression caught mid-moment, soft natural light, shallow depth of field with a gently blurred background.",
    tokens: "lifestyle_authentic.fx, candid_moment.fx, natural_lighting.fx, everyday_grain.fx" },
  { id: "golden-hour", label: "Golden-hour outdoors", description: "Warm backlit portrait in nature, three-quarter length.", aspectRatio: "3:4", kind: "body",
    scene: "An outdoor golden-hour portrait: three-quarter length in a park or garden, warm low sun creating a natural rim light on the hair and gentle shadows on the face, a flowing casual outfit, a serene genuine expression, dreamy bokeh from foliage behind.",
    tokens: "golden_hour.fx, natural_bokeh.fx, outdoor_atmosphere.fx, landscape_depth.fx" },
];
export const referenceStyle = (id: string) => REFERENCE_STYLES.find(s => s.id === id);
/** The full generation prompt for one style: the identity's locked description placed into the style's scene. */
export function referenceSheetPrompt(identity: { basePrompts: string[]; references: { url: string }[] }, style: ReferenceStyle): string {
  const person = identity.basePrompts.map(p => p.trim()).filter(Boolean).join(" ").slice(0, 2500) || "the person described by the reference images";
  const opener = identity.references.length ? `Create a photo of the same person from the reference images, keeping their exact face, features and proportions: ${person}` : `Create a photo of ${person}`;
  return `${opener}\n\n${style.scene}\n\n${REALISM} ${style.tokens}. No text, no watermarks, no logos.`;
}
