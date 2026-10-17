import { env } from "../env.js";

const MODEL = "perceptron-mk1.5";

const PROMPT =
  "Transcribe this grocery receipt line by line, in reading order. Keep item codes, quantities, prices, and the date exactly as printed. Do not invent text you cannot read.";

/**
 * Receipt OCR via Perceptron Mk1.5 chat completions.
 * Returns the transcription, or null when the key is missing or the call fails,
 * in which case the caller falls back to Gemini vision.
 */
export async function perceptronOcr(image: Buffer, mimeType: string): Promise<string | null> {
  if (!env.perceptronApiKey) return null;

  try {
    const res = await fetch(env.perceptronOcrUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.perceptronApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(ocrBody(image, mimeType)),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      console.warn(`[perceptron] HTTP ${res.status}, falling back to Gemini vision`, detail);
      return null;
    }
    const text = extractText(await res.json());
    if (!text) console.warn("[perceptron] empty transcription, falling back to Gemini vision");
    return text;
  } catch (err) {
    console.warn("[perceptron] request failed, falling back to Gemini vision", err);
    return null;
  }
}

function ocrBody(image: Buffer, mimeType: string) {
  return {
    model: MODEL,
    reasoning_effort: "high",
    max_completion_tokens: 4096,
    messages: [
      {
        role: "system",
        content:
          "You are an OCR system. Accurately detect, extract, and transcribe all readable text from the image.",
      },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${image.toString("base64")}` },
          },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  };
}

/** Pull the completed transcription out of an OpenAI-style chat completion body. */
export function extractText(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;

  const choice = choices[0] as { finish_reason?: unknown; message?: { content?: unknown } };
  if (choice.finish_reason !== "stop") return null;
  return textFromContent(choice.message?.content);
}

function textFromContent(content: unknown): string | null {
  if (typeof content === "string") return content.trim() || null;
  if (!Array.isArray(content)) return null;

  const text = content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const value = (part as { text?: unknown }).text;
      return typeof value === "string" ? value : "";
    })
    .join("\n")
    .trim();
  return text || null;
}
