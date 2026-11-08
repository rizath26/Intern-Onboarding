# BookSwap: Observability Plan

Our rule of thumb: **alert on metrics, debug with logs, find root causes with traces.** Every page must protect an SLO and link to a runbook section. Anything else goes to Teams or a dashboard, not someone's phone.

## Setup

### Logs: Azure Monitor Logs
- **Where:** workspace-based Application Insights `appi-bookswap-prod`, writing to Log Analytics workspace `log-bookswap-prod`. App Service platform logs (HTTP logs, platform restarts) go to the same workspace via diagnostic settings, so one query can see both.
- **Schema:** structured JSON only, no free-text log lines. Every entry carries:

  | Field | Example | Notes |
  |---|---|---|
  | `timestamp` | 2026-11-08T09:14:02Z | UTC |
  | `level` | Information / Warning / Error | |
  | `event` | `loan.created`, `auth.failed`, `circuit.state_changed` | dot-separated, lowercase |
  | `requestId` | W3C trace ID (`operation_Id`) | same ID in logs, metrics and traces |
  | `memberId` | GUID | never email or name |
  | `buildingId` | GUID | lets us spot a single-building problem |
  | `endpoint`, `resultCode`, `durationMs` | `POST /loans`, 201, 184 | |

- **Retention:** 30 days for normal application logs and traces. **365 days** for audit events (`auth.failed`, `auth.token_issued`, `loan.created`, `loan.returned`), using table-level retention on `AppEvents`. Loan disputes can come up months later.
- **Redaction rules (applied in a telemetry processor *before* anything leaves the instance):**
  - Request and response bodies are **never** logged.
  - The `Authorization` header and any field named `password`, `token`, `refreshToken` are dropped entirely.
  - `email`, `phone`, `address`, `flatNumber`, `fullName` are replaced with `[REDACTED]` wherever they appear (custom dimensions, exception messages, dependency command text).
  - SQL dependency telemetry records the command *name*, not the full text with parameter values.
  - Failed logins where we can't resolve a member store a salted SHA-256 hash of the entered email (`emailHash`), so we can spot repeated attempts on one account without storing the address.
  - Client IP: Application Insights already doesn't store the client IP by default (it's used for geolocation then dropped). We keep that default. Front Door WAF logs keep the IP for 30 days for abuse investigation only.

### Metrics: Azure Application Insights
- **Request metrics:** auto-collected request rate, duration and failures per operation name (`GET /books`, `POST /listings`, ...).
- **Dependency metrics:** auto-collected for SQL, HTTP, Service Bus and Blob. Redis calls are wrapped in our own dependency tracking so they show up as `type == "Redis"`.
- **Custom metrics:**
  - `cache.bypass_ratio`: share of searches that skipped Redis in the last 60 s, per instance.
  - `circuit.open`: 1 while a breaker is open, labelled by dependency.
  - `listings.created`, `loans.created`, `loans.returned`: business counters for the business dashboard.
- **Azure platform metrics:** App Service plan (`CpuPercentage`, `HttpQueueLength`), Azure SQL (`cpu_percent`, `workers_percent`, `connection_failed`), Redis (`serverLoad`, `errors`, `connectedclients`), Service Bus (`ActiveMessages`, `DeadletteredMessages`), Front Door (`RequestCount`, `Percentage5XX`, `OriginHealthPercentage`).
- Custom metric dimensions stay low-cardinality: endpoint, dependency, buildingId at most. **Never** memberId as a metric dimension, because 24,000 members would mean 24,000 time series and a large bill.

### Traces: Application Insights distributed tracing
- W3C trace context end to end: Front Door, API, SQL/Redis/Blob dependencies, and **across Service Bus**. The trace context is carried in the message application properties so a digest email can be traced back to the request that queued it.
- **Sample rate:** adaptive sampling capped at 20 telemetry items per second per instance. At normal load that keeps close to 100%; during the Sunday spike it drops to roughly 10 to 20%. Excluded from sampling (always 100%): `customEvents` (audit) and exceptions.
- Because of sampling, every SLI and alert query uses `sum(itemCount)` instead of `count()`.
- Trace cost control: dependency telemetry under 5 ms for Redis cache *hits* is dropped. They're the bulk of the volume and almost never what we're debugging.

## Signals

| # | Signal type | Source | What it answers | Sample query / metric name |
|---|---|---|---|---|
| 1 | Metric | Application Insights | Search latency p95 | `requests \| where name == "GET /books" \| summarize percentile(duration, 95) by bin(timestamp, 1m)` |
| 2 | Metric | App Insights | Listing creation success rate | `requests \| where name == "POST /listings" \| extend code = toint(resultCode) \| where code < 400 or code >= 500 or code == 429 \| summarize successRate = 100.0 * sumif(itemCount, code between (200 .. 299)) / sum(itemCount) by bin(timestamp, 5m)` |
| 3 | Log | App Insights custom events | Auth failures with member ID | `customEvents \| where name == "auth.failed" \| project timestamp, requestId = operation_Id, memberId = tostring(customDimensions.memberId), emailHash = tostring(customDimensions.emailHash), reason = tostring(customDimensions.reason)` |
| 4 | Trace | App Insights | Slow request breakdown across DB and Redis | `requests \| where timestamp > ago(1h) and name == "GET /books" and duration > 800 \| project operation_Id \| join kind=inner (dependencies \| where timestamp > ago(1h)) on operation_Id \| summarize totalMs = sum(duration), calls = count() by type, target \| order by totalMs desc` |
| 5 | Metric | Service Bus | Email digest queue depth | Metric `ActiveMessages`, filter `EntityName = email-digest`; also `DeadletteredMessages` |
| 6 | Metric | Front Door | Is the whole site failing at the edge? | `Percentage5XX` and `OriginHealthPercentage` on `afd-bookswap` |
| 7 | Metric | App Insights custom | How much search is bypassing the cache | `customMetrics \| where name == "cache.bypass_ratio" \| summarize avg(value) by bin(timestamp, 1m)` |
| 8 | Log | App Insights custom events | Audit trail for loan disputes | `customEvents \| where name in ("loan.created", "loan.returned") \| where tostring(customDimensions.loanId) == "<loanId>"` |
| 9 | Log | App Insights custom events | When and why a circuit breaker opened | `customEvents \| where name == "circuit.state_changed" \| project timestamp, dependency = tostring(customDimensions.dependency), from = tostring(customDimensions.from), to = tostring(customDimensions.to)` |
| 10 | Trace | App Insights transaction search | Full path of one listing post, including the Service Bus hop | Open "End-to-end transaction details" with the `requestId` from the member's support ticket |

## Dashboards

**Health dashboard** (for "is BookSwap healthy?" in under 5 minutes, 6 panels, read left to right):
1. Search SLI, today and 28-day, with remaining error budget
2. Listing creation success rate, today and 28-day, with remaining budget
3. Front Door 5xx % and origin health
4. Dependency failure rate by type (SQL, Redis, Service Bus, Blob)
5. Open circuit breakers (should be empty)
6. App Service instance count and CPU, with SQL CPU on the same chart

If panels 1 to 3 are green and panel 5 is empty, BookSwap is healthy. That's the answer the ops team needs, and we time it in the monthly drill (SLO S10).

**Business dashboard:** listings created per hour, active loans, searches per hour, new members, and digest emails sent, all split by building. It's also how we'll see the tabloid effect on Sunday.

## Results Summary

| Metric | Target | Achieved |
|---|---|---|
| SLOs covered by an alert | 100% | 11 of 12 (92%). S10 (ops can tell health in 5 min) is a human drill, protected by the dashboard and not an alert. S5/S6 are covered by the CI gate, which posts failures to Teams |
| Alerts with a clear runbook link | 100% | 100% (16 of 16) |
| Dashboards for ops | 1 health, 1 business | 1 health (6 panels), 1 business, both defined above |

## Alert proposal

Burn-rate alerts follow the SRE Workbook's multi-window approach. "Burn rate 14.4" means we're spending error budget 14.4 times faster than the rate that would use it all in exactly 28 days. At that speed, one hour costs about 2% of the monthly budget, which is worth waking someone up for. Requiring both a long and a short window to be over the threshold means the alert stops quickly once the problem is fixed. A minimum-traffic condition stops 2 failed requests at 3 a.m. from paging anyone.

| Alert | Condition | Severity | Notification | Runbook |
|---|---|---|---|---|
| `alert-search-burn-fast` | S1 burn rate > 14.4 over 1 h **and** over 5 min (bad ratio > 14.4%), at least 50 requests in 5 min | Sev2 | Pager + Teams | [Failure 2](../reliability/runbook.md#failure-2), [Failure 3](../reliability/runbook.md#failure-3) |
| `alert-search-burn-slow` | S1 burn rate > 6 over 6 h **and** over 30 min | Sev3 | Teams + ticket | [Failure 3](../reliability/runbook.md#failure-3) |
| `alert-search-degraded` | S2: over 1 h, more than 5% of cache-miss searches fail or take over 2 s, at least 50 such requests | Sev3 | Teams + ticket | [Failure 2](../reliability/runbook.md#failure-2) |
| `alert-listings-burn-fast` | S3 burn rate > 14.4 over 1 h **and** 5 min (failure ratio > 1.44%), at least 20 requests in 5 min | Sev2 | Pager + Teams | [Failure 1](../reliability/runbook.md#failure-1) |
| `alert-listings-outage` | >= 90% of `POST /listings` failing over the last 2 min with >= 10 requests; evaluated every 1 min | Sev1 | Pager (voice call) + Teams | [Failure 1](../reliability/runbook.md#failure-1) |
| `alert-edge-origin-down` | Front Door `OriginHealthPercentage` < 50 for 1 min, **or** `Percentage5XX` > 25 for 2 min | Sev1 | Pager (voice call) + Teams | [Failure 1](../reliability/runbook.md#failure-1) |
| `alert-loans-burn-fast` | S11 burn rate > 14.4 over 1 h **and** 5 min (failure ratio > 7.2%) | Sev2 | Pager + Teams | [Failure 1](../reliability/runbook.md#failure-1) |
| `alert-digest-age` | S12: oldest unprocessed `email-digest` message older than 45 min, or `ActiveMessages` > 5,000; muted while `digest.paused` is on | Sev3 | Teams + ticket | [Failure 3](../reliability/runbook.md#failure-3) |
| `alert-duplicate-listings` | S4: daily SQL check (query D) returns any rows | Sev3 | Teams + ticket | [Failure 1](../reliability/runbook.md#failure-1) |
| `alert-token-lifetime` | S7: any `auth.token_issued` event with `lifetimeSeconds` > 3600 in the last hour | Sev3 | Teams + ticket | [Security review S-01](../security/review.md#review-table) |
| `alert-audit-gap` | S9: daily reconciliation shows fewer audit events than SQL loan rows, or any event missing `requestId`/`memberId` | Sev3 | Teams + ticket | [Security review S-07](../security/review.md#review-table) |
| `alert-sql-dependency-failures` | > 20% of SQL dependency calls failing over 5 min, with >= 30 calls | Sev2 | Pager + Teams | [Failure 1](../reliability/runbook.md#failure-1) |
| `alert-cache-bypass` | `cache.bypass_ratio` > 20% for 5 min | Sev3 | Teams + ticket | [Failure 2](../reliability/runbook.md#failure-2) |
| `alert-sql-connection-failed` | Azure SQL `connection_failed` total > 20 over 5 min | Sev2 | Pager + Teams | [Failure 1](../reliability/runbook.md#failure-1) |
| `alert-capacity-warning` | App Service plan `CpuPercentage` avg > 75% for 10 min, or `HttpQueueLength` > 50 | Sev3 | Teams only | [Failure 3](../reliability/runbook.md#failure-3) |
| `alert-sql-pressure` | Azure SQL `cpu_percent` avg > 80% or `workers_percent` > 70% for 10 min | Sev3 | Teams only | [Failure 3](../reliability/runbook.md#failure-3) |

Why two alerts for a listings outage: `alert-listings-outage` catches failures the app can see. But if App Service is completely down, no requests reach Application Insights at all, so that alert sees *nothing*, not failures. `alert-edge-origin-down` covers that case from Front Door's side. Together they cover the 3-minute detection NFR, and the monthly drill (S8) checks they actually do it in time, since Azure Monitor ingestion delay eats into those 3 minutes.

## What we are deliberately NOT alerting on

1. **High CPU or memory on its own.** High CPU while every SLO is fine just means we're using what we pay for. It's an early-warning line on the dashboard and a Sev3 at most, never a page.
2. **Redis being down on its own.** Search keeps working without it (S2). It's a Sev3 ticket. If users start to feel it, the search burn-rate alert pages instead.
3. **Individual exceptions or single 5xx responses.** One failed request is noise. The burn-rate alerts already turn "lots of failures" into a page, with a budget behind the decision.
4. **4xx responses, including bursts of 401s.** Expired tokens on Monday morning produce piles of 401s and that's normal. Credential-stuffing bursts are handled by the WAF rate limit and are visible in the WAF logs. 429s are the exception, since they count against the SLOs.
5. **Traffic volume itself.** A 10x Sunday is good news, not an incident. It's on the business dashboard. We alert only if it hurts users (burn rate) or a queue backs up.
6. **Single dead-lettered messages.** They're reviewed in the weekly ops check. A *rising* dead-letter count shows up through `alert-digest-age`.
