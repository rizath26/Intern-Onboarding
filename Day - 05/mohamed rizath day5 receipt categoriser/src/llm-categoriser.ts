// Azure OpenAI path. Sends only the merchant name and line-item descriptions, with card numbers masked.
import { maskCardNumbers } from "./pii.js";
import { CATEGORIES, LLM_TIMEOUT_MS, isCategory, type Category, type LlmClient, type ParsedReceipt } from "./types.js";

export type LlmResult =
  | { ok: true; category: Category; confidence: number }
  | { ok: false; reason: "llm_unavailable" | "llm_timeout" | "llm_invalid_output" };

const SYSTEM_PROMPT =
  `You categorise expense receipts. Choose exactly one category from: ${CATEGORIES.join(", ")}. ` +
  `Reply with JSON only, in the form {"category": "<one of the categories>", "confidence": <number from 0 to 1>}.`;

function buildPrompt(receipt: ParsedReceipt): { system: string; user: string } {
  const lines = [`Merchant: ${receipt.merchantName ?? ""}`, "Items:", ...receipt.items.map((i) => `- ${i.description}`)];
  return { system: SYSTEM_PROMPT, user: maskCardNumbers(lines.join("\n")) };
}

function parseReply(reply: string): { category: Category; confidence: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.trim());
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { category, confidence } = parsed as Record<string, unknown>;
  if (!isCategory(category)) return null;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  return { category, confidence };
}

const TIMEOUT = Symbol("timeout");

export async function categoriseWithLlm(receipt: ParsedReceipt, llm: LlmClient): Promise<LlmResult> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true; // set before abort(): a client may reject synchronously on abort
      resolve(TIMEOUT);
      controller.abort();
    }, LLM_TIMEOUT_MS);
  });

  const call = llm.complete(buildPrompt(receipt), { signal: controller.signal });
  call.catch(() => undefined); // a late rejection after timeout must not become unhandled

  let reply: string | typeof TIMEOUT;
  try {
    reply = await Promise.race([call, timeout]);
  } catch {
    return { ok: false, reason: timedOut ? "llm_timeout" : "llm_unavailable" };
  } finally {
    clearTimeout(timer);
  }

  if (reply === TIMEOUT) return { ok: false, reason: "llm_timeout" };
  const parsed = parseReply(reply);
  return parsed ? { ok: true, ...parsed } : { ok: false, reason: "llm_invalid_output" };
}
