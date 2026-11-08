# GreenChit — Trade-offs and Design Review

## Setup

- **Two architectural options under review**
  - **Option A: App Service monolith.** One ASP.NET Core (.NET 10) app on Azure App Service (Linux, P0v3 × 2). It serves the Web App, the REST API and the background workers (Outbox Publisher, Notification Dispatcher). This is the design shown in the container and component diagrams.
  - **Option B: Container Apps split.** The same code split into separately deployed container apps (web/API and notification worker) in one Azure Container Apps environment. Images are built into Azure Container Registry and the infrastructure is defined in Bicep.
  - Both options share the same data and integration choices: Azure SQL (ADR-0003), Blob + Defender (ADR-0004), Service Bus, Entra ID, Teams Workflows and Graph. Only hosting and deployment differ.
- **Quality attributes weighted by team / business**
  - **×3, decision drivers: time-to-first-deploy and operability for a 10-person team.** Finance asked for a working internal tool, the team is small with limited container experience, and nobody is on call outside business hours.
  - **×2, important: cost and authn/authz consistency.** It's an internal tool with a modest budget, and the privacy rule (only claimant, approver, Finance, Auditor) must hold everywhere.
  - **×1, nice to have at today's scale: independent deploy and future scaling.** We expect under 50 submissions per peak hour, well below 1 request per second.

## Trade-off table

Scores: 1 = poor, 5 = excellent, for GreenChit's situation.

| Quality attribute | Weight | Option A: App Service monolith | Option B: Container Apps split | Why (A) | Why (B) |
|---|:-:|:-:|:-:|---|---|
| Time-to-first-deploy **(decision driver)** | ×3 | 5 | 2 | One App Service with a staging slot. Deployed from GitHub Actions using .NET skills the team already has. Nothing new to learn before the first release. | Needs Dockerfiles, Azure Container Registry, a Container Apps environment, Bicep/Terraform and an image pipeline. These are new skills for this team, so weeks rather than days. |
| Cost (low spend) | ×2 | 5 | 2 | Two small P0v3 instances host the API, the SPA and the background workers together. A single predictable monthly line. | Scale-to-zero would be cheap, but it breaks the 08:00 p95 target, so each app needs at least one replica. Add the registry and extra log ingestion and it costs more for the same load. |
| Operability for 10-person team **(decision driver)** | ×3 | 4 | 3 | One app, one log stream, and the platform patches the OS. Loses a point because the background workers share the request process (ADR-0002 uncomfortable consequence). | Failures are isolated per service, which is a real plus. But revisions, replicas, image versions and environment networking are more moving parts for a team with little container experience. |
| Independent deploy | ×1 | 1 | 5 | Any change, even a notification template fix, redeploys everything. | Each container app has its own revisions and can be rolled out or rolled back on its own. |
| Future scaling | ×1 | 2 | 5 | Can only scale the whole app out. Fine at under 1 request per second, but a busy worker can't scale on its own. | Each service scales separately. The worker can scale on Service Bus queue length (KEDA). |
| Authn/authz consistency | ×2 | 4 | 3 | One ASP.NET Core auth pipeline and one access-policy class enforce every rule in one process. Loses a point because background workers act as the app identity, outside any user context. | Each service must validate tokens and apply the same policies. Service-to-service calls need their own managed-identity setup, and there's a risk the rules drift between services. |
| **Total (unweighted)** | | **21** | **20** | Nearly a tie. The raw total doesn't decide anything. | |
| **Total (weighted)** | | **48** / 60 | **35** / 60 | Weighted by what the business says matters most (see Setup). | |

**Sensitivity check:** if we reverse the priorities (independent deploy and future scaling ×3,
time-to-first-deploy ×1, the rest unchanged), the weighted result flips to **A = 44, B = 51**,
and Option B wins. The decision depends on the weights, not the raw scores. That's why the weights
are written down and agreed with the business, and why ADR-0002 has explicit revisit triggers.

## Results Summary

| Metric | Target | Achieved |
|--------|--------|----------|
| Quality attributes scored | 6 | 6 |
| Cells with a written justification | 12 | 12 |
| Decision-affecting attributes identified | 2-3 | 2 (time-to-first-deploy, operability for a 10-person team) |

## Decision and rationale

- **Option A, the App Service monolith, wins.** It's recorded in `adrs/0002-hosting-platform.md`.
- **The attributes that drove it:**
  1. **Time-to-first-deploy (A 5 vs B 2).** Option A uses skills the team already has. Option B needs a container and IaC toolchain the team would have to learn first.
  2. **Operability for a 10-person team (A 4 vs B 3).** One app, one log stream and one pipeline are easier for a small team to run with no out-of-hours cover.
- **What we knowingly give up:** independent deploy (A 1 vs B 5) and per-service scaling (A 2 vs B 5). We accept this because current load is tiny. ADR-0002 names the triggers for revisiting: sustained load over 200 requests per second, a need to deploy or scale a component on its own, or background work measurably hurting submit p95.
- **The unweighted totals (21 vs 20) were almost a tie and didn't decide anything.** The weighting reflects what the business asked for.

## Pre-review self-check (our own pair, before the swap)

*This isn't the feedback we received. It's the checklist we ran on our own pack first, so the
reviewers' time goes on things we missed.*

- **Does it solve the stated problem?** Every functional requirement maps to a component: submit and status (Claims Module), approve, reject and request info (Claims Module plus the alt fragment in the sequence diagram), CSV export (Payroll Export Module), audit (Audit Writer plus the ledger). Every NFR is covered by a decision: p95 (uploads happen before submit), intermittent upload (ADR-0004), tamper-evident 7-year audit (ADR-0003), privacy (Auth & Access Policy).
- **Are failure modes considered?** Yes for upload interruption and notification failure (both error paths). **Not yet** for the case where the line manager is absent or changes. See risk R3 in the design pack.
- **Where we expect pushback:** the shared-process risk in ADR-0002, and the fact that audit rows can never be deleted (ADR-0003).

## Design review feedback (received from another pair)

> **To be completed during Hour 4 (3:00–3:25).** Write down what the reviewing pair actually said,
> in their words, and name them. Don't pre-fill this section.

**Reviewed by:** _pair name_

- **3 strengths**
  1. _..._
  2. _..._
  3. _..._
- **3 weaknesses or risks**
  1. _..._
  2. _..._
  3. _..._
- **2 actionable improvements** (file, section, suggested change)
  1. _..._
  2. _..._

## Design review feedback (given to another pair)

> **To be completed during Hour 4.** Run the design-review checklist on the other pair's pack.
> Every point must be specific (file, section, suggested change), and at least one must be a
> genuine disagreement, because agreement-only review is theatre. Useful probes:
> - Which requirement in the brief has no component or sequence step behind it?
> - Pick one failure mode (lost connectivity, Teams down, manager on leave). Does the design cover it?
> - Does every arrow have a verb and a protocol? Do the sequence lifelines match the container names?
> - Does at least one ADR name a consequence that genuinely hurts?
> - Is the audit log tamper-*evident*, or only access-restricted?

**Reviewed pair:** _pair name_

- **3 strengths**
  1. _..._
  2. _..._
  3. _..._
- **3 weaknesses or risks**
  1. _..._
  2. _..._
  3. _..._
- **2 actionable improvements** (file, section, suggested change)
  1. _..._
  2. _..._
