/**
 * Content format playbook, brought over from App Promo Factory.
 *
 * A format is the skeleton of a piece of content: the hook shape, the ordered
 * beats it must hit, and how many slides it wants. When a campaign message is
 * sent with a format, the planner maps beats to steps instead of inventing a
 * structure. Formats contain no scraped examples, no third-party branding and
 * no invented performance metrics; they describe mechanics.
 */

export type FormatCategory =
  | "problem-first"
  | "demonstration"
  | "proof"
  | "opinion"
  | "story"
  | "utility";

export type Channel = "tiktok" | "instagram" | "linkedin" | "x" | "youtube";

export interface CampaignFormat {
  id: string;
  name: string;
  category: FormatCategory;
  /** One-line summary of the structure. */
  description: string;
  /** The reusable opening line shape. */
  hookPattern: string;
  /** Why the structure holds attention — mechanics, not hype. */
  whyItWorks: string;
  /** Ordered beats the content should hit. */
  beats: string[];
  recommendedChannels: Channel[];
  slideCount: { min: number; max: number };
  /** Is an on-camera persona genuinely useful here? */
  personaUseful: boolean;
  /** Are product/app screenshots genuinely useful here? */
  screenshotsUseful: boolean;
}

export const CHANNEL_LABELS: Record<Channel, string> = {
  tiktok: "TikTok",
  instagram: "Instagram / Reels",
  linkedin: "LinkedIn",
  x: "X",
  youtube: "YouTube Shorts",
};

export const CATEGORY_LABELS: Record<FormatCategory, string> = {
  "problem-first": "Problem first",
  demonstration: "Demonstration",
  proof: "Proof",
  opinion: "Opinion",
  story: "Story",
  utility: "Utility",
};

export const CAMPAIGN_FORMATS: CampaignFormat[] = [
  {
    id: "genz-carousel",
    name: "Gen Z creator carousel (5 slides)",
    category: "story",
    description:
      "A cozy five-slide carousel: one creator selfie, three POV cutaways with no face, one emotional closer. Lowercase captions, one subtle product moment on slide four.",
    hookPattern: "i've been {doing the thing} for {time} — here's what i learned…",
    whyItWorks:
      "Reads as a person's camera roll rather than an ad. The single face slide earns trust, the cutaways carry mood, and the product appears once as part of the routine.",
    beats: ["The creator moment (face visible, 0.5x or mirror selfie)", "POV cutaway: the setting and a relatable thought", "POV cutaway: a creator tip or mindset", "POV cutaway with the product shown naturally", "The emotional closer (no face, calming detail)"],
    recommendedChannels: ["tiktok", "instagram"],
    slideCount: { min: 5, max: 5 },
    personaUseful: true,
    screenshotsUseful: true,
  },
  {
    id: "friction-to-relief",
    name: "Friction → tiny win → app reveal",
    category: "problem-first",
    description:
      "Open on a small, specific annoyance, resolve it in one visible step, then reveal the app as the thing that did it.",
    hookPattern: "The part of {task} nobody warns you about…",
    whyItWorks:
      "A narrow, concrete friction is easier to recognise than a broad benefit claim, and the reveal lands as an explanation rather than a pitch.",
    beats: ["Name the friction precisely", "Show the moment it bites", "One visible fix", "Reveal the app", "What changes tomorrow"],
    recommendedChannels: ["tiktok", "instagram", "youtube"],
    slideCount: { min: 4, max: 6 },
    personaUseful: true,
    screenshotsUseful: true,
  },
  {
    id: "wish-i-knew",
    name: "Wish I'd known this sooner",
    category: "story",
    description:
      "Retrospective framing: the workaround you used for months, and the shortcut that replaced it.",
    hookPattern: "I did {slow thing} for {time period} before I found this.",
    whyItWorks:
      "Regret framing borrows the viewer's own sunk cost. The payoff feels earned instead of advertised.",
    beats: ["The old way", "How long it lasted", "The turning point", "The new way, shown", "One honest caveat"],
    recommendedChannels: ["tiktok", "instagram", "linkedin"],
    slideCount: { min: 4, max: 6 },
    personaUseful: true,
    screenshotsUseful: true,
  },
  {
    id: "pov-workflow",
    name: "POV workflow run-through",
    category: "demonstration",
    description:
      "First-person walkthrough of one real job, start to finish, at realistic speed.",
    hookPattern: "POV: you have {constraint} and {deadline}.",
    whyItWorks:
      "Watching a complete job removes the 'but would it work for me' objection without a single claim being made.",
    beats: ["Set the constraint", "Step one", "Step two", "Step three", "Finished artefact", "Time saved"],
    recommendedChannels: ["tiktok", "instagram", "youtube"],
    slideCount: { min: 5, max: 8 },
    personaUseful: true,
    screenshotsUseful: true,
  },
  {
    id: "state-change",
    name: "State change (before / after)",
    category: "proof",
    description: "Two clean states of the same artefact, with the transition made legible.",
    hookPattern: "Same {artefact}. Ten minutes apart.",
    whyItWorks:
      "Side-by-side comparison is processed instantly, so attention is spent on the delta rather than on decoding the setup.",
    beats: ["Before state, uncropped", "What was wrong with it", "The change", "After state", "What made the difference"],
    recommendedChannels: ["instagram", "tiktok", "x"],
    slideCount: { min: 3, max: 5 },
    personaUseful: false,
    screenshotsUseful: true,
  },
  {
    id: "three-mistakes",
    name: "Three mistakes costing you {outcome}",
    category: "utility",
    description: "A tight, numbered diagnosis where each mistake has a one-line correction.",
    hookPattern: "Three mistakes quietly costing you {outcome}.",
    whyItWorks:
      "Numbered structure sets an expectation of length, which lowers the cost of committing to watch.",
    beats: ["Mistake one + fix", "Mistake two + fix", "Mistake three + fix", "Where the app removes the mistake"],
    recommendedChannels: ["tiktok", "linkedin", "x"],
    slideCount: { min: 4, max: 6 },
    personaUseful: true,
    screenshotsUseful: true,
  },
  {
    id: "screenshot-story",
    name: "Screenshot story",
    category: "demonstration",
    description: "The product narrated screen by screen, one idea per screen, no voice needed.",
    hookPattern: "This is the screen that changed how I {activity}.",
    whyItWorks:
      "Screens are self-evidencing. Annotating one detail per screen keeps cognitive load low while showing real software.",
    beats: ["Entry screen", "The decisive screen", "The detail people miss", "The output", "Where to start"],
    recommendedChannels: ["instagram", "x", "linkedin"],
    slideCount: { min: 4, max: 8 },
    personaUseful: false,
    screenshotsUseful: true,
  },
  {
    id: "contrarian-take",
    name: "Contrarian take",
    category: "opinion",
    description:
      "Challenge a norm your audience already half-doubts, then justify it with a demonstration.",
    hookPattern: "{Common advice} is wrong for {audience}. Here's what I do instead.",
    whyItWorks:
      "A disagreement creates an open loop the viewer wants closed — but only if the payoff is a method, not an insult.",
    beats: ["The norm", "Why it fails here", "The alternative", "Show it working", "Who should ignore this"],
    recommendedChannels: ["linkedin", "x", "tiktok"],
    slideCount: { min: 3, max: 5 },
    personaUseful: true,
    screenshotsUseful: false,
  },
  {
    id: "feature-to-outcome",
    name: "Feature → outcome ladder",
    category: "demonstration",
    description: "Take one feature and climb from mechanic, to result, to the thing the user actually wanted.",
    hookPattern: "This one setting does more than it looks like.",
    whyItWorks:
      "Features alone are inert. The ladder makes the causal chain explicit so the value is inferred rather than asserted.",
    beats: ["Feature shown", "What it mechanically does", "The immediate result", "The real-world outcome", "Try it on your own {artefact}"],
    recommendedChannels: ["instagram", "linkedin", "youtube"],
    slideCount: { min: 4, max: 6 },
    personaUseful: false,
    screenshotsUseful: true,
  },
  {
    id: "operator-diary",
    name: "Operator diary (day in the life)",
    category: "story",
    description: "A timestamped slice of a working day where the app appears where it naturally belongs.",
    hookPattern: "{Time}. {Task}. Here's how the day actually goes.",
    whyItWorks:
      "Context makes the product ordinary in the best way — it's shown as part of a routine rather than as an event.",
    beats: ["Morning setup", "The messy middle", "Where the app enters", "End-of-day artefact", "What tomorrow looks like"],
    recommendedChannels: ["tiktok", "instagram", "youtube"],
    slideCount: { min: 5, max: 8 },
    personaUseful: true,
    screenshotsUseful: true,
  },
  {
    id: "objection-crusher",
    name: "Objection crusher",
    category: "proof",
    description: "State the strongest reason not to use the app, then answer it honestly on camera or on screen.",
    hookPattern: "\"But what about {objection}?\" Fair. Watch.",
    whyItWorks:
      "Naming the objection first removes the viewer's defence and converts scepticism into attention.",
    beats: ["The objection, said plainly", "Why it's reasonable", "The demonstration", "The limits of the answer", "Next step"],
    recommendedChannels: ["linkedin", "x", "instagram"],
    slideCount: { min: 3, max: 5 },
    personaUseful: true,
    screenshotsUseful: true,
  },
  {
    id: "why-we-built-it",
    name: "Why we built it",
    category: "story",
    description: "Founder or team origin beat: the specific problem in front of you the week you started.",
    hookPattern: "We built {app} because {specific frustration} kept happening.",
    whyItWorks:
      "Specific origins are hard to fake and give the product a point of view, which is what people follow.",
    beats: ["The week it started", "What we tried first", "What we built", "What it does now", "What we refuse to add"],
    recommendedChannels: ["linkedin", "x", "youtube"],
    slideCount: { min: 3, max: 6 },
    personaUseful: true,
    screenshotsUseful: false,
  },
  {
    id: "saveable-checklist",
    name: "Saveable checklist",
    category: "utility",
    description: "A reference list valuable enough to bookmark, with the app as the fastest way to run it.",
    hookPattern: "Save this before your next {task}.",
    whyItWorks:
      "Utility earns saves and shares, which extends the life of the post well beyond the first day.",
    beats: ["Promise the list", "Items 1–3", "Items 4–6", "The one people skip", "Run the whole list in the app"],
    recommendedChannels: ["instagram", "linkedin", "x"],
    slideCount: { min: 5, max: 9 },
    personaUseful: false,
    screenshotsUseful: true,
  },
  {
    id: "teardown",
    name: "Teardown and rebuild",
    category: "proof",
    description: "Critique a real (own or anonymised) artefact, then rebuild it properly in the app.",
    hookPattern: "This {artefact} isn't working. Let's fix it.",
    whyItWorks:
      "Critique demonstrates taste, and the rebuild demonstrates capability. Together they build trust faster than either alone.",
    beats: ["The artefact", "Three problems", "Rebuild step", "Result", "Principle to reuse"],
    recommendedChannels: ["youtube", "instagram", "linkedin"],
    slideCount: { min: 5, max: 8 },
    personaUseful: true,
    screenshotsUseful: true,
  },
  {
    id: "cost-of-doing-nothing",
    name: "Cost of doing nothing",
    category: "problem-first",
    description: "Quantify what the current workaround costs per week, honestly and without invented statistics.",
    hookPattern: "Doing it manually costs you {unit} every week.",
    whyItWorks:
      "Converting a vague annoyance into a recurring cost gives the viewer a reason to act now instead of later.",
    beats: ["The manual routine", "Count the units", "Multiply across the month", "The alternative", "Decide"],
    recommendedChannels: ["linkedin", "x", "tiktok"],
    slideCount: { min: 3, max: 5 },
    personaUseful: true,
    screenshotsUseful: false,
  },
  {
    id: "one-question",
    name: "One question, one answer",
    category: "utility",
    description: "Answer a single real question from your audience completely, then stop.",
    hookPattern: "Someone asked: {question}. Short answer:",
    whyItWorks:
      "Answering one question fully is more memorable than covering five partially, and it compounds into a searchable library.",
    beats: ["The question verbatim", "The short answer", "The demonstration", "The caveat", "Ask the next one"],
    recommendedChannels: ["x", "linkedin", "instagram"],
    slideCount: { min: 2, max: 4 },
    personaUseful: true,
    screenshotsUseful: true,
  },
  {
    id: "quiet-upgrade",
    name: "The quiet upgrade",
    category: "demonstration",
    description: "Show a small change in how someone works, not a product launch — the app is the enabler.",
    hookPattern: "I changed one thing about how I {activity}.",
    whyItWorks:
      "Small, believable changes are adopted; large transformations are doubted. This format sells a habit, not a miracle.",
    beats: ["The old habit", "The single change", "One week later", "The artefact it produced", "Copy the habit"],
    recommendedChannels: ["instagram", "tiktok", "linkedin"],
    slideCount: { min: 3, max: 5 },
    personaUseful: true,
    screenshotsUseful: true,
  },
];

export const getFormat = (id?: string | null): CampaignFormat | undefined =>
  id ? CAMPAIGN_FORMATS.find((f) => f.id === id) : undefined;

export const formatName = (id?: string | null): string => getFormat(id)?.name ?? "No format selected";

/** The format as planner context: everything the planner needs to map beats to steps. */
export function formatBrief(format: CampaignFormat | undefined) {
  if (!format) return undefined;
  return {
    id: format.id, name: format.name, category: CATEGORY_LABELS[format.category], description: format.description, hookPattern: format.hookPattern, whyItWorks: format.whyItWorks,
    beats: format.beats, slideCount: format.slideCount, channels: format.recommendedChannels.map((c) => CHANNEL_LABELS[c]), personaUseful: format.personaUseful,
  };
}
