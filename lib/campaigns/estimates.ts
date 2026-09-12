import { recentActualCosts } from "../guest/generationLedger";
import { resolveEstimate, type Estimate, type ResolveInput, type VideoEstimateInput } from "../pricing";
import { campaignEstimates, type CampaignEstimates, type CampaignRoutes } from "./operations";

/** Server-side estimates: manual entry, then the median of observed charges in the ledger, then published prices. */
export function serverCampaignEstimates(c: CampaignRoutes, motion: VideoEstimateInput = {}): CampaignEstimates {
  return campaignEstimates(c, motion, (provider, modelId) => recentActualCosts(provider, modelId));
}
export function serverEstimate(input: Omit<ResolveInput, "actualCosts">): Estimate {
  return resolveEstimate({ ...input, actualCosts: recentActualCosts(input.provider, input.modelId) });
}
