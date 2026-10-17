import { GoogleGenAI, type Part } from "@google/genai";
import { z } from "zod";
import { env } from "../env.js";

export const gemini = new GoogleGenAI({ apiKey: env.geminiApiKey });

export type UserPart = { text: string } | { inlineData: { mimeType: string; data: string } };

/** Zod 4 emits JSON Schema draft 2020-12. Gemini accepts that, except a `$schema` keyword and array `type`. */
function geminiJsonSchema(schema: z.ZodType): unknown {
  return normalize(z.toJSONSchema(schema));
}

function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (!node || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "$schema") continue;
    out[key] = normalize(value);
  }

  if (Array.isArray(out.type) && out.type.every((t) => typeof t === "string")) {
    const types = out.type as string[];
    delete out.type;
    out.anyOf = types.map((t) => ({ type: t }));
  }
  return out;
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
