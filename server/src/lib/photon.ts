import { env } from "../env.js";

/**
 * Send an SMS / iMessage through Photon. Without Photon credentials this is a dry run
 * that logs the message, so the nudge job can be demoed end to end.
 *
 * TODO(photon): match the body to the Photon 2.0 send API from the sponsor docs.
 */
export async function sendText(to: string, text: string): Promise<void> {
  if (!env.photonApiKey || !env.photonSendUrl) {
    console.log(`[photon:dry-run] -> ${to}: ${text}`);
    return;
  }

  const res = await fetch(env.photonSendUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.photonApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to, text }),
  });
  if (!res.ok) throw new Error(`Photon send failed: HTTP ${res.status} ${await res.text()}`);
}

export interface InboundText {
  from: string;
  text: string;
}

/** Normalizes the inbound webhook payload. Accepts a few common field names. */
export function parseInbound(body: unknown): InboundText | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const from = (b.from ?? b.sender ?? b.handle ?? b.From) as string | undefined;
  const text = (b.text ?? b.body ?? b.message ?? b.Body) as string | undefined;
  if (typeof from !== "string" || typeof text !== "string") return null;
  return { from, text };
}
