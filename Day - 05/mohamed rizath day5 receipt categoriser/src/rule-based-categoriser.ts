// Rule-based fallback (spec §2 scope item 2). Runs locally; never exceeds RULE_BASED_MAX_CONFIDENCE.
import { RULE_BASED_MAX_CONFIDENCE, type Category, type ParsedReceipt } from "./types.js";

const KEYWORDS: Record<Exclude<Category, "Other">, string[]> = {
  Meals: ["restaurant", "cafe", "coffee", "tea", "kottu", "rice", "juice", "lunch", "dinner", "breakfast", "meal", "food", "chicken", "burger", "pizza"],
  Travel: ["ride", "taxi", "cab", "pickme", "uber", "airport", "bia", "flight", "airline", "train", "bus", "fuel", "petrol", "parking", "toll"],
  Lodging: ["hotel", "room", "lodge", "inn", "resort", "accommodation", "guesthouse"],
  "Office Supplies": ["paper", "pen", "pens", "stapler", "ink", "toner", "notebook", "envelope", "folder", "a4", "stationery"],
};

export interface RuleBasedResult {
  category: Category;
  confidence: number;
}

/** Picks the category with the most keyword hits. No hits or a tie → "Other" with confidence 0. */
export function categoriseByRules(receipt: ParsedReceipt): RuleBasedResult {
  const text = [receipt.merchantName ?? "", ...receipt.items.map((i) => i.description)].join(" ").toLowerCase();
  const words = new Set(text.split(/[^a-z0-9]+/).filter(Boolean));

  let best: Category = "Other";
  let bestScore = 0;
  let tie = false;
  for (const [category, keywords] of Object.entries(KEYWORDS) as [Category, string[]][]) {
    const score = keywords.filter((k) => words.has(k)).length;
    if (score > bestScore) {
      best = category;
      bestScore = score;
      tie = false;
    } else if (score > 0 && score === bestScore) {
      tie = true;
    }
  }

  if (bestScore === 0 || tie) return { category: "Other", confidence: 0 };
  return { category: best, confidence: RULE_BASED_MAX_CONFIDENCE };
}
