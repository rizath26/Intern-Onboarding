# Receipt Categoriser (GreenChit, Day 5)

Suggests an expense category for an uploaded receipt. See `spec/spec.md` and `spec/acceptance.md`.

## Run the tests
1. Install Node 22 or later.
2. `npm install`
3. `npm test`. This runs AC-01 to AC-12 against stubbed Azure services; AC-07 waits about 2.5 s on purpose.
4. Optional: `npm run typecheck`

## Layout
- `src/categoriser.ts` is the entry point. It validates input, runs OCR, and picks the LLM path or the rule-based path.
- `src/llm-categoriser.ts` is the Azure OpenAI path. It handles the 2.5 s budget and validates the output.
- `src/rule-based-categoriser.ts` is the keyword fallback. Its confidence is never above 0.5.
- `src/pii.ts` masks card numbers before anything is sent to the LLM.
- `src/types.ts` holds the ports (interfaces). The real Azure adapters are wired in the Claims API.
- `ai-session/` holds the prompts and responses, verbatim. `implementation-report.md` holds the review table.
