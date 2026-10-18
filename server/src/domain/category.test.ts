import assert from "node:assert/strict";
import { test } from "node:test";
import { guessCategory } from "./category.js";

const noLlm = async () => {
  throw new Error("LLM should not be called");
};

test("matcher files common items with the right shelf-life category", async () => {
  const cases: [string, string][] = [
    ["chicken breast", "raw_poultry"],
    ["salmon", "raw_seafood"],
    ["Spinach", "leafy_greens"],
    ["eggs", "eggs"],
    ["ground beef", "raw_meat"],
    ["2% milk", "dairy_milk"],
  ];
  for (const [name, category] of cases) {
    const g = await guessCategory(name, noLlm);
    assert.equal(g.category, category, name);
    assert.equal(g.source, "matcher", name);
  }
});

test("ambiguous names the matcher can't place go to the LLM", async () => {
  const g = await guessCategory("Chicken", async () => "raw_poultry");
  assert.deepEqual(g, { category: "raw_poultry", source: "llm", confidence: 0.8 });
});

test("unknown items go to the LLM", async () => {
  const g = await guessCategory("grandma's zxqv sauce", async () => "condiments");
  assert.deepEqual(g, { category: "condiments", source: "llm", confidence: 0.8 });
});

test("falls back to other when the LLM fails and nothing matched", async () => {
  const g = await guessCategory("zzzz qqqq", async () => {
    throw new Error("down");
  });
  assert.equal(g.category, "other");
  assert.equal(g.source, "default");
});

test("blank names never call anything", async () => {
  assert.equal((await guessCategory("   ", noLlm)).category, "other");
});
