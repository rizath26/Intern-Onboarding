# ADR 0001: Record architecture decisions as Markdown ADRs in the repository

## Status

Accepted (date: 2026-11-08)

## Context

- GreenChit handles money and personal data, and Finance needs a 7-year audit trail. People will still be asking "why is it built like this?" long after the original team has moved on.
- The team is about 10 people, and several are interns on a rotation. Decisions made in Teams chats or meetings get lost when people rotate out.
- Finance, Security and the payroll owners need to review decisions without reading code.
- Decisions need to be reviewed in the same place and at the same time as the code they affect, so they can't silently drift apart.
- What we don't yet know: whether BISTEC has a central ADR register or architecture review board that GreenChit decisions must also be filed with.

## Decision

- We record every architecturally significant decision as an ADR in `adrs/`, using the Michael Nygard template: Status, Context, Decision, Consequences, Alternatives considered.
- Files are numbered sequentially (`NNNN-kebab-case-title.md`), and numbers are never reused.
- An ADR is written **while** the decision is being made and merged through a pull request with at least one reviewer from outside the author's pair.
- Accepted ADRs are immutable. To change a decision we write a new ADR and mark the old one `Superseded by ADR-NNNN`.
- A decision is "architecturally significant" if it is expensive to reverse, or if it affects a quality attribute in the brief (latency, availability, audit, privacy).

## Consequences

- **Easier:** New joiners and reviewers can read the decision history in order. Design reviews can point at a specific ADR and section.
- **Harder:** Every significant change now costs a short write-up and a review, which slows down "just do it" changes. We'll be tempted to skip ADRs under deadline pressure, so the PR template asks "Does this need an ADR?".
- **Different:** Disagreements get resolved in writing on a pull request rather than in a meeting, so quieter team members get an equal say.

## Alternatives considered

- **Confluence/SharePoint decision pages:** rejected because they live apart from the code, aren't versioned with it, and can't be reviewed in the same pull request.
- **No formal record (rely on PR descriptions and chat):** rejected because PR descriptions describe *what* changed, rarely *what else was considered*, and chat history isn't searchable by decision.
- **Lightweight ADRs without "Alternatives considered":** rejected because the rejected options are the most valuable part when a decision is revisited.
