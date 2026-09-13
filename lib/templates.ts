import type { Node, Edge } from "@xyflow/react";
import type { NodeData } from "./store";
import { edgeStyle } from "./edgeStyles";
import type { WorkflowMetadata } from "./cloneMe";

// ── UGC starter: 4× Image Gen → 4× Video Gen ─────────────────────────────────
// Two independent columns, each stacked vertically:
//
//   T5   T6   T7   T8    ← y=-150  (video prompt above its video gen)
//   VG1  VG2  VG3  VG4   ← y=0
//
//   IG1  IG2  IG3  IG4   ← y=620   (images pre-loaded as "done")
//   T1   T2   T3   T4    ← y=1200  (image prompt below its image gen)
//
// Connections:
//   T[1-4] → IG[1-4].prompt
//   IG[1-4] → VG[1-4].startFrame
//   T[5-8]  → VG[1-4].prompt

const STRIDE_X = 380;
const X_OFFSET = 310;

const REF_IMAGES = [
  "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/1.png",
  "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/2.png",
  "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/3.png",
  "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/4.png",
];

const REF_VIDEOS = [
  "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/1.mp4",
  "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/2.mp4",
  "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/3.mp4",
  "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/4.mp4",
];

const IMG_PROMPTS = [
  "A photorealistic portrait. It features the specific young woman  She is relaxing leisurely in a luxurious overwater bungalow cabana in the Maldives. She is lying back on white linen cushions, looking calmly out over a stunning turquoise infinity pool that seamlessly merges with the clear ocean. She wears an elegant black swimsuit (consistent with her classy aesthetic) and her signature gold hoop earrings. She is looking toward the camera with a peaceful, knowing expression of automated income/freedom. Bright, sunny natural lighting; shallow depth of field focusing sharply on her face and expression. She seats if front of the camera, to speak for a vlog",
  "A photorealistic medium close-up shot. It features the specific young woman. She is seated comfortably and elegantly inside a luxurious First-Class airplane suite (Emirates A380 style), featuring rich wood paneling and gold accents.  Her signature gold jewelry and a refined black top are visible. Soft, diffused daylight from the aircraft windows illuminates her features. The shot emphasizes productiveness within high luxury. She seats if front of the camera, to speak for a vlog. I want the girl to hold the camera in selfie mode like. No overlay ",
  "A photorealistic close-up portrait. View from inside the car, smiling girl. It features the specific young woman. She is seated in the driver's seat of a high-end luxury supercar (like a Lamborghini Aventador). She is looking directly and intensely at the camera with an expression of urgency and focused determination. She wears the black top and gold hoop earrings. The interior of the car is dark, accented by dramatic red and blue LED dashboard lights and the ambient glow of passing city lights reflecting on the windshield. Cinematic lighting, dramatic shadows on her face, shallow depth of field, sharp focus on the eyes",
  "A photorealistic, cinematic close-up shot, serving as the first frame of a video. It features the specific young woman .  She is seated at a table in a stylish, modern restaurant. A smartphone is placed on a small tripod on the table directly in front of her, filming in vlog style.  She looks directly into the camera with a confident, engaging expression, about to speak. Her posture is relaxed yet intentional, as if recording a personal vlog.  The background shows a softly blurred restaurant ambiance: warm lighting, subtle movement, tables, and guests out of focus, creating a cozy, premium atmosphere with bokeh highlights.  Lighting: Warm, natural indoor lighting with soft highlights on her face and gentle shadows. Skin texture remains natural and detailed.  Camera & framing: Close-up shot, eye-level angle Camera is static on the tripod (no movement) Slight natural micro-movements from the subject (breathing, minimal head motion) High depth of field on the face, background softly blurred  Do not alter facial proportions, eye shape, or hairstyle.  Visual quality: Ultra-realistic, cinematic rendering 4K resolution, ultra HD Sharp focus on subject, rich details Natural colors, balanced contrast Professional vlog-style aesthetic",
];

const VID_PROMPTS = [
  `Static, locked-off shot using the exact same framing as the reference  @Image Generator #1 .
Do not alter facial proportions, eye shape, or hairstyle.
Subject faces the camera directly in a vlog style.

Natural skin texture, soft highlights, and subtle shadows.

She speaks directly to the camera with a calm, confident, and slightly persuasive tone:
"You officially have zero excuses left not to make content. Why? Because I'm not even real. I'm an AI avatar created by Ramzi, and this is the exact workflow to make videos just like this."

Micro-expressions:
Slight eyebrow raise on each key clause
Controlled pauses between sentences
Brief stillness of the face during pauses for emphasis

Camera remains completely stable (no movement, no zoom).
No changes in framing throughout the clip.
Visual quality:
4K resolution, ultra HD
Sharp clarity with cinematic texture
Natural colors, balanced contrast
Professional, stable image with high detail`,

  `Handheld selfie shot, subject holding the phone at arm's length in vertical framing.
Natural micro-movements from the hand (very subtle sway, slight breathing motion), maintaining a stable and clean composition.
Framing remains consistent with the reference image (same angle, same composition).
Do not alter facial proportions, eye shape, or hairstyle.
Subject looks directly into the camera in a vlog-style setup.
Natural skin texture, soft highlights, and subtle shadows.
She speaks directly to the camera with a calm, confident, smiling, and slightly persuasive tone:
"First, get a photo of your AI avatar.
Second, write a prompt to place your avatar anywhere—like a private jet, or wherever you want.
Third, add a short script… and generate multiple videos in seconds."
Micro-expressions:
Slight eyebrow raise on each key clause
Controlled pauses between sentences
Brief stillness of the face during pauses for emphasis
Camera behavior:
Handheld selfie mode
Subtle natural micro-movements (no jitter, no aggressive shake)
No zoom or reframing
Visual quality:
4K resolution, ultra HD
Sharp clarity with cinematic texture
Natural colors, balanced contrast
Professional, clean image with high detail`,

  `Handheld shot filmed by another person, camera positioned at eye level.
only the girl is visible.
Slight natural handheld micro-movements (very subtle sway, no shake or jitter).
Framing remains consistent throughout the clip (no zoom, no reframing).
Do not alter facial proportions, eye shape, or hairstyle.
Natural skin texture, soft highlights, and gentle shadows.

She looks directly into the camera, speaking with a confident, clear, and slightly persuasive tone:
"You now have the ultimate workflow to post a brand new video every single day.
Pick your niche, generate your AI video, and let the system do the heavy lifting for your brand."
Micro-expressions:
Subtle eyebrow lift on key phrases
Light smile to convey confidence and ease
Natural pauses between sentences
Minimal head movement for realism
Camera behavior:
Handheld by another person
Slight micro-movements only (no aggressive motion)
Stable, professional feel
Visual quality:
4K resolution, ultra HD
Sharp clarity with cinematic texture
Natural colors, balanced contrast
High detail, clean and professional image`,

  `Handheld shot filmed by another person, camera positioned at eye level.
only the girl is visible.
Slight natural handheld micro-movements (very subtle sway, no shake or jitter).
Framing remains consistent throughout the clip (no zoom, no reframing).
Do not alter facial proportions, eye shape, or hairstyle.
Natural skin texture, soft highlights, and gentle shadows.

The girl is approaching her head to the camera during one second like she just noticed that she is filmed. And she says :
"This is exactly how you bring in views, leads, and paying clients on autopilot. The tools are right here. Comment AI if you want to make videos like this"

Micro-expressions:
Subtle eyebrow lift on key phrases
Light smile to convey confidence and ease
Natural pauses between sentences
Minimal head movement for realism
Camera behavior:
Handheld by another person
Slight micro-movements only (no aggressive motion)
Stable, professional feel
Visual quality:
4K resolution, ultra HD
Sharp clarity with cinematic texture
Natural colors, balanced contrast
High detail, clean and professional image`,
];

export function makeUGCTemplate(): {
  nodes: Node<NodeData>[];
  edges: Edge[];
  nodeCounters: Record<string, number>;
} {
  const nodes: Node<NodeData>[] = [];
  const edges: Edge[] = [];

  for (let i = 0; i < 4; i++) {
    const base = i * STRIDE_X;
    const ptImgId = `tpl-pt-${i + 1}`;
    const igId = `tpl-ig-${i + 1}`;
    const ptVidId = `tpl-pv-${i + 1}`;
    const vgId = `tpl-vg-${i + 1}`;

    // Text node for video gen — sits above its video gen node
    nodes.push({
      id: ptVidId,
      type: "promptNode",
      position: { x: base + X_OFFSET * 2, y: -430 },
      style: { width: 260, height: 390 },
      data: { label: `Text #${i + 5}`, status: "idle", prompt: VID_PROMPTS[i] },
    });

    // Video gen node — seedance-2, 9:16, 1080p, sound on
    nodes.push({
      id: vgId,
      type: "videoGeneratorNode",
      position: { x: base + X_OFFSET * 2, y: 0 },
      style: { width: 320, height: 220 },
      data: {
        label: `Video Generator #${i + 1}`,
        status: "done",
        videoModel: "seedance-2",
        aspectRatio: "9:16",
        grokResolution: "1080p",
        sound: true,
        videoUrl: REF_VIDEOS[i],
      },
    });

    // Image gen node — image pre-loaded as a "done" output so the node
    // displays the image and the startFrame edge carries the URL.
    nodes.push({
      id: igId,
      type: "generateNode",
      position: { x: base, y: 620 },
      style: { width: 280, height: 280 },
      data: {
        label: `Image Generator #${i + 1}`,
        status: "done",
        model: "nano-banana-pro",
        aspectRatio: "9:16",
        quality: "2k",
        imageUrl: REF_IMAGES[i],
        r2Url: REF_IMAGES[i],
      },
    });

    // Text node for image gen — sits below its image gen node
    nodes.push({
      id: ptImgId,
      type: "promptNode",
      position: { x: base, y: 1200 },
      style: { width: 260, height: 390 },
      data: { label: `Text #${i + 1}`, status: "idle", prompt: IMG_PROMPTS[i] },
    });

    edges.push({
      id: `tpl-e-pt${i + 1}-ig${i + 1}`,
      source: ptImgId,
      target: igId,
      targetHandle: "prompt",
      animated: false,
      style: edgeStyle("prompt"),
    });

    edges.push({
      id: `tpl-e-ig${i + 1}-vg${i + 1}`,
      source: igId,
      target: vgId,
      targetHandle: "startFrame",
      animated: false,
      style: edgeStyle("startFrame"),
    });

    edges.push({
      id: `tpl-e-pv${i + 1}-vg${i + 1}`,
      source: ptVidId,
      target: vgId,
      targetHandle: "prompt",
      animated: false,
      style: edgeStyle("prompt"),
    });
  }

  // ── Avatar image asset node — single source connected to all 4 IG ref inputs ──
  const avatarId = "tpl-avatar";
  nodes.push({
    id: avatarId,
    type: "imageInputNode",
    position: { x: -380, y: 160 },
    style: { width: 260 },
    data: {
      label:             "Avatar",
      status:            "idle",
      r2Url:             "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/avatar.png",
      imageNaturalRatio: "9 / 16",
    },
  });

  for (let i = 0; i < 4; i++) {
    edges.push({
      id: `tpl-e-avatar-ig${i + 1}`,
      source: avatarId,
      target: `tpl-ig-${i + 1}`,
      targetHandle: "image",
      animated: false,
      style: edgeStyle("image"),
    });
  }

  return {
    nodes,
    edges,
    nodeCounters: { promptNode: 8, generateNode: 4, videoGeneratorNode: 4, imageInputNode: 1 },
  };
}

export function makeSceneReplacementTemplate(): {
  nodes: Node<NodeData>[];
  edges: Edge[];
  nodeCounters: Record<string, number>;
  metadata: WorkflowMetadata;
} {
  const nodes: Node<NodeData>[] = [
    { id: "clone-identity", type: "identityMatrixNode", position: { x: 0, y: 0 }, style: { width: 400, height: 620 }, data: { label: "IDENTITY", status: "idle", variableName: "identity" } },
    { id: "clone-scene", type: "imageInputNode", position: { x: 0, y: 700 }, style: { width: 260 }, data: { label: "TARGET SCENE", status: "idle" } },
    { id: "clone-analysis-instruction", type: "promptNode", position: { x: 470, y: 700 }, style: { width: 360, height: 220 }, data: { label: "VISION INSTRUCTION", status: "idle", prompt: "Analyze the target scene for camera angle, composition, lighting, lens/depth of field, pose, wardrobe, environment, and color grade. Describe only the visual facts needed to recreate it with another adult subject." } },
    { id: "clone-analysis", type: "assistantNode", position: { x: 900, y: 620 }, style: { width: 320, height: 300 }, data: { label: "SCENE ANALYSIS", status: "idle", variableName: "analysis", model: "claude-opus-5", systemPrompt: "You are a precise visual analyst. Analyze the supplied image and answer the user's requested visual categories. Do not identify people or infer sensitive traits. Return concise production-ready scene facts only." } },
    { id: "clone-template", type: "templateNode", position: { x: 900, y: 180 }, style: { width: 380, height: 330 }, data: { label: "IDENTITY PROMPT", status: "idle", template: "@identity\n\nRecreate this target scene with the referenced adult identity.\n@analysis\n\nPreserve identity and natural anatomy. Match the scene composition without copying text, logos, or watermarks." } },
    { id: "clone-generate", type: "generateNode", position: { x: 1380, y: 250 }, style: { width: 320, height: 420 }, data: { label: "GALLERY OUTPUT", status: "idle", model: "nano-banana-2", aspectRatio: "9:16", quality: "2k" } },
    { id: "clone-note", type: "commentNode", position: { x: 1380, y: 720 }, style: { width: 320, height: 150 }, data: { label: "OUTPUT", status: "idle", comment: "Successful generations are written to the Gallery automatically with workflow and provider provenance." } },
  ];
  const edge = (id: string, source: string, target: string, targetHandle: string, sourceHandle?: string): Edge => ({ id, source, target, sourceHandle, targetHandle, animated: false, style: edgeStyle(targetHandle) });
  return {
    nodes,
    edges: [
      edge("clone-e-instruction", "clone-analysis-instruction", "clone-analysis", "prompt"),
      edge("clone-e-scene-vision", "clone-scene", "clone-analysis", "image"),
      edge("clone-e-identity-prompt", "clone-identity", "clone-template", "text", "promptOut"),
      edge("clone-e-analysis-template", "clone-analysis", "clone-template", "text"),
      edge("clone-e-template-generate", "clone-template", "clone-generate", "prompt", "textOut"),
      edge("clone-e-identity-references", "clone-identity", "clone-generate", "image", "referencesOut"),
      edge("clone-e-scene-generate", "clone-scene", "clone-generate", "image"),
    ],
    nodeCounters: { identityMatrixNode: 1, imageInputNode: 1, promptNode: 1, assistantNode: 1, templateNode: 1, generateNode: 1, commentNode: 1 },
    metadata: { contentClass: "sfw", routingRequired: true, routes: { sfw: { provider: "kie", modelId: "nano-banana-2" } } },
  };
}

export function makePoseOutfitBatchTemplate(): {
  nodes: Node<NodeData>[];
  edges: Edge[];
  nodeCounters: Record<string, number>;
  metadata: WorkflowMetadata;
} {
  const scene = makeSceneReplacementTemplate();
  const keep = new Set(["clone-identity", "clone-scene", "clone-analysis-instruction", "clone-analysis"]);
  const nodes = scene.nodes.filter((node) => keep.has(node.id));
  nodes.push({
    id: "clone-batch", type: "batchQueueNode", position: { x: 1380, y: 300 }, style: { width: 420, height: 680 },
    data: {
      label: "POSE × OUTFIT QUEUE", status: "idle", batchProvider: "wavespeed", batchConcurrency: 3,
      batchPoses: ["Standing, three-quarter view", "Seated, looking into camera", "Walking toward camera"],
      batchOutfits: ["Black evening look", "White linen set", "Casual premium streetwear"],
      batchScene: "Recreate the analyzed target scene while varying only pose and outfit.",
    },
  });
  const edges = scene.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target));
  edges.push(
    { id: "clone-e-identity-batch", source: "clone-identity", sourceHandle: "promptOut", target: "clone-batch", targetHandle: "identity", animated: false, style: edgeStyle("image") },
    { id: "clone-e-analysis-batch", source: "clone-analysis", target: "clone-batch", targetHandle: "analysis", animated: false, style: edgeStyle("prompt") },
  );
  return {
    nodes,
    edges,
    nodeCounters: { identityMatrixNode: 1, imageInputNode: 1, promptNode: 1, assistantNode: 1, batchQueueNode: 1 },
    metadata: { contentClass: "sfw", routingRequired: true, routes: {} },
  };
}

// ── Identity-driven templates ────────────────────────────────────────────────
// Every template below starts from the same IDENTITY node (id "clone-identity"),
// so /api/clone-templates can pre-fill it with a saved identity and the
// identity library can launch any of them for a person. Prompts are template
// nodes that splice the identity's prompt DNA in with @identity; generators
// receive the identity's reference images through the referencesOut handle.
import { REFERENCE_STYLES, referenceStyle } from "./referenceSheets";

export interface IdentityTemplateInfo { id: string; name: string; description: string; menuLabel: string }
export const IDENTITY_TEMPLATES: IdentityTemplateInfo[] = [
  { id: "scene-replacement", name: "Identity Scene Replacement", description: "Target scene → vision analysis → identity prompt → generation → gallery", menuLabel: "Scene replacement" },
  { id: "pose-outfit-batch", name: "Identity Pose × Outfit Batch", description: "Analyze once, then generate every selected pose/outfit combination", menuLabel: "Pose × outfit batch" },
  { id: "reference-sheet-pack", name: "Identity Reference Sheet Pack", description: "Comp card, beauty headshot and full-body turnaround from the identity's DNA and references", menuLabel: "Reference sheet pack" },
  { id: "content-pack", name: "Identity Daily Content Pack", description: "Four platform-native stills: iPhone selfie, mirror selfie, lifestyle candid, golden hour", menuLabel: "Daily content pack" },
  { id: "selfie-to-reel", name: "Identity Selfie → Reel", description: "One identity selfie, then a 5-second image-to-video Reel from it", menuLabel: "Selfie → Reel" },
  { id: "product-in-hand", name: "Identity Product in Hand", description: "Product image → product analysis → the identity holding it naturally → gallery", menuLabel: "Product in hand" },
];
export type IdentityTemplateId = typeof IDENTITY_TEMPLATES[number]["id"];

const REALISM_LINE = "Photorealistic, no CGI, no 3D render, no cartoon/anime, no plastic skin, natural skin texture with pores visible, realistic lighting, subtle film grain, lifelike detail. No text, no watermarks, no logos.";
const IDENTITY_OPENER = "Create a photo of the same person from the reference images, keeping their exact face, features and proportions:\n@identity";
type TemplateShape = { nodes: Node<NodeData>[]; edges: Edge[]; nodeCounters: Record<string, number>; metadata: WorkflowMetadata };
const identityNode = (): Node<NodeData> => ({ id: "clone-identity", type: "identityMatrixNode", position: { x: 0, y: 0 }, style: { width: 400, height: 620 }, data: { label: "IDENTITY", status: "idle", variableName: "identity" } });
const link = (id: string, source: string, target: string, targetHandle: string, sourceHandle?: string): Edge => ({ id, source, target, sourceHandle, targetHandle, animated: false, style: edgeStyle(targetHandle) });
const sfwKie = (modelId: string): WorkflowMetadata => ({ contentClass: "sfw", routingRequired: true, routes: { sfw: { provider: "kie", modelId } } });

/** A column per style: identity → template prompt → generator, stacked to the right of the identity node. */
function styleColumns(styleIds: string[], model: string, prefix: string): { nodes: Node<NodeData>[]; edges: Edge[] } {
  const nodes: Node<NodeData>[] = [], edges: Edge[] = [];
  styleIds.forEach((styleId, i) => {
    const style = referenceStyle(styleId)!;
    const x = 520 + i * 420;
    nodes.push({ id: `${prefix}-prompt-${i}`, type: "templateNode", position: { x, y: 0 }, style: { width: 380, height: 330 }, data: { label: style.label.toUpperCase(), status: "idle", template: `${IDENTITY_OPENER}\n\n${style.scene}\n\n${REALISM_LINE} ${style.tokens}.` } });
    nodes.push({ id: `${prefix}-generate-${i}`, type: "generateNode", position: { x, y: 400 }, style: { width: 380, height: 460 }, data: { label: style.label.toUpperCase(), status: "idle", model, aspectRatio: style.aspectRatio, quality: "2k" } });
    edges.push(link(`${prefix}-e-identity-prompt-${i}`, "clone-identity", `${prefix}-prompt-${i}`, "text", "promptOut"));
    edges.push(link(`${prefix}-e-prompt-generate-${i}`, `${prefix}-prompt-${i}`, `${prefix}-generate-${i}`, "prompt", "textOut"));
    edges.push(link(`${prefix}-e-identity-refs-${i}`, "clone-identity", `${prefix}-generate-${i}`, "image", "referencesOut"));
  });
  return { nodes, edges };
}

/** Comp card, beauty headshot and turnaround: the three consistency references worth saving back onto the identity. */
export function makeReferenceSheetPackTemplate(): TemplateShape {
  const cols = styleColumns(["comp-card", "headshots", "turnaround"], "nano-banana-pro", "sheet");
  return {
    nodes: [identityNode(), ...cols.nodes, { id: "sheet-note", type: "commentNode", position: { x: 0, y: 700 }, style: { width: 400, height: 170 }, data: { label: "NEXT", status: "idle", comment: "Run all three, then open the identity in the library and add the results as references: comp card and turnaround as Body, headshot as Face. Later generations will hold the likeness better." } }],
    edges: cols.edges,
    nodeCounters: { identityMatrixNode: 1, templateNode: 3, generateNode: 3, commentNode: 1 },
    metadata: sfwKie("nano-banana-pro"),
  };
}

/** Four platform-native stills for one day of posting. */
export function makeContentPackTemplate(): TemplateShape {
  const cols = styleColumns(["iphone-selfie", "mirror-selfie", "lifestyle-candid", "golden-hour"], "nano-banana-pro", "pack");
  return {
    nodes: [identityNode(), ...cols.nodes, { id: "pack-note", type: "commentNode", position: { x: 0, y: 700 }, style: { width: 400, height: 170 }, data: { label: "TIP", status: "idle", comment: "Edit any prompt's scene line (outfit, setting, mood) before running; the identity line and realism tokens stay. Each output lands in the Gallery with the identity attached." } }],
    edges: cols.edges,
    nodeCounters: { identityMatrixNode: 1, templateNode: 4, generateNode: 4, commentNode: 1 },
    metadata: sfwKie("nano-banana-pro"),
  };
}

/** One selfie, then a 5-second image-to-video Reel from it. */
export function makeSelfieToReelTemplate(): TemplateShape {
  const selfie = REFERENCE_STYLES.find((s) => s.id === "iphone-selfie")!;
  const nodes: Node<NodeData>[] = [
    identityNode(),
    { id: "reel-prompt", type: "templateNode", position: { x: 520, y: 0 }, style: { width: 380, height: 330 }, data: { label: "SELFIE PROMPT", status: "idle", template: `${IDENTITY_OPENER}\n\n${selfie.scene}\n\n${REALISM_LINE} ${selfie.tokens}.` } },
    { id: "reel-generate", type: "generateNode", position: { x: 520, y: 400 }, style: { width: 380, height: 460 }, data: { label: "SELFIE", status: "idle", model: "nano-banana-pro", aspectRatio: "9:16", quality: "2k" } },
    { id: "reel-motion", type: "promptNode", position: { x: 960, y: 0 }, style: { width: 360, height: 260 }, data: { label: "MOTION", status: "idle", prompt: "She lowers the phone slightly, laughs, tucks a strand of hair behind her ear and looks back into the lens. Handheld phone motion, natural micro-expressions, the room and light stay exactly as in the frame. No text, no captions." } },
    { id: "reel-video", type: "videoGeneratorNode", position: { x: 960, y: 400 }, style: { width: 360, height: 300 }, data: { label: "REEL", status: "idle", videoModel: "kling-3.0", aspectRatio: "9:16", duration: 5, sound: false } },
    { id: "reel-note", type: "commentNode", position: { x: 0, y: 700 }, style: { width: 400, height: 150 }, data: { label: "FLOW", status: "idle", comment: "Generate the selfie first; it becomes the Reel's start frame. Swap the motion text for any beat (talking to camera, a turn, a walk-off)." } },
  ];
  return {
    nodes,
    edges: [
      link("reel-e-identity-prompt", "clone-identity", "reel-prompt", "text", "promptOut"),
      link("reel-e-prompt-generate", "reel-prompt", "reel-generate", "prompt", "textOut"),
      link("reel-e-identity-refs", "clone-identity", "reel-generate", "image", "referencesOut"),
      link("reel-e-selfie-video", "reel-generate", "reel-video", "startFrame"),
      link("reel-e-motion-video", "reel-motion", "reel-video", "prompt"),
    ],
    nodeCounters: { identityMatrixNode: 1, templateNode: 1, generateNode: 1, promptNode: 1, videoGeneratorNode: 1, commentNode: 1 },
    metadata: sfwKie("nano-banana-pro"),
  };
}

/** A product image is analysed once, then the identity holds it naturally in a UGC-style scene. */
export function makeProductInHandTemplate(): TemplateShape {
  const nodes: Node<NodeData>[] = [
    identityNode(),
    { id: "product-image", type: "imageInputNode", position: { x: 0, y: 700 }, style: { width: 260 }, data: { label: "PRODUCT", status: "idle" } },
    { id: "product-instruction", type: "promptNode", position: { x: 470, y: 700 }, style: { width: 360, height: 220 }, data: { label: "PRODUCT INSTRUCTION", status: "idle", prompt: "Describe this product exactly as it appears: type, shape, size relative to a hand, colors, materials, label or logo text and where it sits, cap or closure, finish. Facts only, so an image model can reproduce it faithfully." } },
    { id: "product-analysis", type: "assistantNode", position: { x: 900, y: 620 }, style: { width: 320, height: 300 }, data: { label: "PRODUCT ANALYSIS", status: "idle", variableName: "product", model: "claude-opus-5", systemPrompt: "You are a precise product photographer's assistant. Describe only what is visible on the product in the image. Return compact production notes, no marketing language." } },
    { id: "product-template", type: "templateNode", position: { x: 900, y: 180 }, style: { width: 380, height: 330 }, data: { label: "UGC PRODUCT PROMPT", status: "idle", template: `${IDENTITY_OPENER}\n\nUGC-style product moment: she holds the product from the reference image up near her face at a natural angle, label facing the camera and readable, in a bright everyday setting (bathroom counter or kitchen) with soft window light, genuine unposed expression, phone-camera framing, waist-up.\n\nThe product must match the reference exactly:\n@product\n\n${REALISM_LINE} iPhone14.Pro.front.cam, natural_grain.fx, casual_lighting.fx.` } },
    { id: "product-generate", type: "generateNode", position: { x: 1380, y: 250 }, style: { width: 320, height: 420 }, data: { label: "GALLERY OUTPUT", status: "idle", model: "nano-banana-pro", aspectRatio: "9:16", quality: "2k" } },
    { id: "product-note", type: "commentNode", position: { x: 1380, y: 720 }, style: { width: 320, height: 150 }, data: { label: "OUTPUT", status: "idle", comment: "The identity references and the product image both feed the generator, so the face and the product stay faithful. Change the setting line in the prompt for other placements." } },
  ];
  return {
    nodes,
    edges: [
      link("product-e-instruction", "product-instruction", "product-analysis", "prompt"),
      link("product-e-image-vision", "product-image", "product-analysis", "image"),
      link("product-e-identity-prompt", "clone-identity", "product-template", "text", "promptOut"),
      link("product-e-analysis-template", "product-analysis", "product-template", "text"),
      link("product-e-template-generate", "product-template", "product-generate", "prompt", "textOut"),
      link("product-e-identity-refs", "clone-identity", "product-generate", "image", "referencesOut"),
      link("product-e-product-generate", "product-image", "product-generate", "image"),
    ],
    nodeCounters: { identityMatrixNode: 1, imageInputNode: 1, promptNode: 1, assistantNode: 1, templateNode: 1, generateNode: 1, commentNode: 1 },
    metadata: sfwKie("nano-banana-pro"),
  };
}

export function makeIdentityTemplate(id: string): TemplateShape | null {
  switch (id) {
    case "scene-replacement": return makeSceneReplacementTemplate();
    case "pose-outfit-batch": return makePoseOutfitBatchTemplate();
    case "reference-sheet-pack": return makeReferenceSheetPackTemplate();
    case "content-pack": return makeContentPackTemplate();
    case "selfie-to-reel": return makeSelfieToReelTemplate();
    case "product-in-hand": return makeProductInHandTemplate();
    default: return null;
  }
}
