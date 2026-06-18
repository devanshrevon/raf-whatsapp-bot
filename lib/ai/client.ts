import OpenAI from "openai";
import { env } from "@/lib/env";

// Lazily-created OpenAI client. One structured call per ordinary customer
// message (spec §11). JSON object mode + Zod validation downstream keeps the
// model from controlling anything it shouldn't (spec §5.3).

let client: OpenAI | undefined;

function openaiClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: env.openai.apiKey });
  }
  return client;
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** Returns the raw JSON string from the model (parsed by lib/ai/schema.ts). */
export async function getConversationCompletion(
  messages: ChatMessage[]
): Promise<string> {
  const completion = await openaiClient().chat.completions.create({
    model: env.openai.model,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages,
  });
  return completion.choices[0]?.message?.content ?? "";
}
