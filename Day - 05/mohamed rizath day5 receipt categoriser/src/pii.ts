// Masks card-number-like text before anything is sent to the LLM (spec §3 Side effects, AC-06).

// 12-19 digits, optionally separated by single spaces or dashes.
const FULL_CARD = /\b(?:\d[ -]?){11,18}\d\b/g;
// Masked cards ending in last-4, e.g. "XXXX-XXXX-XXXX-1234", "**** 1234", "•••• 1234".
const MASKED_CARD = /(?:[*Xx•#]{2,}[ -]?){1,4}\d{4}\b/g;

export function maskCardNumbers(text: string): string {
  return text.replace(FULL_CARD, "[CARD]").replace(MASKED_CARD, "[CARD]");
}
