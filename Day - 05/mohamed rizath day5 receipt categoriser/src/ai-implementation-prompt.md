# AI implementation prompt (spec-led)

Paste everything below the line into Claude Code, then paste the full contents of `spec/spec.md` and `spec/acceptance.md` where shown.

---

You are implementing the Receipt Categoriser feature in TypeScript (Node 22, ES modules, strict mode).
The complete spec and acceptance criteria are below. They are the only source of truth.
Implement the feature so that every test in `tests/acceptance.test.ts` passes when you run `npm test`.

Constraints:
- Create or edit only these files: `src/categoriser.ts`, `src/llm-categoriser.ts`, `src/rule-based-categoriser.ts`, `src/pii.ts`.
- `src/types.ts` and everything in `tests/` already exist. Do NOT modify them.
- Do not add new npm dependencies.
- `src/categoriser.ts` must export `handleCategorise(req, deps)` and `recordDecision(input, deps)`. Use the types in `src/types.ts` exactly.
- Keep the LLM path (`llm-categoriser.ts`) and the rule-based path (`rule-based-categoriser.ts`) in separate files. `categoriser.ts` chooses between them.
- Do NOT invent fields, endpoints, error codes, events, event properties or behaviour that are not in the spec.
- Do NOT put receipt text, merchant names, people's names or card numbers in any telemetry event.
- Before writing any code, list every ambiguity or gap you see in the spec and say which interpretation you will use. Then implement.

[paste spec/spec.md here]

[paste spec/acceptance.md here]
