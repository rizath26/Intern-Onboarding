// Entry points used by the Claims API:
//   handleCategorise  -> POST /claims/{claimId}/receipts/categorise
//   recordDecision    -> called by the existing submit-claim handler
// Framework-agnostic: returns { status, body } so any HTTP layer can map it.

import { randomUUID } from "node:crypto";
import { categoriseWithLlm } from "./llm-categoriser.js";
import { categoriseByRules } from "./rule-based-categoriser.js";
import {
  Category,
  FallbackReason,
  FEATURE_FLAG_KEY,
  FeatureFlags,
  HttpResult,
  LLM_TIMEOUT_MS,
  LlmClient,
  MAX_RECEIPT_BYTES,
  NEEDS_REVIEW_THRESHOLD,
  OcrClient,
  ParsedReceipt,
  Source,
  Suggestion,
  Telemetry,
  UNREADABLE_NOTICE,
  isCategory,
} from "./types.js";

export interface CategoriserDeps {
  ocr: OcrClient;
  llm: LlmClient;
  telemetry: Telemetry;
  flags: FeatureFlags;
  /** Overridable for tests only; defaults come from the spec. */
  llmTimeoutMs?: number;
  newId?: () => string;
}

export interface CategoriseRequest {
  claimId: string;
  receipt: Uint8Array | undefined;
}

export function detectImageType(bytes: Uint8Array): "image/jpeg" | "image/png" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((b, i) => bytes[i] === b)) return "image/png";
  return null;
}

function isUnreadable(receipt: ParsedReceipt | null | undefined): boolean {
  if (!receipt) return true;
  const hasMerchant = (receipt.merchantName ?? "").trim().length > 0;
  const hasItems = (receipt.items ?? []).some((i) => (i?.description ?? "").trim().length > 0);
  return !hasMerchant && !hasItems;
}

export async function handleCategorise(req: CategoriseRequest, deps: CategoriserDeps): Promise<HttpResult> {
  const startedAt = Date.now();

  // Kill switch first: when off, nothing is called and nothing is logged (AC-11).
  if (!(await deps.flags.isEnabled(FEATURE_FLAG_KEY))) {
    return { status: 404, body: { error: "FEATURE_DISABLED", message: "Receipt categorisation is turned off." } };
  }

  // Input validation (AC-05, AC-09).
  if (!req.claimId || req.claimId.trim() === "") {
    return { status: 400, body: { error: "INVALID_INPUT", message: "claimId is required." } };
  }
  if (!req.receipt || req.receipt.length === 0) {
    return { status: 400, body: { error: "INVALID_INPUT", message: "A receipt image is required." } };
  }
  if (req.receipt.length > MAX_RECEIPT_BYTES) {
    return { status: 413, body: { error: "RECEIPT_TOO_LARGE", message: "Receipt must be 10 MB or smaller." } };
  }
  const mimeType = detectImageType(req.receipt);
  if (!mimeType) {
    return { status: 400, body: { error: "UNSUPPORTED_FILE_TYPE", message: "Receipt must be a JPEG or PNG image." } };
  }

  // OCR (AC-10: outage -> 502, no event).
  let receipt: ParsedReceipt;
  try {
    receipt = await deps.ocr.analyse(req.receipt, mimeType);
  } catch {
    return { status: 502, body: { error: "OCR_UNAVAILABLE", message: "Receipt reading is temporarily unavailable. Please try again." } };
  }

  let category: Category;
  let confidence: number;
  let source: Source;
  let fallbackReason: FallbackReason;
  let notice: string | null = null;

  if (isUnreadable(receipt)) {
    // AC-04: no LLM call, Other / 0 / notice.
    category = "Other";
    confidence = 0;
    source = "rule-based";
    fallbackReason = "ocr_unreadable";
    notice = UNREADABLE_NOTICE;
  } else {
    const llm = await categoriseWithLlm(receipt, deps.llm, deps.llmTimeoutMs ?? LLM_TIMEOUT_MS);
    if (llm.ok) {
      ({ category, confidence } = llm);
      source = "llm";
      fallbackReason = "none";
    } else {
      ({ category, confidence } = categoriseByRules(receipt));
      source = "rule-based";
      fallbackReason = llm.reason;
    }
  }

  const suggestion: Suggestion = {
    suggestionId: (deps.newId ?? randomUUID)(),
    category,
    confidence,
    source,
    needsReview: confidence < NEEDS_REVIEW_THRESHOLD,
    notice,
  };

  // AC-06: only IDs, enums and numbers — never receipt text.
  deps.telemetry.trackEvent("categoriser.suggested", {
    suggestionId: suggestion.suggestionId,
    claimId: req.claimId,
    category: suggestion.category,
    confidence: suggestion.confidence,
    source: suggestion.source,
    needsReview: suggestion.needsReview,
    fallbackReason,
    latencyMs: Date.now() - startedAt,
  });

  return { status: 200, body: suggestion };
}

export interface DecisionInput {
  suggestionId: string;
  claimId: string;
  suggestedCategory: Category;
  finalCategory: Category;
}

/** AC-12. Returns the outcome, or null when the feature flag is off (nothing logged). */
export async function recordDecision(
  input: DecisionInput,
  deps: Pick<CategoriserDeps, "telemetry" | "flags">,
): Promise<"accepted" | "overridden" | null> {
  if (!(await deps.flags.isEnabled(FEATURE_FLAG_KEY))) return null;
  if (!input.suggestionId || !isCategory(input.suggestedCategory) || !isCategory(input.finalCategory)) {
    throw new TypeError("recordDecision: suggestionId and two valid categories are required.");
  }
  const outcome = input.suggestedCategory === input.finalCategory ? "accepted" : "overridden";
  deps.telemetry.trackEvent("categoriser.decided", {
    suggestionId: input.suggestionId,
    claimId: input.claimId,
    suggestedCategory: input.suggestedCategory,
    finalCategory: input.finalCategory,
    outcome,
  });
  return outcome;
}
