// Shared types and constants. Values here come straight from spec.md §3.

export const CATEGORIES = ["Meals", "Travel", "Lodging", "Office Supplies", "Other"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Source = "llm" | "rule-based";

export const NEEDS_REVIEW_THRESHOLD = 0.6;
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024; // 10,485,760
export const LLM_TIMEOUT_MS = 2500;
export const RULE_BASED_MAX_CONFIDENCE = 0.5;
export const FEATURE_FLAG_KEY = "ReceiptCategoriser";
export const UNREADABLE_NOTICE = "We couldn't read this receipt. Please choose a category yourself.";

export type FallbackReason =
  | "none"
  | "llm_unavailable"
  | "llm_timeout"
  | "llm_invalid_output"
  | "ocr_unreadable";

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

// ---- Ports (real Azure adapters live in the Claims API and implement these) ----

export interface ReceiptLineItem {
  description: string;
}

export interface ParsedReceipt {
  merchantName?: string;
  items: ReceiptLineItem[];
}

/** Azure AI Document Intelligence. Throws on outage / upstream error. */
export interface OcrClient {
  analyse(image: Uint8Array, mimeType: "image/jpeg" | "image/png"): Promise<ParsedReceipt>;
}

/** Azure OpenAI (BISTEC tenant). Returns the raw text of the model's reply. Throws on non-2xx. */
export interface LlmClient {
  complete(prompt: { system: string; user: string }, options: { signal: AbortSignal }): Promise<string>;
}

/** Application Insights customEvents. */
export interface Telemetry {
  trackEvent(name: string, properties: Record<string, string | number | boolean>): void;
}

/** Azure App Configuration feature flags. */
export interface FeatureFlags {
  isEnabled(key: string): Promise<boolean>;
}

export interface Suggestion {
  suggestionId: string;
  category: Category;
  confidence: number;
  source: Source;
  needsReview: boolean;
  notice: string | null;
}

export interface ErrorBody {
  error: "INVALID_INPUT" | "UNSUPPORTED_FILE_TYPE" | "RECEIPT_TOO_LARGE" | "OCR_UNAVAILABLE" | "FEATURE_DISABLED";
  message: string;
}

export type HttpResult =
  | { status: 200; body: Suggestion }
  | { status: 400 | 404 | 413 | 502; body: ErrorBody };
