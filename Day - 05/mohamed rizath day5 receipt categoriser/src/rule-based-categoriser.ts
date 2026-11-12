// Keyword fallback used when the LLM is unavailable, slow, or returns invalid output.
// Confidence is capped at 0.5 (spec §3), so every rule-based suggestion "Needs review".

import { CATEGORIES, Category, ParsedReceipt, RULE_BASED_MAX_CONFIDENCE } from "./types.js";

// Note: "hotel" is deliberately absent. In Sri Lanka it often means a small eatery,
// so it is ambiguous between Meals and Lodging.
const KEYWORDS: Record<Exclude<Category, "Other">, string[]> = {
  Meals: [
    "restaurant", "cafe", "café", "coffee", "tea", "lunch", "dinner", "breakfast", "meal", "food",
    "rice", "curry", "kottu", "hoppers", "juice", "burger", "pizza", "sandwich", "bakery", "buffet",
  ],
  Travel: [
    "taxi", "uber", "pickme", "ride", "fuel", "petrol", "diesel", "train", "bus", "flight", "airline",
    "airport", "parking", "toll", "tuk", "fare",
  ],
  Lodging: [
    "room", "accommodation", "lodging", "guest house", "guesthouse", "resort", "villa", "check-in",
    "check-out", "night stay", "bungalow",
  ],
  "Office Supplies": [
    "pen", "pens", "pencil", "paper", "a4", "stapler", "staples", "notebook", "printer", "toner", "ink",
    "cartridge", "envelope", "folder", "stationery", "marker", "highlighter", "file",
  ],
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PATTERNS = Object.fromEntries(
  Object.entries(KEYWORDS).map(([category, words]) => [
    category,
    new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`, "iu"),
  ]),
) as Record<Exclude<Category, "Other">, RegExp>;

export interface RuleBasedResult {
  category: Category;
  confidence: number;
}

export function categoriseByRules(receipt: ParsedReceipt): RuleBasedResult {
  const texts = [receipt.merchantName ?? "", ...receipt.items.map((i) => i.description)].filter(
    (t) => t.trim().length > 0,
  );

  const scores = new Map<Category, number>();
  for (const text of texts) {
    for (const [category, pattern] of Object.entries(PATTERNS) as [Category, RegExp][]) {
      if (pattern.test(text)) scores.set(category, (scores.get(category) ?? 0) + 1);
    }
  }

  const total = [...scores.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return { category: "Other", confidence: 0.2 };

  // Highest score wins; ties are broken by the fixed order in CATEGORIES (deterministic).
  let best: Category = "Other";
  let bestScore = 0;
  for (const category of CATEGORIES) {
    const score = scores.get(category) ?? 0;
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }

  const confidence = Math.round(RULE_BASED_MAX_CONFIDENCE * (bestScore / total) * 100) / 100;
  return { category: best, confidence };
}
