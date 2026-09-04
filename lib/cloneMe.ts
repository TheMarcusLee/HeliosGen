export type IdentityReferenceKind = "face" | "body";

export interface IdentityReference {
  url: string;
  kind: IdentityReferenceKind;
  label?: string;
}

export interface IdentityAsset {
  id: string;
  name: string;
  version: number;
  triggerWord: string;
  basePrompts: string[];
  references: IdentityReference[];
  createdAt: string;
  updatedAt: string;
}

export type WorkflowContentClass = "sfw" | "adult";
export type WorkflowProvider = "kie" | "wavespeed" | "comfyui" | "azure" | "codex";

export interface ProviderRoute {
  provider: WorkflowProvider;
  modelId: string;
}

export interface WorkflowMetadata {
  contentClass: WorkflowContentClass;
  /** When true, generation is blocked until the active content class has an exact route. */
  routingRequired?: boolean;
  routes: {
    sfw?: ProviderRoute;
    adult?: ProviderRoute;
  };
  adultAssurances?: {
    allSubjectsAdults: boolean;
    consentVerified: boolean;
  };
}

export const DEFAULT_WORKFLOW_METADATA: WorkflowMetadata = {
  contentClass: "sfw",
  routes: {},
};

const MINOR_TERMS = String.raw`(?:baby|toddler|child|children|kid|minor|underage|preteen|teen(?:ager)?|schoolgirl|schoolboy|young girl|young boy|(?:[0-9]|1[0-7])[- ]?year[- ]?old)`;
const SEXUAL_TERMS = String.raw`(?:nude|naked|topless|sexual|sex|explicit|erotic|lingerie|fetish|porn|genitals?)`;

const CHILD_SEXUAL_PATTERNS = [
  new RegExp(`\\b${MINOR_TERMS}\\b[\\s\\S]{0,120}\\b${SEXUAL_TERMS}\\b`, "i"),
  new RegExp(`\\b${SEXUAL_TERMS}\\b[\\s\\S]{0,120}\\b${MINOR_TERMS}\\b`, "i"),
  /\b(?:lolicon|shotacon|csam)\b/i,
];

const NON_CONSENSUAL_PATTERNS = [
  /\b(?:without (?:their|her|his) consent|non[- ]?consensual|revenge porn|secretly nude|undress (?:her|him|them)|deepfake nude|fake nude|nudify|rape|forced sex|sexually coerced|unconscious sex|asleep and nude|hidden[- ]camera nude|leaked intimate)\b/i,
];

export function normalizeWorkflowMetadata(value: unknown): WorkflowMetadata {
  if (!value || typeof value !== "object") return structuredClone(DEFAULT_WORKFLOW_METADATA);
  const raw = value as Partial<WorkflowMetadata>;
  const contentClass = raw.contentClass === "adult" ? "adult" : "sfw";
  const normalizeRoute = (route: unknown): ProviderRoute | undefined => {
    if (!route || typeof route !== "object") return undefined;
    const item = route as Partial<ProviderRoute>;
    if (!["kie", "wavespeed", "comfyui", "azure", "codex"].includes(item.provider ?? "")) return undefined;
    if (typeof item.modelId !== "string" || !item.modelId.trim()) return undefined;
    return { provider: item.provider!, modelId: item.modelId.trim() };
  };
  return {
    contentClass,
    ...(raw.routingRequired === true ? { routingRequired: true } : {}),
    routes: {
      sfw: normalizeRoute(raw.routes?.sfw),
      adult: normalizeRoute(raw.routes?.adult),
    },
    ...(contentClass === "adult" ? {
      adultAssurances: {
        allSubjectsAdults: raw.adultAssurances?.allSubjectsAdults === true,
        consentVerified: raw.adultAssurances?.consentVerified === true,
      },
    } : {}),
  };
}

export function validateContentRoute(input: {
  prompt?: string;
  metadata?: unknown;
  provider: WorkflowProvider;
  modelId: string;
}): WorkflowMetadata {
  const metadata = normalizeWorkflowMetadata(input.metadata);
  const prompt = input.prompt ?? "";
  if (CHILD_SEXUAL_PATTERNS.some((pattern) => pattern.test(prompt))) {
    throw new Error("This workflow cannot create sexual content involving minors or young-looking subjects.");
  }
  if (NON_CONSENSUAL_PATTERNS.some((pattern) => pattern.test(prompt))) {
    throw new Error("This workflow cannot create non-consensual intimate imagery.");
  }
  if (metadata.contentClass === "adult") {
    if (!metadata.adultAssurances?.allSubjectsAdults || !metadata.adultAssurances?.consentVerified) {
      throw new Error("Adult workflows require confirmation that every subject is an adult and has consented.");
    }
    const route = metadata.routes.adult;
    if (!route) throw new Error("Choose an explicit provider and model for the adult workflow route.");
    if (route.provider !== input.provider || route.modelId !== input.modelId) {
      throw new Error(`Adult route is locked to ${route.provider}:${route.modelId}; this request tried ${input.provider}:${input.modelId}.`);
    }
  }
  const selectedRoute = metadata.routes[metadata.contentClass];
  if (metadata.routingRequired && !selectedRoute) {
    throw new Error(`Choose an explicit provider and model for the ${metadata.contentClass.toUpperCase()} workflow route.`);
  }
  if (selectedRoute && (selectedRoute.provider !== input.provider || selectedRoute.modelId !== input.modelId)) {
    throw new Error(`${metadata.contentClass.toUpperCase()} route is locked to ${selectedRoute.provider}:${selectedRoute.modelId}; this request tried ${input.provider}:${input.modelId}.`);
  }
  return metadata;
}

export function buildIdentityPrompt(identity: Pick<IdentityAsset, "triggerWord" | "basePrompts">, parts: {
  analysis?: string;
  scene?: string;
  pose?: string;
  outfit?: string;
  extra?: string;
}): string {
  return [
    identity.triggerWord && `Identity trigger: ${identity.triggerWord}`,
    ...identity.basePrompts,
    parts.analysis && `Scene analysis: ${parts.analysis}`,
    parts.scene && `Scene: ${parts.scene}`,
    parts.pose && `Pose: ${parts.pose}`,
    parts.outfit && `Outfit: ${parts.outfit}`,
    parts.extra,
    "Preserve the referenced adult subject's identity, facial geometry, body proportions, and distinguishing features.",
  ].filter(Boolean).join("\n");
}

export interface BatchCombination {
  id: string;
  pose: string;
  outfit: string;
  prompt: string;
}

export function buildPoseOutfitMatrix(input: {
  identity: Pick<IdentityAsset, "triggerWord" | "basePrompts">;
  poses: string[];
  outfits: string[];
  analysis?: string;
  scene?: string;
  extra?: string;
}): BatchCombination[] {
  const poses = input.poses.map((value) => value.trim()).filter(Boolean);
  const outfits = input.outfits.map((value) => value.trim()).filter(Boolean);
  return poses.flatMap((pose, poseIndex) => outfits.map((outfit, outfitIndex) => ({
    id: `${poseIndex + 1}-${outfitIndex + 1}`,
    pose,
    outfit,
    prompt: buildIdentityPrompt(input.identity, { analysis: input.analysis, scene: input.scene, pose, outfit, extra: input.extra }),
  })));
}
