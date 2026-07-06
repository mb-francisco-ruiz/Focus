/**
 * Capability-based model routing (PLAN.md §3.3).
 * Swapping a provider or model is an edit here (or an env override),
 * never a code change in callers.
 */

export type Capability = "classify" | "enrich" | "prioritize" | "digest" | "suggest" | "distill";

export interface CapabilityRoute {
  provider: "google"; // extend union as adapters are added: | "openai" | "anthropic"
  model: string;
}

const DEFAULT_ROUTES: Record<Capability, CapabilityRoute> = {
  classify: { provider: "google", model: "gemini-2.5-flash" },
  enrich: { provider: "google", model: "gemini-2.5-flash" },
  prioritize: { provider: "google", model: "gemini-2.5-flash" },
  // digest/distill would prefer gemini-2.5-pro, but the current API key is
  // free-tier (pro quota = 0). Flip via FOCUS_AI_ROUTE_* env once on billing.
  digest: { provider: "google", model: "gemini-2.5-flash" },
  suggest: { provider: "google", model: "gemini-2.5-flash-lite" },
  distill: { provider: "google", model: "gemini-2.5-flash" },
};

/** Env override: FOCUS_AI_ROUTE_CLASSIFY="google:gemini-2.5-pro" */
export function routeFor(capability: Capability): CapabilityRoute {
  const override = process.env[`FOCUS_AI_ROUTE_${capability.toUpperCase()}`];
  if (override) {
    const [provider, ...model] = override.split(":");
    if (provider === "google" && model.length > 0) {
      return { provider, model: model.join(":") };
    }
    throw new Error(`Invalid AI route override for ${capability}: ${override}`);
  }
  return DEFAULT_ROUTES[capability];
}
