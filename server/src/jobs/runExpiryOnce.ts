// `npm run expire-items`: run the nightly expiry job now.
import { markExpiredWasted } from "./expireItems.js";

console.log(`[expiry] marked ${await markExpiredWasted()} expired items as wasted`);
