# BookSwap: SLI/SLO Map

All windows are a rolling 28 days unless stated. We picked 28 rather than 30 on purpose: every window contains exactly four Sundays, and Sunday is when our traffic (and the tabloid spike) happens, so windows are comparable with each other.

A note on the queries: Application Insights samples telemetry, so every SLI query sums `itemCount` instead of using `count()`. Using `count()` on sampled data quietly undercounts both good and bad requests.

## 1. NFR inventory

| # | NFR (from Day 2) | User-visible behaviour |
|---|------------------|------------------------|
| N1 | Catalogue search: 99% of requests under 800 ms over 28 days, even at 10x normal RPS | Typing a title and getting results feels instant, including on tabloid Sunday |
| N2 | Search results must stay useful when the cache is cold or unavailable | Search might be a bit slower, but it never shows an error page just because Redis is down |
| N3 | Listing creation: 99.9% success rate | "Post my book" works first time, including during the spike |
| N4 | Failed listing attempts are retryable without duplicates | Pressing "Post" twice on a bad connection gives one listing, not two |
| N5 | Every endpoint except /health requires a valid JWT | Nothing about members or books is visible without logging in |
| N6 | A member never sees another member's loan history or address | Changing an ID in the URL never shows someone else's data |
| N7 | Tokens expire within 1 hour | A stolen or forgotten-logged-in token stops working within the hour |
| N8 | A complete outage of the listings endpoint pages on-call within 3 minutes | If posting breaks, someone is already on it before residents start messaging the building group |
| N9 | Every auth failure and every loan creation/return is logged with request ID and member ID | Disputes ("I returned that book!") can be settled from the audit trail |
| N10 | Ops can confirm in under 5 minutes whether the system is healthy | Ops can answer "is BookSwap down?" quickly and correctly |
| N11 | Borrow and return work reliably (Day 2) | Borrowing a book and marking it returned just works |
| N12 | Weekly digest emails go out on time (Day 2) | The "new books in your building" email arrives the same morning |

## 2. SLI / SLO table

| # | SLI definition | Measurement source | SLO target | Window | Error budget |
|---|----------------|---------------------|------------|--------|--------------|
| S1 (N1) | Of all valid `GET /books` requests, the % that returned 2xx in under 800 ms. "Valid" excludes 4xx client errors, except 429, which counts as bad because it's us refusing service | App Insights `requests` table (query A) | >= 99% | 28d | 1%, about 6.7 hours of total search outage, or many more slow requests spread out |
| S2 (N2) | Of valid `GET /books` requests served with `cacheStatus` = `miss` or `bypass`, the % that returned 2xx in under 2,000 ms | App Insights `requests`, custom dimension `cacheStatus` set by the API (query B) | >= 99% | 28d | 1% of cache-miss searches |
| S3 (N3) | Of valid `POST /listings` requests, the % that returned 2xx (201, or 200 for an idempotent replay). Same 4xx rule as S1 | App Insights `requests` (query C) | >= 99.9% | 28d | 0.1%, about 40 minutes of total outage |
| S4 (N4) | Number of listing pairs with the same owner and ISBN created within 2 minutes of each other | Azure SQL, daily job (query D) | 0 | 28d | None. Any hit is a Sev3 bug, because it means idempotency is broken |
| S5 (N5) | % of operations in the OpenAPI spec (except `/health`) that return 401 for no token, an expired token, and a token signed with `alg: none` | Contract test in the CI pipeline, on every deploy and nightly against staging | 100% | Every run | None. A failure blocks the deploy |
| S6 (N6) | % of `/{id}`-shaped operations that return 404 when called with a valid token belonging to a *different* member | Same CI contract test suite | 100% | Every run | None. A failure blocks the deploy |
| S7 (N7) | % of issued access tokens where `exp - iat` <= 3600 s | App Insights `customEvents` name `auth.token_issued`, dimension `lifetimeSeconds` (query E) | 100% | 28d | None |
| S8 (N8) | Time from the start of a listings outage to the on-call being paged | Monthly drill in staging (same alert rules as prod): drill start time vs. "fired" time in Azure Monitor alert history. Every real incident is measured too | <= 3 min in 100% of drills | Monthly | None. A miss means the alert gets reworked before the next drill |
| S9 (N9) | % of loans created/returned in SQL that have a matching audit event carrying both `requestId` and `memberId` | Daily reconciliation: SQL `Loans` table vs. App Insights `customEvents` (query F) | 100% | Daily | None. Audit events are excluded from sampling, so 100% is achievable |
| S10 (N10) | Time for the on-call to answer "healthy or not?" using only the health dashboard | Monthly drill, timed | <= 5 min in 100% of drills | Monthly | None |
| S11 (N11) | Of valid `POST /loans` and `POST /loans/{id}/return` requests, the % that returned 2xx | App Insights `requests` | >= 99.5% | 28d | 0.5%, about 3.4 hours |
| S12 (N12) | % of `email-digest` messages completed within 60 minutes of being enqueued | Worker logs `digest.completed` with `enqueuedTimeUtc` from the Service Bus message | >= 99% | 28d | 1% of digest messages |

Why the targets differ: losing a listing is worse than a slow search (the member may give up and not post at all), so listing creation gets 99.9% and search gets 99%. Borrow/return sits between them at 99.5%. The security and audit SLIs are 100% with no budget because a "small amount" of data leakage isn't an acceptable trade.

### Queries

**A. Search SLI (S1)**

```kusto
requests
| where timestamp > ago(28d)
| where name == "GET /books"
| extend code = toint(resultCode)
| where code < 400 or code >= 500 or code == 429
| summarize
    good  = sumif(itemCount, code between (200 .. 299) and duration < 800),
    total = sum(itemCount)
| extend sli = 100.0 * good / total
```

**B. Search under cold/no cache (S2)**

```kusto
requests
| where timestamp > ago(28d)
| where name == "GET /books"
| where tostring(customDimensions.cacheStatus) in ("miss", "bypass")
| extend code = toint(resultCode)
| where code < 400 or code >= 500 or code == 429
| summarize
    good  = sumif(itemCount, code between (200 .. 299) and duration < 2000),
    total = sum(itemCount)
| extend sli = 100.0 * good / total
```

**C. Listing creation (S3)**

```kusto
requests
| where timestamp > ago(28d)
| where name == "POST /listings"
| extend code = toint(resultCode)
| where code < 400 or code >= 500 or code == 429
| summarize
    good  = sumif(itemCount, code between (200 .. 299)),
    total = sum(itemCount)
| extend sli = 100.0 * good / total
```

**D. Duplicate listings (S4), Azure SQL**

```sql
SELECT a.ListingId AS FirstListing, b.ListingId AS SuspectDuplicate,
       a.OwnerMemberId, a.Isbn, a.CreatedAt, b.CreatedAt AS DuplicateCreatedAt
FROM dbo.Listings AS a
JOIN dbo.Listings AS b
  ON  b.OwnerMemberId = a.OwnerMemberId
  AND b.Isbn          = a.Isbn
  AND b.ListingId    <> a.ListingId
  AND b.CreatedAt    >= a.CreatedAt
  AND b.CreatedAt    <  DATEADD(minute, 2, a.CreatedAt)
WHERE a.CreatedAt > DATEADD(day, -1, SYSUTCDATETIME());
```

A member *can* legitimately own two copies of the same book, so a hit means "look at this", not automatically "bug". That's why it raises a Sev3 ticket and not a page.

**E. Token lifetime (S7)**

```kusto
customEvents
| where timestamp > ago(28d)
| where name == "auth.token_issued"
| extend lifetime = toint(customDimensions.lifetimeSeconds)
| summarize ok = countif(lifetime <= 3600), total = count()
| extend sli = 100.0 * ok / total
```

**F. Audit completeness (S9)**: compares against the count of loan rows created or returned yesterday in SQL.

```kusto
customEvents
| where timestamp between (startofday(ago(1d)) .. startofday(now()))
| where name in ("loan.created", "loan.returned")
| summarize
    events       = count(),
    withBothIds  = countif(isnotempty(tostring(customDimensions.requestId))
                           and isnotempty(tostring(customDimensions.memberId)))
    by name
```

## 3. Error budget policy

These rules apply to the burn-rate SLOs (S1, S2, S3, S11, S12):

- **50% of the budget used, with more than a week left in the window:** the next sprint must include at least one reliability item for that SLO, chosen from the post-incident actions in the runbook.
- **100% used (budget exhausted):** feature freeze on the affected service. No feature PRs merge to `main` for the BookSwap API until the SLO is back above target on a 7-day view. Only bug fixes, reliability work, and security patches ship. The weekly "new feature" demo is replaced by a reliability review.
- **Zero-budget SLOs (S4 to S10):** a single miss is treated as a bug with a named owner and a fix date. For S5 and S6, the CI gate blocks the release automatically, so nobody has to "decide".

**Who owns the decision:** the BookSwap tech lead declares the freeze, using the SLO dashboard as evidence. The product owner is informed the same day and can ask for an exception, but an exception needs both of them to agree and must be written in the team channel with a reason and an end date. On-call engineers don't decide freezes. Their job is to report the burn.

## 4. Out of budget right now

I'd bet we can't hold S1 (99% of searches under 800 ms) during the 4-hour Sunday spike with a cold cache, because Day 2 search runs `LIKE '%term%'` over title and author, which can't use an index, and we have never load-tested at 120 search RPS.

What would change my mind: a load test at 10x against a copy of production data with Redis flushed, plus either Azure SQL full-text search or a pre-computed search column with a proper index. Close second: S8 (paging within 3 minutes), because Azure Monitor ingestion delay alone can take a minute or two. That's why we measure it with drills instead of assuming it works.
