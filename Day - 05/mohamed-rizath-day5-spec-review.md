# Receipt Categoriser — Spec Review

> **TEMPLATE.** Fill this in during Hour 4 with your review buddy. Everything in *italics* is guidance. Delete it before you submit.
> Every smell needs a **direct quote** and a **rewrite**. Writing only "be more specific" loses marks.

## Setup
- Reviewer pair: Mohamed Rizath ↔ Oneth
- Spec version reviewed (theirs): {commit hash}
- Spec version reviewed (mine): {commit hash}

## Results Summary
| Metric | Target | Achieved |
|--------|--------|----------|
| Smells found in their spec | 5+ | |
| Smells found in mine | 3+ | |
| Acceptance criteria you pushed back on | 1+ | |
| Reviewer disagreements that produced a real change | 1+ | |

## Smell log
| # | Reviewer | Section | Smell type (vague / hidden assumption / embedded solution) | Quote | Suggested rewrite |
|---|---|---|---|---|---|
| 1 | given to | | | | |
| 2 | given to | | | | |
| 3 | given to | | | | |
| 4 | given to | | | | |
| 5 | given to | | | | |
| 6 | received from | | | | |
| 7 | received from | | | | |
| 8 | received from | | | | |

*Where to hunt in their spec. These are common in Receipt Categoriser specs:*
- *Vague: "fast", "secure", "handle failures gracefully", "clear message". Ask for the number, the exact text, or the condition.*
- *Vague: an acceptance criterion with no threshold, such as "confidence is high". Ask whether it is ≥ 0.7 and whether it uses < 0.6.*
- *Hidden assumption: OCR failure and OCR **outage** treated as the same thing, or not mentioned at all.*
- *Hidden assumption: the claimant is logged in or owns the claim, but the spec never says so.*
- *Hidden assumption: an event "logs every suggestion" but doesn't say whether fallbacks and unreadable receipts are included.*
- *Hidden assumption: no rule for what happens when the LLM returns a category outside the five.*
- *Embedded solution: "use Redis or Cosmos DB", "retry 3 times with exponential backoff", "use gpt-4.1-mini", or a named library. Move these to Open questions or an ADR.*
- *Retroactively closed: "Open question: what threshold for Needs review?" The requirements already fix it at 0.6.*
- *Implementation-bound AC: "the function calls the fallback". Ask what the caller can actually observe.*

## Feedback given (their spec)
**Strengths**
- 
- 
- 

**Risks**
- 
- 
- 

**Concrete rewrites (before → after)**
1. Before: "…" → After: "…"
2. Before: "…" → After: "…"
3. Before: "…" → After: "…"

## Feedback received (my spec)
**Strengths**
- 

**Risks**
- 

**Rewrites I accepted vs pushed back on, and why**
| Their suggestion | Accepted / pushed back | Why |
|---|---|---|
| | | |

*These are known weak spots in my spec. Your reviewer may raise them, so be ready to discuss:*
- *Section 1, Why: "wrong categories get sent back by finance" has no evidence. It is a **hidden assumption**, which is why it is labelled "to confirm with the GreenChit PO".*
- *Contract: "LLM time budget 2.5 s" could be called an **embedded solution**. My defence: it is a behaviour the caller can observe, and the 4 s p95 needs it. If you disagree, it could move to OQ-7.*
- *OQ-3 already has a provisional answer (502). A reviewer may say it is "retroactively closed". My defence: it is labelled provisional, and I cannot test it without a default.*
- *`categoriser.decided` is an event name I invented. It is flagged as OQ-5.*
- *The keyword list in the rule-based fallback is not in the spec. Is it hidden design?*

## Reflection
*Write this in your own words after the review. Graders mark boilerplate down.*
- Which class of smell did your spec suffer most from? 
- Which class did you find easiest to spot in someone else's? 
- One disagreement with my reviewer, and how it ended:
