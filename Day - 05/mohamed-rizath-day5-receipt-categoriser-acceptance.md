# Receipt Categoriser — Acceptance Criteria

Every criterion is checked from outside the code. Each one checks something that can be observed:
- the HTTP status and response body,
- the emitted customEvents, or
- what was sent to Azure OpenAI and Document Intelligence.

In automated tests, Azure OpenAI, Document Intelligence, App Configuration and Application Insights are replaced with stubs that behave as each "Given" describes.

The thresholds used below come straight from the spec:

| Threshold | Value |
|---|---|
| Needs review | `confidence < 0.6` |
| Maximum file size | 10 MB = 10,485,760 bytes |
| Azure OpenAI time budget | 2.5 s |
| End-to-end p95 latency | 4 s |
| Maximum rule-based confidence | 0.5 |

---

## AC-01 Happy path: clear meal receipt
**Given** a JPEG receipt from a restaurant with items "Chicken kottu x2" and "Lime juice x2", totalling LKR 2,400
**And** Azure OpenAI is healthy
**When** the claimant uploads it via `POST /claims/{id}/receipts/categorise`
**Then** the response is 200 OK with `category: "Meals"`, `confidence ≥ 0.7`, `source: "llm"`, `needsReview: false` and `notice: null`
**And** exactly one `categoriser.suggested` customEvent is emitted within 5 seconds, with `fallbackReason: "none"`

## AC-02 Ambiguous receipt and the "Needs review" threshold
**Given** a receipt with mixed items: "Chicken fried rice", "A4 paper ream" and "Blue pens"
**And** Azure OpenAI answers `Meals` with confidence 0.55
**When** the claimant uploads it
**Then** the response is 200 OK with `category: "Meals"`, `confidence: 0.55` and `needsReview: true`

**And, for the boundary:** if Azure OpenAI answers with confidence exactly 0.6, then `needsReview` is `false`

## AC-03 Azure OpenAI unavailable: fallback
**Given** Azure OpenAI returns 503
**And** the receipt's merchant is "PickMe" with item "PickMe ride Colombo 03 to BIA"
**When** the claimant uploads it
**Then** the response is 200 OK, not 5xx, with `source: "rule-based"`, `category: "Travel"`, `confidence ≤ 0.5` and `needsReview: true`
**And** the `categoriser.suggested` event has `fallbackReason: "llm_unavailable"`

## AC-04 OCR cannot read the receipt
**Given** an image in which Document Intelligence finds no merchant and no line items
**When** the claimant uploads it
**Then** the response is 200 OK with:
- `category: "Other"`
- `confidence: 0`
- `source: "rule-based"`
- `needsReview: true`
- `notice: "We couldn't read this receipt. Please choose a category yourself."`

**And** Azure OpenAI is not called
**And** the `categoriser.suggested` event has `fallbackReason: "ocr_unreadable"`

## AC-05 Oversized payload
**Given** a PNG of 10,485,761 bytes (10 MB + 1 byte)
**When** the claimant uploads it
**Then** the response is 413 with `error: "RECEIPT_TOO_LARGE"`
**And** neither Document Intelligence nor Azure OpenAI is called, and no customEvent is emitted

**And, for the boundary:** a JPEG of exactly 10,485,760 bytes is accepted and returns 200

## AC-06 PII boundary
**Given** a receipt whose line items contain the customer name "Nimal Perera" and the card number "4111 1111 1111 1111", and also "Card XXXX-XXXX-XXXX-1234"
**When** the request is processed
**Then** the `categoriser.suggested` event contains neither "Nimal", "Perera", "4111" nor "1234"
**And** the text sent to Azure OpenAI contains no digit sequence of 12 or more digits, and does not contain the last-4 "1234"

## AC-07 Azure OpenAI too slow: fallback
**Given** Azure OpenAI takes 3 seconds to answer
**When** the claimant uploads a receipt
**Then** the response is 200 OK with `source: "rule-based"` and `confidence ≤ 0.5`, returned in under 4 seconds
**And** the event has `fallbackReason: "llm_timeout"`

## AC-08 Azure OpenAI returns invalid output: fallback
**Given** Azure OpenAI answers with a category outside the five allowed values (for example `"Entertainment"`), or with text that is not JSON
**When** the claimant uploads a receipt
**Then** the response is 200 OK with `source: "rule-based"`, and `category` is one of the five allowed values
**And** the event has `fallbackReason: "llm_invalid_output"`

## AC-09 Unsupported file type
**Given** a PDF file, even if it is named `receipt.jpg`
**When** the claimant uploads it
**Then** the response is 400 with `error: "UNSUPPORTED_FILE_TYPE"`, and no customEvent is emitted

**And** an empty file returns 400 with `error: "INVALID_INPUT"`

## AC-10 Document Intelligence unavailable
**Given** Document Intelligence returns an error or cannot be reached
**When** the claimant uploads a valid receipt
**Then** the response is 502 with `error: "OCR_UNAVAILABLE"`, and no `categoriser.suggested` event is emitted

*(This behaviour is provisional until spec OQ-3 is answered.)*

## AC-11 Feature flag off
**Given** the App Configuration flag `ReceiptCategoriser` is off
**When** the claimant uploads a valid receipt
**Then** the response is 404 with `error: "FEATURE_DISABLED"`
**And** neither Document Intelligence nor Azure OpenAI is called, and no customEvent is emitted

## AC-12 Accepted and overridden choices are logged
**Given** a suggestion `Meals` with suggestionId S
**When** the claimant submits the claim with category `Meals`
**Then** a `categoriser.decided` event is emitted with `suggestionId: S`, `suggestedCategory: "Meals"`, `finalCategory: "Meals"` and `outcome: "accepted"`

**And when** the claimant instead submits with category `Travel`
**Then** the event has `finalCategory: "Travel"` and `outcome: "overridden"`

## AC-13 Latency (load test, not part of the unit suite)
**Given** 100 or more real receipts uploaded to staging against real Azure services
**When** the load test runs
**Then** the p95 time from upload to response is at most 4 seconds
