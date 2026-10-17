import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} (see server/.env.example)`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  geminiApiKey: required("GEMINI_API_KEY"),
  model: process.env.MIPLE_MODEL || "gemini-2.5-flash",
  perceptronApiKey: process.env.PERCEPTRON_API_KEY || null,
  perceptronOcrUrl: process.env.PERCEPTRON_OCR_URL || null,
  photonApiKey: process.env.PHOTON_API_KEY || null,
  photonSendUrl: process.env.PHOTON_SEND_URL || null,
  photonWebhookSecret: process.env.PHOTON_WEBHOOK_SECRET || null,
  nudgeCron: process.env.NUDGE_CRON || "0 9 * * *",
};
