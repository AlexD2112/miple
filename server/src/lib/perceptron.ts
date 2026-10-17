import { env } from "../env.js";

/**
 * Receipt OCR via Perceptron. Returns raw receipt text, or null when Perceptron isn't
 * configured or fails, in which case the caller falls back to Claude vision.
 *
 * TODO(perceptron): confirm the request/response shape against the Perceptron docs
 * handed out at the hackathon and adjust the body and `extractText` below.
 */
export async function perceptronOcr(image: Buffer, mimeType: string): Promise<string | null> {
  if (!env.perceptronApiKey || !env.perceptronOcrUrl) return null;

  try {
    const res = await fetch(env.perceptronOcrUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.perceptronApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: "ocr",
        image: { data: image.toString("base64"), media_type: mimeType },
        prompt: "Transcribe this grocery receipt line by line. Keep item codes, prices and the date.",
      }),
    });
    if (!res.ok) {
      console.warn(`[perceptron] HTTP ${res.status}, falling back to Claude vision`);
      return null;
    }
    return extractText(await res.json());
  } catch (err) {
    console.warn("[perceptron] request failed, falling back to Claude vision", err);
    return null;
  }
}

function extractText(body: unknown): string | null {
  if (typeof body === "string") return body;
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    for (const key of ["text", "output", "result", "content"]) {
      if (typeof b[key] === "string" && (b[key] as string).trim()) return b[key] as string;
    }
  }
  return null;
}
