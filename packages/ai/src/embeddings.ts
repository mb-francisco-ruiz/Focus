import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { embed } from "ai";

/**
 * 768 dims — must match the pgvector columns in apps/server (tasks.embedding,
 * memory_records.embedding). Changing model/dims requires re-embedding + a
 * schema migration, so this is intentionally not env-swappable like chat routes.
 */
export const EMBEDDING_DIMENSIONS = 768;
const EMBEDDING_MODEL = "text-embedding-004";

export async function embedText(text: string): Promise<number[]> {
  const google = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  const { embedding } = await embed({
    model: google.textEmbeddingModel(EMBEDDING_MODEL),
    value: text.slice(0, 8000),
  });
  return embedding;
}
