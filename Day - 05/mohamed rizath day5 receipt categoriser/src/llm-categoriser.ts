// LLM path: Azure OpenAI in the BISTEC tenant. Never throws — every failure becomes a fallback reason.

import { maskCardNumbers } from "./pii.js";
import { CATEGORIES, Category, LlmClient, ParsedReceipt, isCategory } from "./types.js";

export type LlmOutcome =
  | { ok: true; category: Category; confidence: number }
  | { ok: false; reason: "llm_unavailable" | "llm_timeout" | "llm_invalid_output" };

const SYSTEM_PROMPT = [
  "You categorise business expense receipts.",
  `Choose exactly one category from: ${CATEGORIES.join(", ")}.`,
  'Reply with JSON only, no other text: {"category": "<one of the categories>", "confidence": <number from 0 to 1>}.',
  "Use a lower confidence when the items belong to more than one category.",
].join("\n");

/** Only merchant name and line-item descriptions are sent, with card numbers masked (spec §3). */
export function buildPrompt(receipt: ParsedReceipt): { system: string; user: string } {
  const lines: string[] = [];
  if (receipt.merchantName) lines.push(`Merchant: ${maskCardNumbers(receipt.merchantName)}`);
  lines.push("Line items:");
  for (const item of receipt.items) lines.push(`- ${maskCardNumbers(item.description)}`);
  return { system: SYSTEM_PROMPT, user: lines.join("\n") };
}

/** Returns null unless the reply is JSON with an allowed category and a confidence in [0, 1]. */
export function parseLlmReply(text: unknown): { category: Category; confidence: number } | null {
  if (typeof text !== "string") return null;
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { category, confidence } = parsed as Record<string, unknown>;
  if (!isCategory(category)) return null;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return null;
  }
  return { category, confidence };
}

class LlmTimeoutError extends Error {}

export async function categoriseWithLlm(
  receipt: ParsedReceipt,
  llm: LlmClient,
  timeoutMs: number,
): Promise<LlmOutcome> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Mark the timeout BEFORE aborting: aborting can make the client reject first,
      // and that must still be reported as a timeout, not an outage.
      timedOut = true;
      reject(new LlmTimeoutError());
      controller.abort();
    }, timeoutMs);
  });

  let reply: string;
  try {
    reply = await Promise.race([llm.complete(buildPrompt(receipt), { signal: controller.signal }), timeout]);
  } catch {
    return { ok: false, reason: timedOut ? "llm_timeout" : "llm_unavailable" };
  } finally {
    clearTimeout(timer);
  }

  const parsed = parseLlmReply(reply);
  return parsed ? { ok: true, ...parsed } : { ok: false, reason: "llm_invalid_output" };
}
