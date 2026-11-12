// POST /claims/{claimId}/receipts/categorise and decision recording (spec §3).
import { randomUUID } from "node:crypto";
import { categoriseWithLlm } from "./llm-categoriser.js";
import { categoriseByRules } from "./rule-based-categoriser.js";
import {
  FEATURE_FLAG_KEY,
  MAX_RECEIPT_BYTES,
  NEEDS_REVIEW_THRESHOLD,
  UNREADABLE_NOTICE,
  type Category,
  type ErrorBody,
  type FallbackReason,
  type FeatureFlags,
  type HttpResult,
  type LlmClient,
  type OcrClient,
  type ParsedReceipt,
  type Source,
  type Suggestion,
  type Telemetry,
} from "./types.js";

export interface CategoriseRequest {
  claimId: string;
  receipt?: Uint8Array;
}

export interface CategoriserDeps {
  ocr: OcrClient;
  llm: LlmClient;
  telemetry: Telemetry;
  flags: FeatureFlags;
}

export interface DecisionInput {
  suggestionId: string;
  claimId: string;
  suggestedCategory: Category;
  finalCategory: Category;
}

export type DecisionOutcome = "accepted" | "overridden";

function error(status: 400 | 404 | 413 | 502, code: ErrorBody["error"], message: string): HttpResult {
  return { status, body: { error: code, message } };
}

function detectMimeType(bytes: Uint8Array): "image/jpeg" | "image/png" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= PNG.length && PNG.every((b, i) => bytes[i] === b)) return "image/png";
  return null;
}

function isUnreadable(receipt: ParsedReceipt): boolean {
  const hasMerchant = (receipt.merchantName ?? "").trim().length > 0;
  const hasItems = receipt.items.some((i) => i.description.trim().length > 0);
  return !hasMerchant && !hasItems;
}

export async function handleCategorise(req: CategoriseRequest, deps: CategoriserDeps): Promise<HttpResult> {
  const started = Date.now();

  if (!(await deps.flags.isEnabled(FEATURE_FLAG_KEY))) {
    return error(404, "FEATURE_DISABLED", "Receipt categorisation is not available.");
  }

  const { claimId, receipt } = req;
  if (typeof claimId !== "string" || claimId.trim() === "") {
    return error(400, "INVALID_INPUT", "claimId must not be blank.");
  }
  if (!receipt || receipt.length === 0) {
    return error(400, "INVALID_INPUT", "A non-empty receipt file is required.");
  }
  if (receipt.length > MAX_RECEIPT_BYTES) {
    return error(413, "RECEIPT_TOO_LARGE", "The receipt must be at most 10 MB.");
  }
  const mimeType = detectMimeType(receipt);
  if (!mimeType) {
    return error(400, "UNSUPPORTED_FILE_TYPE", "The receipt must be a JPEG or PNG image.");
  }

  let parsed: ParsedReceipt;
  try {
    parsed = await deps.ocr.analyse(receipt, mimeType);
  } catch {
    return error(502, "OCR_UNAVAILABLE", "The receipt could not be processed right now. Please try again.");
  }

  let category: Category;
  let confidence: number;
  let source: Source;
  let fallbackReason: FallbackReason;
  let notice: string | null = null;

  if (isUnreadable(parsed)) {
    category = "Other";
    confidence = 0;
    source = "rule-based";
    fallbackReason = "ocr_unreadable";
    notice = UNREADABLE_NOTICE;
  } else {
    const llm = await categoriseWithLlm(parsed, deps.llm);
    if (llm.ok) {
      ({ category, confidence } = llm);
      source = "llm";
      fallbackReason = "none";
    } else {
      ({ category, confidence } = categoriseByRules(parsed));
      source = "rule-based";
      fallbackReason = llm.reason;
    }
  }

  const suggestion: Suggestion = {
    suggestionId: randomUUID(),
    category,
    confidence,
    source,
    needsReview: confidence < NEEDS_REVIEW_THRESHOLD,
    notice,
  };

  // Only identifiers, enum values and numbers: no receipt text, merchant, names or card numbers.
  deps.telemetry.trackEvent("categoriser.suggested", {
    suggestionId: suggestion.suggestionId,
    claimId,
    category: suggestion.category,
    confidence: suggestion.confidence,
    source: suggestion.source,
    needsReview: suggestion.needsReview,
    fallbackReason,
    latencyMs: Date.now() - started,
  });

  return { status: 200, body: suggestion };
}

/** Called by the Claims API when a claim carrying a suggestionId is submitted. */
export async function recordDecision(input: DecisionInput, deps: Pick<CategoriserDeps, "telemetry" | "flags">): Promise<DecisionOutcome> {
  const outcome: DecisionOutcome = input.suggestedCategory === input.finalCategory ? "accepted" : "overridden";
  if (!(await deps.flags.isEnabled(FEATURE_FLAG_KEY))) return outcome;

  deps.telemetry.trackEvent("categoriser.decided", {
    suggestionId: input.suggestionId,
    claimId: input.claimId,
    suggestedCategory: input.suggestedCategory,
    finalCategory: input.finalCategory,
    outcome,
  });
  return outcome;
}
