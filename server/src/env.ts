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
  model: process.env.RIPE_MODEL || process.env.MIPLE_MODEL || "gemini-2.5-flash", // MIPLE_MODEL is the pre-rename name
  // Gemini 2.5 "thinks" before answering by default. Measured on the chef call, turning it off
  // (0) halved the median latency (8.1 s -> 4.1 s) and removed 20 s outliers. -1 lets the model decide.
  thinkingBudget: Number(process.env.GEMINI_THINKING_BUDGET ?? 0),
  // Small, fast model for the safety review that runs alongside each chef reply.
  safetyModel: process.env.SAFETY_MODEL || "gemini-2.5-flash-lite",
  perceptronApiKey: process.env.PERCEPTRON_API_KEY || null,
  perceptronOcrUrl: process.env.PERCEPTRON_OCR_URL || "https://api.perceptron.inc/v1/chat/completions",
  veyzlProbeToken: process.env.VEYZL_PROBE_TOKEN || null,
  // Sites allowed to call the API from a browser: the web app and the Expo web dev server.
  webOrigins: (process.env.WEB_ORIGINS || "https://ripe.cooking,https://www.ripe.cooking,http://localhost:8081")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  // Nightly job that marks expired pantry items as wasted. Cloud Run's clock is UTC, so the
  // schedule needs an explicit zone to run just after local midnight.
  expiryCron: process.env.EXPIRY_CRON || "5 0 * * *",
  expiryTimezone: process.env.EXPIRY_TIMEZONE || "America/Los_Angeles",
};
