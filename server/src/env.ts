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
  googleCloudProject: required("GOOGLE_CLOUD_PROJECT"),
  googleCloudLocation: process.env.GOOGLE_CLOUD_LOCATION || "us-central1",
  model: process.env.MIPLE_MODEL || "gemini-2.5-flash",
  perceptronApiKey: process.env.PERCEPTRON_API_KEY || null,
  perceptronOcrUrl: process.env.PERCEPTRON_OCR_URL || "https://api.perceptron.inc/v1/chat/completions",
  veyzlProbeToken: process.env.VEYZL_PROBE_TOKEN || null,
  // Nightly job that marks expired pantry items as wasted. Cloud Run's clock is UTC, so the
  // schedule needs an explicit zone to run just after local midnight.
  expiryCron: process.env.EXPIRY_CRON || "5 0 * * *",
  expiryTimezone: process.env.EXPIRY_TIMEZONE || "America/Los_Angeles",
};
