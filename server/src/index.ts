import express, { type NextFunction, type Request, type Response } from "express";
import cron from "node-cron";
import { env } from "./env.js";
import { receipts } from "./routes/receipts.js";
import { recipes } from "./routes/recipes.js";
import { photon } from "./routes/photon.js";
import { runDailyNudges } from "./jobs/nudges.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/receipts", receipts);
app.use("/recipes", recipes);
app.use("/photon", photon);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

cron.schedule(env.nudgeCron, async () => {
  const result = await runDailyNudges();
  console.log(`[nudges] wasted=${result.wasted} sent=${result.sent}`);
});

app.listen(env.port, () => console.log(`miple server on http://localhost:${env.port}`));
