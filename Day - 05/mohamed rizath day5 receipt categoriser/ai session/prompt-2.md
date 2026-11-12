# Prompt 2: Verify against the acceptance criteria and fix deviations

**Sent to:** Claude Code, in the same session as prompt 1

---

Re-read `spec/spec.md` and `spec/acceptance.md`. They are still the source of truth.

1. Run `npm test` and `npm run typecheck`. Show me the output.
2. For each failing test, name the AC number and fix only `src/` files. Do not edit `tests/` or `src/types.ts`.
3. Then compare your code to section 3 (Contract) of the spec, line by line. List anything you added that is NOT in the spec: fields, events, event properties, error codes, retries, logging. For each one, either remove it or tell me why the spec requires it.
4. Show the final `npm test` output.
