# Prompt 1 — First implementation pass (verbatim)

**Sent to:** Claude Code v2.1.322 (Opus 5.5), 12 Nov 2026
**Working folder:** `ai-run/` — only `spec/`, `tests/`, `src/types.ts`, `package.json`, `package-lock.json`, `tsconfig.json`

```
You are implementing the Receipt Categoriser feature in TypeScript (Node 22, ES modules, strict mode).
The complete spec and acceptance criteria are in @spec/spec.md and @spec/acceptance.md. They are the only source of truth.
Implement the feature so that every test in tests/acceptance.test.ts passes when you run npm test.

Constraints:
- Create or edit only these files: src/categoriser.ts, src/llm-categoriser.ts, src/rule-based-categoriser.ts, src/pii.ts
- src/types.ts and everything in tests/ already exist. Do NOT modify them.
- Do not add new npm dependencies.
- src/categoriser.ts must export handleCategorise(req, deps) and recordDecision(input, deps). Use the types in src/types.ts exactly.
- Keep the LLM path and the rule-based path in separate files. categoriser.ts chooses between them.
- Do NOT invent fields, endpoints, error codes, events, event properties or behaviour that are not in the spec.
- Do NOT put receipt text, merchant names, people's names or card numbers in any telemetry event.
- Before writing any code, list every ambiguity or gap you see in the spec and say which interpretation you will use. Then implement.
```
