// `npm run nudge`: fire the daily nudge job now (handy for the demo).
import { runDailyNudges } from "./nudges.js";

const result = await runDailyNudges();
console.log(`[nudges] wasted=${result.wasted} sent=${result.sent}`);
