// PII handling for text that leaves the Claims API (spec §3 "Data boundary").

const CARD_MASK = "[card]";

// A run of 12–19 card characters (digits, or X/* used for masked digits), optionally
// separated by single spaces or hyphens, not glued to surrounding alphanumerics.
const CARD_LIKE = /(?<![0-9A-Za-z*])(?:[0-9Xx*][ -]?){11,18}[0-9Xx*](?![0-9A-Za-z*])/g;

/** Masks anything that looks like a card number, including partially masked ones (e.g. XXXX-XXXX-XXXX-1234). */
export function maskCardNumbers(text: string): string {
  return text.replace(CARD_LIKE, (match) => {
    const digits = match.replace(/[^0-9]/g, "").length;
    return digits >= 4 ? CARD_MASK : match;
  });
}
