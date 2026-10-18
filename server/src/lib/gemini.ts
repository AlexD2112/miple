import { GoogleGenAI, type Part } from "@google/genai";
import { z } from "zod";
import { env } from "../env.js";

/**
 * Gemini Enterprise Agent Platform (formerly Vertex AI). `@google/genai` calls
 * this host with Application Default Credentials. There is no API key.
 */
export const GEMINI_API_ENDPOINT = "https://aiplatform.googleapis.com";

export const gemini = new GoogleGenAI({
  enterprise: true,
  project: env.googleCloudProject,
  location: env.googleCloudLocation,
});

export type UserPart = { text: string } | { inlineData: { mimeType: string; data: string } };

/**
 * Zod 4 emits JSON Schema draft 2020-12. Gemini rejects a few parts of it with a bare
 * "400 Request contains an invalid argument": the `$schema` keyword, array `type`, and
 * `minItems`/`maxItems` (in nested schemas like ChefTurn). Those are dropped here; `structured()`
 * still validates the reply against the full Zod schema, limits included.
 */
export function geminiJsonSchema(schema: z.ZodType): unknown {
  return normalize(z.toJSONSchema(schema));
}

function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (!node || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "$schema" || key === "minItems" || key === "maxItems") continue;
    // z.number().int() adds ±MAX_SAFE_INTEGER bounds; they say nothing and bloat the schema.
    if ((key === "minimum" || key === "maximum") && Math.abs(value as number) === Number.MAX_SAFE_INTEGER) continue;
    out[key] = normalize(value);
  }

  if (Array.isArray(out.type) && out.type.every((t) => typeof t === "string")) {
    const types = out.type as string[];
    delete out.type;
    out.anyOf = types.map((t) => ({ type: t }));
  }
  return out;
}

/** Plain-text generation. Used when a caller needs the model's own words, not a schema. */
export async function generateText(opts: { system: string; content: string | UserPart[] }): Promise<string> {
  const parts: Part[] = typeof opts.content === "string" ? [{ text: opts.content }] : opts.content;
  const response = await gemini.models.generateContent({
    model: env.model,
    contents: [{ role: "user", parts }],
    config: { systemInstruction: opts.system, temperature: 0.4, maxOutputTokens: 2048 },
  });
  if (!response.text) throw new Error("model returned no output");
  return response.text;
}

/**
 * One structured-output call. Returns the parsed, schema-validated object or throws.
 */
export async function structured<S extends z.ZodType>(
  schema: S,
  opts: { system: string; content: string | UserPart[] },
): Promise<z.infer<S>> {
  const parts: Part[] = typeof opts.content === "string" ? [{ text: opts.content }] : opts.content;
  const response = await gemini.models.generateContent({
    model: env.model,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: opts.system,
      temperature: 0.4,
      maxOutputTokens: 16000,
      responseMimeType: "application/json",
      responseJsonSchema: geminiJsonSchema(schema),
    },
  });

  const text = response.text;
  if (!text) throw new Error("model returned no output");

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("model returned invalid JSON");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new Error(`model output failed schema: ${parsed.error.message}`);
  return parsed.data;
}
