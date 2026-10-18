import assert from "node:assert/strict";
import { test } from "node:test";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role";
process.env.GOOGLE_CLOUD_PROJECT ??= "test-project";

const { geminiJsonSchema } = await import("./gemini.js");
const { ChefTurn, GeneratedRecipes, ParsedReceipt } = await import("../domain/schemas.js");

// Gemini answers "400 Request contains an invalid argument" for these; see geminiJsonSchema.
const REJECTED = ['"$schema"', '"maxItems"', '"minItems"', String(Number.MAX_SAFE_INTEGER)];

test("schemas sent to Gemini drop keywords it rejects", () => {
  for (const schema of [ChefTurn, GeneratedRecipes, ParsedReceipt]) {
    const json = JSON.stringify(geminiJsonSchema(schema));
    for (const bad of REJECTED) assert.ok(!json.includes(bad), `${bad} left in schema`);
  }
});

test("real bounds and enums survive", () => {
  const json = JSON.stringify(geminiJsonSchema(ChefTurn));
  assert.ok(json.includes('"maximum":240'), "timer_minutes bound kept");
  assert.ok(json.includes('"enum":["add","replace","skip"]'));
});
