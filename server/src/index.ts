import express, { type NextFunction, type Request, type Response } from "express";
import cron from "node-cron";
import { env } from "./env.js";
import { GEMINI_API_ENDPOINT } from "./lib/gemini.js";
import { receipts } from "./routes/receipts.js";
import { recipes } from "./routes/recipes.js";
import { items } from "./routes/items.js";
import { shopping } from "./routes/shopping.js";
import { markExpiredWasted } from "./jobs/expireItems.js";
import { auditPrefix } from "./lib/audit.js";

/** Model-backed routes. Each handler calls `@google/genai` `generateContent` on GEMINI_API_ENDPOINT. */
export const AI_ROUTES = [
  "POST /recipes/generate",
  "POST /recipes/chef",
  "POST /receipts/parse",
  "POST /items/category",
  "POST /items/shelf-life",
  "POST /shopping/suggest",
] as const;

const app = express();
app.use(auditPrefix); // /audit/<VEYZL_PROBE_TOKEN>/... for hosted audits
app.use(express.json({ limit: "8mb" })); // base64 images in audit probes

app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    provider: "google-genai",
    model: env.model,
    endpoint: GEMINI_API_ENDPOINT,
    ai_routes: AI_ROUTES,
  }),
);
app.use("/receipts", receipts);
app.use("/recipes", recipes);
app.use("/items", items);
app.use("/shopping", shopping);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  // Log the details; don't send database or provider error text to clients.
  res.status(500).json({ error: "Something went wrong on our side. Please try again." });
});

cron.schedule(
  env.expiryCron,
  async () => {
    const wasted = await markExpiredWasted();
    console.log(`[expiry] marked ${wasted} expired items as wasted`);
  },
  { timezone: env.expiryTimezone },
);

app.listen(env.port, () => console.log(`miple server on http://localhost:${env.port}`));
