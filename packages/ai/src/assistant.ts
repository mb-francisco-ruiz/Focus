import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, stepCountIs, tool, type ToolSet } from "ai";
import type { z } from "zod";
import { routeFor } from "./config.js";

export interface AssistantTool {
  description: string;
  inputSchema: z.ZodTypeAny;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * The "Ask Focus" tool-calling loop. The server supplies tools whose execute()
 * hits the DB scoped to the user; the model reads/writes tasks through them and
 * replies in prose. Kept provider-agnostic via the capability router.
 */
export async function runAssistant(input: {
  system: string;
  messages: AssistantMessage[];
  tools: Record<string, AssistantTool>;
  apiKey?: string;
}): Promise<string> {
  const route = routeFor("assistant");
  const google = createGoogleGenerativeAI({
    apiKey: input.apiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  const tools: ToolSet = Object.fromEntries(
    Object.entries(input.tools).map(([name, t]) => [
      name,
      tool({
        description: t.description,
        inputSchema: t.inputSchema,
        execute: (args) => t.execute(args as Record<string, unknown>),
      }),
    ]),
  );
  const { text } = await generateText({
    model: google(route.model),
    system: input.system,
    messages: input.messages,
    tools,
    stopWhen: stepCountIs(6),
  });
  return text;
}
