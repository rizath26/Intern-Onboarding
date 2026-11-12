# Receipt Categoriser — Feature Spec v0.1

| | |
|---|---|
| Author | Mohamed Rizath |
| Status | Draft for review |
| Builds on | GreenChit Claims API (Day 4 design) |
| Acceptance criteria | `acceptance.md` (AC-01 to AC-13) |

---

## 1. Why

**Problem (to confirm with the GreenChit product owner):** Today the claimant picks the expense category by hand on every claim. If they pick the wrong one, finance sends the claim back, and that slows down reimbursement.

**Outcome:** When the claimant uploads a receipt, GreenChit suggests the category. The claimant then only has to confirm it or change it.

**Metrics this feature should move:**
- **Primary: suggestion acceptance rate.** This is accepted ÷ (accepted + overridden), counted from `categoriser.decided` events. The target is set after a 2-week baseline with the feature flag on (see OQ-1).
- **Secondary: share of suggestions flagged "Needs review".** Lower is better.

## 2. Scope

**In scope**
1. A new endpoint, `POST /claims/{claimId}/receipts/categorise`. It takes one receipt image and returns one category suggestion.
2. A rule-based fallback, used when Azure OpenAI fails or is too slow. The whole feature sits behind one feature flag.
3. Recording the claimant's final choice (accepted or overridden) when the claim is submitted.

**Day 4 containers and services affected**
- **Claims API:** a new route and a new categoriser module.
- **Azure AI Document Intelligence:** new outbound OCR call, inside the BISTEC tenant.
- **Azure OpenAI (gpt-4.1 family):** new outbound call, inside the BISTEC tenant.
- **Application Insights:** two new customEvents.
- **Azure App Configuration:** one new feature flag, `ReceiptCategoriser`.
- **Claimant web app:** shows the suggestion, a "Needs review" badge, and any notice. The category field stays editable.

**Assumptions (stated so they are not hidden)**
- The existing Claims API middleware has already authenticated the caller and checked they may access `claimId`. Unknown claims and unauthorised callers get the existing 401, 403 and 404 responses. This feature does not change that.
- Each request carries exactly one receipt.

## 3. Contract

### Inputs
`POST /claims/{claimId}/receipts/categorise`, sent as `multipart/form-data` with a field named `receipt`.

| Input | Rule |
|---|---|
| `claimId` (path) | Must not be blank |
| `receipt` (file) | JPEG or PNG. The type is detected from the file's bytes, not its extension. Size must be at least 1 byte and at most 10 MB (10,485,760 bytes). |

### Outputs — 200 OK
```json
{
  "suggestionId": "uuid",
  "category": "Meals | Travel | Lodging | Office Supplies | Other",
  "confidence": 0.0,
  "source": "llm | rule-based",
  "needsReview": true,
  "notice": "string or null"
}
```

**Rules for the response**
- `needsReview` is `true` exactly when `confidence < 0.6`. A confidence of 0.6 itself does **not** need review.
- If `source` is `"rule-based"`, then `confidence ≤ 0.5`. Rule-based suggestions therefore always need review.
- The system falls back to rule-based when Azure OpenAI does any of these:
  - returns an error,
  - does not answer within **2.5 s**, or
  - answers with something other than JSON whose `category` is one of the 5 values and whose `confidence` is in [0, 1].
- If Document Intelligence reads no merchant and no line items, the receipt is **unreadable**. The response is then `category: "Other"`, `confidence: 0.0`, `source: "rule-based"`, `needsReview: true`, and `notice: "We couldn't read this receipt. Please choose a category yourself."` No LLM call is made.
- In every other case, `notice` is `null`.

### Errors
| Status | `error` code | When |
|---|---|---|
| 400 | `INVALID_INPUT` | No file, an empty file, or a blank `claimId` |
| 400 | `UNSUPPORTED_FILE_TYPE` | The file is not JPEG or PNG |
| 413 | `RECEIPT_TOO_LARGE` | The file is larger than 10,485,760 bytes |
| 502 | `OCR_UNAVAILABLE` | Document Intelligence fails or cannot be reached (provisional, see OQ-3) |
| 404 | `FEATURE_DISABLED` | The `ReceiptCategoriser` flag is off |

The error body is always `{ "error": "<code>", "message": "<text>" }`. Azure OpenAI problems **never** produce an error, because they fall back to rule-based instead.

### Decision recording (at claim submission)
When the claimant submits a claim that has a `suggestionId`, the Claims API records the suggested category and the final category. The outcome is `accepted` if they are equal and `overridden` otherwise.

### Side effects
- **`categoriser.suggested` customEvent.** Emitted on **every** 200 response, including fallbacks and unreadable receipts. Its properties are:
  - `suggestionId`, `claimId`, `category`, `confidence`, `source`, `needsReview`,
  - `fallbackReason`, which is one of `none`, `llm_unavailable`, `llm_timeout`, `llm_invalid_output`, or `ocr_unreadable`,
  - `latencyMs`.

  It is **not** emitted for 4xx or 502 responses.
- **`categoriser.decided` customEvent.** Its properties are `suggestionId`, `claimId`, `suggestedCategory`, `finalCategory`, and `outcome`.
- **No PII in events.** Neither event contains receipt text, the merchant name, any person's name, or any card number.
- **Data boundary.** Data leaves the Claims API only to Document Intelligence and Azure OpenAI, both inside the BISTEC tenant. Azure OpenAI receives only the merchant name and the line-item descriptions. Anything that looks like a card number is masked before sending.
- **No storage.** This feature does not store the receipt image.
- **Flag off.** When the flag is off, nothing is called (no OCR, no LLM) and no events are emitted.

### Non-functional targets
- **Latency:** p95 of at most 4 s from upload to response. This is measured over at least 100 requests in staging (AC-13).
- **Cost:** average cost of at most LKR 5 per suggestion at about 2,000 suggestions per month (see OQ-2).
- **Kill switch:** turning off the App Configuration flag `ReceiptCategoriser` disables the feature without a deploy.

## 4. Acceptance criteria
The full Given/When/Then set is in `acceptance.md`. In summary:

| AC | Covers |
|---|---|
| AC-01 | Happy path: meal receipt |
| AC-02 | Ambiguous receipt and the 0.6 threshold boundary |
| AC-03 | Azure OpenAI returns 503, so the system falls back |
| AC-04 | Unreadable receipt |
| AC-05 | Oversized file and the exact 10 MB boundary |
| AC-06 | PII boundary |
| AC-07 | Azure OpenAI too slow, so the system falls back |
| AC-08 | Azure OpenAI returns invalid output, so the system falls back |
| AC-09 | Unsupported file type |
| AC-10 | Document Intelligence is down |
| AC-11 | Feature flag is off |
| AC-12 | Accepted and overridden choices are logged |
| AC-13 | p95 latency (load test) |

## 5. Examples

| # | Kind | Input | Azure OpenAI | Expected result |
|---|---|---|---|---|
| E1 | Happy | Restaurant bill: "Chicken kottu ×2", "Lime juice ×2", total LKR 2,400 | `{Meals, 0.92}` | 200, `Meals`, 0.92, `llm`, `needsReview: false`, `notice: null` |
| E2 | Ambiguous | "Chicken fried rice", "A4 paper ream", "Blue pens" | `{Meals, 0.55}` | 200, `Meals`, 0.55, `llm`, `needsReview: true` |
| E3 | Degraded | Merchant "PickMe", item "PickMe ride Colombo 03 to BIA" | 503 | 200, `Travel`, 0.5, `rule-based`, `needsReview: true` |
| E4 | Negative | Blurred photo; OCR finds no merchant and no items | not called | 200, `Other`, 0.0, `rule-based`, `needsReview: true`, with the unreadable notice |
| E5 | Negative | A PNG of 12 MB | not called | 413 `RECEIPT_TOO_LARGE` |
| E6 | Negative | A PDF file | not called | 400 `UNSUPPORTED_FILE_TYPE` |

## 6. Out of scope
These could reasonably be in scope, but they are **not** part of v0.1:
- Uploading several receipts in one batch.
- Submitting the claim automatically without the claimant confirming.
- PDF, HEIC, or multi-page receipts.
- Learning from overrides or retraining. Override data is only logged.
- Filling in the amount, date, or merchant on the claim from the receipt.
- Splitting one receipt across more than one category (per-line categories).
- Changing the 5 categories, or an admin screen for the fallback rules.
- Storing or archiving receipt images. Existing attachment behaviour is unchanged.

## 7. Open questions

| # | Question | Why it matters | Owner |
|---|---|---|---|
| OQ-1 | What acceptance rate counts as success, and who signs off the baseline? | Without a target, we cannot tell whether v0.1 worked. | GreenChit PO |
| OQ-2 | Does the LKR 5 cap include the Document Intelligence cost, or only Azure OpenAI? | OCR priced per page could use up most of the budget on its own. | PO + Finance |
| OQ-3 | When Document Intelligence is **down**, should we return 502 (the claimant retries) or 200 with `Other` (as for unreadable receipts)? The requirement says "fails OCR", which could mean either. | **Provisional:** 502, so outages are visible. Needs confirmation before production. | PO |
| OQ-4 | Where is the suggested category kept between upload and submit: on the claim draft, or sent back by the web app? | If the web app sends it, the client could tamper with the accepted/overridden data. | Claims API team |
| OQ-5 | The constraints name only `categoriser.suggested`. Is `categoriser.decided` the right name for the decision event? | The evaluation dashboards depend on event names. | Model-evaluation owner |
| OQ-6 | Can the Document Intelligence receipt model read receipts written in Sinhala or Tamil? | If not, those receipts always come back as `Other`. | Spike: test 20 local receipts |
| OQ-7 | What is the p95 latency of Document Intelligence on its own? | If it is above about 1.5 s, a 2.5 s Azure OpenAI budget cannot meet the 4 s p95. | Measure in staging |
| OQ-8 | Should we use gpt-4.1 or gpt-4.1-mini? | Trade-off between cost, latency and accuracy. Decide from a 50-receipt comparison. | Tech lead |
