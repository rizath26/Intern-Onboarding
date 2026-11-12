# AI-Driven Implementation Report — Mohamed Rizath

**Agent:** Claude Code v2.1.322 (Opus 5.5), 12 Nov 2026
**Working folder:** a clean copy (`ai-run/`) containing only `spec/`, `tests/`, `src/types.ts`, `package.json`, `package-lock.json` and `tsconfig.json`. The agent could not see any existing implementation.
**Full transcripts:** `ai-session/response-1.md` and `ai-session/response-2.md`

| # | What you asked the AI | What it produced | Did it match the spec? | Your fix / follow-up |
|---|---|---|---|---|
| 1 | First implementation pass (`prompt-1.md`): implement from `spec.md` + `acceptance.md`, only 4 files, no invented fields, list ambiguities first | Listed 13 ambiguities, then wrote `categoriser.ts`, `llm-categoriser.ts`, `rule-based-categoriser.ts`, `pii.ts`. **Its first test run failed AC-07**: a 2.5 s timeout was reported as `llm_unavailable` instead of `llm_timeout`, because aborting the request made the call reject before the timeout was recorded. The agent fixed it itself; 16/16 then passed. | **Partial.** The contract was followed, but (a) the first version broke AC-07, and (b) the rule-based keyword lists were tuned to the spec's own examples: Travel contains `"bia"` (from E3) and Meals contains `"chicken"`, `"kottu"`, `"juice"` (from E1). | Did not trust the agent's "all pass": ran `npm test` myself → **16/16 passed**. Recorded the keyword overfitting as a deviation (see below). |
| 2 | Verify against ACs and audit every addition against Contract §3 (`prompt-2.md`) | Re-ran tests + typecheck (all pass, nothing to fix). Produced a contract audit table. **Removed 2 things not in the spec:** a configurable `timeoutMs` parameter (now always the fixed 2.5 s) and public exports of `buildPrompt` / `parseReply`. Kept other choices with reasons, and listed choices the spec does not decide. | **Yes for the contract** (error codes, response fields, event properties all exactly as specified). **But** its self-audit did not notice that its keyword list was copied from the spec examples. | Accepted both removals. Logged the missed overfitting as an example of why the agent's self-review is not enough. |
| 3 | (No prompt.) My own review of the decisions the agent flagged | Agent flagged: person names (e.g. "Customer: Nimal Perera") are sent to Azure OpenAI because the spec only requires card numbers to be masked; `recordDecision` still returns an outcome when the flag is off (but emits no event); a keyword tie gives `Other` at 0.0. | Names: **spec gap, not an agent error.** The agent followed the spec exactly and raised it honestly. The other two are consistent with the spec. | Names: add an open question to spec v0.2 (see below). Other two: accepted, to be written into the spec so they are not decided only in code. |

## Ambiguities the agent raised before coding
The agent listed 13. The most useful:
- **Order of checks** (flag vs input validation) — the spec did not say. It chose flag first, so the kill switch always wins.
- **Timeout vs unavailable** — how to tell them apart. Its interpretation was right, but its first implementation still got it wrong (row 1).
- **Person names reaching Azure OpenAI** — a real gap in my spec.
- **Rule-based keywords and confidence** — the spec gives no keyword list, so the agent invented one.

## Deviations from the spec (recorded honestly)
1. **AC-07 failed on the first run.** The timeout was mislabelled as an outage. Caught by the acceptance test, fixed by the agent.
2. **Keywords overfitted to the spec's examples.** `"bia"`, `"chicken"`, `"kottu"` and `"juice"` make the tests and examples pass but say little about real receipts. The agent's own audit (prompt 2) missed this.
3. **Added a configurable timeout and public helpers** that the spec did not ask for. Removed by the agent when asked to audit against the contract.
4. **Lodging includes `"hotel"`.** In Sri Lanka "hotel" often means a small eatery, so this can misclassify meals. My spec never said this, so it is a spec gap as much as an agent choice.

## Final test result
- Tests passing: **16 / 16**, verified by running `npm test` myself, not only by the agent's report.
- Typecheck: clean (`tsc --noEmit` exit 0).

## What I would change in the spec next time (v0.2)
- **Add OQ-9:** "May person names on a receipt be sent to Azure OpenAI (inside the tenant), or must they be removed first?" Owner: PO / data protection.
- **Add an acceptance criterion with receipts that are *not* in the examples** (e.g. a Keells supermarket receipt, a Dialog bill), so a fallback tuned only to the examples fails.
- **Say what the rule-based fallback returns for a tie or no match**, instead of leaving it to the agent.
- **Say whether the flag check comes before input validation.**
- **Note that "hotel" is ambiguous in Sri Lanka**, so whoever writes the keyword list is warned.
