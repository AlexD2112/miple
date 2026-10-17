import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { env } from "../env.js";

export const anthropic = new Anthropic();

type UserContent = Anthropic.MessageParam["content"];

/**
 * One structured-output call. Returns the parsed, schema-validated object or throws.
 * Server-side refusal fallbacks are on, so a declined request is retried on another model.
 */
export async function structured<S extends z.ZodType>(
  schema: S,
  opts: { system: string; content: UserContent; effort?: "low" | "medium" | "high" },
): Promise<z.infer<S>> {
  const response = await anthropic.beta.messages.parse({
    model: env.model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: opts.system,
    messages: [{ role: "user", content: opts.content }],
    output_config: { format: zodOutputFormat(schema), effort: opts.effort ?? "low" },
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`model declined: ${response.stop_details?.explanation ?? "no explanation"}`);
  }
  if (response.parsed_output == null) {
    throw new Error(`model returned no parseable output (stop_reason=${response.stop_reason})`);
  }
  return response.parsed_output as z.infer<S>;
}
