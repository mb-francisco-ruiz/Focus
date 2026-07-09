import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import type { z } from "zod";
import { routeFor, type Capability, type CapabilityRoute } from "./config.js";

function resolveModel(route: CapabilityRoute, apiKey?: string): LanguageModel {
  switch (route.provider) {
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: apiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      });
      return google(route.model);
    }
  }
}

export interface AiCallLog {
  capability: Capability;
  provider: string;
  model: string;
  latencyMs: number;
  usage: { inputTokens: number | undefined; outputTokens: number | undefined };
}

export type AiLogger = (log: AiCallLog) => void;

let logger: AiLogger = () => {};
export function setAiLogger(fn: AiLogger): void {
  logger = fn;
}

/**
 * Single entry point for all AI calls: capability routing, schema-enforced
 * structured output, latency/usage logging. Retries are handled by the AI SDK
 * (maxRetries default); provider fallback lands here later.
 */
export async function generateStructured<T>(
  capability: Capability,
  schema: z.ZodType<T>,
  prompt: string,
  opts: { abortSignal?: AbortSignal; apiKey?: string } = {},
): Promise<T> {
  const route = routeFor(capability);
  const started = performance.now();
  const result = await generateObject({
    model: resolveModel(route, opts.apiKey),
    schema,
    prompt,
    abortSignal: opts.abortSignal,
  });
  logger({
    capability,
    provider: route.provider,
    model: route.model,
    latencyMs: Math.round(performance.now() - started),
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    },
  });
  return result.object;
}
