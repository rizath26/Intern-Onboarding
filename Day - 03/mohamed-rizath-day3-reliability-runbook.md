# BookSwap: Reliability Runbook v0.1

Owner: BookSwap on-call rotation. Escalation: on-call engineer, then BookSwap tech lead, then platform lead.
Paging goes through the Azure Monitor action group `ag-bookswap-oncall` (SMS + voice call + Teams `#bookswap-incidents`). Sev3 alerts go only to Teams and create a ticket.

## Shared resilience settings

These numbers are referenced from every failure below. The rule we follow is that retries plus timeouts must fit inside the request deadline. Otherwise retries just make the user wait longer for the same error.

| Dependency call | Timeout | Retries | Backoff | Circuit breaker | Fallback |
|---|---|---|---|---|---|
| SQL read (search) | 1,500 ms command, 5 s connect | 1 retry, transient errors only | 100 ms + up to 100 ms jitter | Opens at >= 50% failures over 20 s with >= 20 calls; open 30 s; half-open lets 3 calls through | Serve stale result from Redis if present, else 503 + `Retry-After: 10` |
| SQL write (listing, loan) | 3,000 ms command, 5 s connect | 2 retries (3 attempts), transient errors only | 200 ms base, x2 each try, capped at 2 s, full jitter | Same breaker as reads, separate instance | 503 + `Retry-After: 30`; client retries with the same `Idempotency-Key` |
| Redis get/set | 250 ms operation, 1,000 ms connect | None. The cache is optional, so a failure is treated as a miss | n/a | Opens after 5 consecutive failures; open 30 s; half-open sends 1 probe | Go to SQL through the search bulkhead |
| Service Bus send | 5,000 ms | 3 attempts | 500 ms base, x2, capped at 4 s | n/a (SDK retry policy) | Log `digest.enqueue_failed` and let the nightly job re-enqueue |
| Whole request deadline | Reads 2 s, writes 10 s | | | | |

Transient SQL errors we retry on: 40613, 40197, 40501, 49918, 49919, 49920, 10928, 10929, plus connection resets. We never retry 4xx, validation errors, constraint violations, or deadlock victims on non-idempotent writes without an idempotency key.

Bulkheads (per instance): search gets its own pool of 40 concurrent SQL queries with a waiting queue of 20; anything past that gets 503 straight away. Writes (listings, loans) get a separate pool of 30. This way a flood of cache-miss searches can't starve listing creation, which has the stricter SLO.

Health checks: `/health` reports whether *this instance* is OK (process up, config loaded, signing key cached). It does **not** fail when SQL or Redis is down. If it did, one shared dependency outage would make Front Door and App Service pull every instance at once, turning a partial outage into a total one. Dependency status is still included in the response body for the dashboard.

<a id="failure-1"></a>
## Failure 1: Azure SQL primary unavailable for 5 minutes

### What the user sees
- **Search:** popular searches still work, served from Redis (up to 10 minutes stale). Searches not in cache get a friendly "Search is catching up, try again in a few seconds" after about 1.5 s instead of spinning.
- **Posting a listing:** the app shows "We couldn't post your book yet. We'll retry automatically." It retries in the background with the same idempotency key, so when SQL comes back the listing appears once.
- **Borrow/return:** same message as posting; the action retries.
- **Login:** existing logged-in members are unaffected, because JWT validation uses the cached public key and doesn't touch SQL. New logins fail with 503 because credential lookup needs SQL.

### Detection
- `alert-sql-dependency-failures` (Sev2): App Insights log alert, every 1 minute: more than 20% of `dependencies` where `type == "SQL"` failed over 5 minutes, with at least 30 calls.
- `alert-sql-connection-failed` (Sev2): Azure SQL metric `connection_failed` > 20 (total over 5 minutes).
- `alert-listings-burn-fast` (Sev2): S3 burn-rate alert (see observability plan). It fires because `POST /listings` 503s count against the budget.
- Azure Resource Health alert on the SQL database (`Unavailable` or `Degraded`) to tell us whether it's Azure or us.

### Mitigation in design (timeouts, retries, circuit breaker, fallback)
- Timeouts and retries as in the shared table. A short blip is absorbed by the 2 retries. A 5-minute outage trips the breaker within about 20 seconds, so instances stop piling up connections on a dead database and threads aren't stuck waiting.
- **Idempotency key on `POST /listings` and `POST /loans`.** The client creates a UUID v4 per "post this book" action and sends it as `Idempotency-Key`. The API stores (key, memberId, request hash, response) in a SQL table `IdempotencyKeys`, **in the same transaction** as the listing insert, kept for 24 hours.
  - Same key and same body: the original response is returned (200) and no new row is created.
  - Same key and different body: 422.
  - Same key still in progress: 409; the client waits and retries.
  - The keys live in SQL, not Redis, on purpose. If the key and the listing were in different stores, a crash between the two writes could create a duplicate or lose the key.
- Client retry for the 503s: 5 attempts honouring `Retry-After` (30 s), so the client keeps trying for about 2.5 minutes in the foreground. After that the app queues the request locally and retries when the app is reopened.
- Search fallback: on a breaker-open or SQL timeout, the API returns the cached result even if past its soft TTL. Each Redis entry has a 10-minute soft TTL and a 24-hour hard TTL for exactly this case. The response includes `X-Data-Stale: true`.
- Azure SQL failover: General Purpose with zone redundancy fails over inside the region automatically. A failover group's *automatic* geo-failover has a grace period of at least 1 hour, so it will **not** trigger for a 5-minute outage. That's a deliberate manual decision (below).

### Manual response (who is paged, what they do)
1. **Paged:** BookSwap on-call (primary) via `ag-bookswap-oncall`. If not acknowledged in 10 minutes, it escalates to the tech lead.
2. **Within 5 minutes:** open the health dashboard. Confirm SQL is the failing dependency (dependency failures panel), then check Azure Resource Health and Azure Service Health for the region.
3. **If Azure reports an incident:** post in `#bookswap-incidents` and turn on the in-app banner flag `banner.degraded = "Posting books may be delayed"` in App Configuration. Don't restart App Service, because it won't help and it drops the in-memory caches.
4. **If Azure is healthy:** check `cpu_percent`, `workers_percent` and blocking sessions on the database. A runaway query or a full worker pool looks like an outage from the app's side. Kill the blocking session if one is identified.
5. **If the outage passes 15 minutes and the region is down:** the tech lead decides on a forced failover of the failover group to the secondary region, accepting possible loss of the last few seconds of writes.
6. **When SQL recovers:** watch the breaker close (`circuit.state_changed` events), check the S3 burn alert resolves, then turn the banner off.

### Post-incident actions
- Blameless review within 5 working days, with the timeline taken from alert history and `circuit.state_changed` events.
- Run duplicate query D (SLO map) for the incident window to prove idempotency held. If any duplicates appear, it's the top bug of the next sprint.
- Compare when the breaker opened vs. when the alert fired. If the alert came later than 3 minutes, tune it.
- Investigate moving listing creation to "accept then write": put the listing on a Service Bus queue and return 202, so posting survives a SQL outage completely. This is the design change worth considering for Day 4.
- Schedule a quarterly failover drill in staging.

<a id="failure-2"></a>
## Failure 2: Azure Cache for Redis is down

### What the user sees
- Search still works but gets slower. Typical latency rises from ~150 ms to roughly 400 to 700 ms at normal load. At normal traffic, most users won't notice.
- If Redis goes down during a spike, some searches may get "Search is busy, try again" (503) because the search bulkhead protects the database. Posting books and borrowing are **not** affected, since they don't depend on Redis.
- Nobody is logged out: we're stateless with JWTs, and nothing about the session lives in Redis. Rate limiting is at Front Door, so it doesn't depend on Redis either.

### Detection
- Custom metric `cache.bypass_ratio` (published every 60 s by each instance): `alert-cache-bypass` (Sev3, Teams + ticket) when it's above 20% for 5 minutes.
- Azure Cache for Redis metrics: `errors` (split by `ErrorType`), `connectedclients` dropping to 0, and Resource Health for the cache.
- `alert-search-burn-fast` (Sev2) fires only if the outage actually starts hurting users (S1 budget burning fast). That's the point where it becomes a page.

### Mitigation in design
- Redis calls: 250 ms operation timeout, no retries, breaker opens after 5 consecutive failures. While open, the API doesn't even try Redis, so each search saves the 250 ms timeout.
- Search goes straight to SQL through the search bulkhead (40 concurrent + 20 queued per instance). Beyond that: 503 + `Retry-After: 5`. This protects listing creation, which has the stricter SLO.
- Small in-process cache (L1) on each instance for the 200 most popular queries, 60-second TTL. It's per instance and disposable, so the API stays stateless, and it soaks up the "everyone searches the same tabloid book" pattern.
- When Redis comes back empty, we avoid a stampede: only one request per key rebuilds the cache entry while others wait up to 300 ms (request coalescing), and TTLs get +/- 20% jitter so entries don't all expire together.
- Standard tier has a replica, so most Redis "outages" are a failover of 10 to 30 seconds. The breaker handles that without anyone being paged.

### Manual response
1. **Notified:** on-call via Teams (Sev3), during working hours only, unless the search burn alert also fires (then it's a page).
2. Check Redis Resource Health and the cache's maintenance/patching events, since a scheduled patch is the most common cause.
3. Check SQL `cpu_percent`. If it's above 80% for 10 minutes while Redis is down, scale Azure SQL up one size temporarily (4 to 8 vCores). Note that the scale operation ends with a brief connection drop, which the retries handle.
4. If Redis is unreachable but Azure says it's healthy, check whether the access key was rotated in Key Vault without the app picking it up, and restart one instance to confirm.
5. When it's back, check `cache.bypass_ratio` drops below 5% and search p95 returns to normal.

### Post-incident actions
- Add a warm-up job that preloads the top 500 searches of the last 7 days after any Redis restart or failover.
- If Redis outages happen more than once a quarter, price out zone redundancy on the cache vs. the cost of being degraded.
- Check the S2 SLI for the window to confirm search stayed "useful" (2xx under 2 s) while Redis was gone.

<a id="failure-3"></a>
## Failure 3: Sunday tabloid spike, 10x sustained traffic

### What the user sees
If we prepare as described here: nothing unusual, maybe slightly slower search. If we don't prepare: search slows down past 800 ms in the first 10 to 15 minutes while autoscale catches up, and some people get 503s. A small number of abusive clients (bots scraping the catalogue) get 429 with `Retry-After`.

### Detection
- App Service plan `CpuPercentage` > 75% average over 10 minutes, and `HttpQueueLength` > 50 (Sev3, Teams). These are early warnings, not pages.
- Azure SQL `cpu_percent` > 80% over 10 minutes and `workers_percent` > 70% (Sev3).
- Front Door `RequestCount` compared with the same hour last Sunday, shown on the dashboard rather than alerted on.
- The page itself comes from the SLO burn alerts: `alert-search-burn-fast` and `alert-listings-burn-fast` (Sev2).
- Service Bus `ActiveMessages` on `email-digest` > 5,000 (Sev3), which tells us the digest worker has fallen behind.

### Mitigation in design (autoscale, queue depth, throttling)
- **Pre-scale, don't just react.** We know the date, so we use a scheduled autoscale profile from Saturday 22:00 to Sunday 23:59 (Asia/Colombo): minimum 6 instances, maximum 12. Autoscale takes several minutes to add capacity, which is too slow for a spike that hits when the article goes live.
- **Reactive autoscale (all days):** scale out +2 instances when average CPU > 65% for 5 minutes; scale in -1 when CPU < 35% for 10 minutes. Cooldown 5 minutes after scaling out and 10 minutes after scaling in. Normal profile: min 3, max 10.
- **Database:** scale Azure SQL from 4 to 8 vCores on Saturday afternoon, not on Sunday, so the brief reconnect at the end of scaling happens while traffic is quiet. Connection pool max is 40 per instance, so 12 instances x 40 = 480 connections. This must stay under the worker limit for 8 vCores (check the resource limits page for the exact SKU).
- **Cache:** on Saturday night, preload the top 500 searches and raise the search TTL from 10 to 30 minutes for the weekend. Slightly staler results are fine for a book catalogue.
- **Throttling at Front Door WAF** (rate-limit rules, 1-minute window, grouped by client IP):
  - `POST /auth/login`: 10 requests per minute per IP, then block.
  - `POST /listings` and `POST /loans`: 60 per minute per IP.
  - `GET /books`: 600 per minute per IP. This is deliberately generous because a whole apartment building, or a mobile network using carrier-grade NAT, can share one public IP. Per-member limits are enforced in the API instead: 20 new listings per member per hour.
- **Shed non-critical work:** feature flag `digest.paused = true` during the spike window. Digest messages stay on the Service Bus queue and are processed after 23:00. The digest SLO allows 60 minutes, so we'll spend some of its budget on purpose. That's the right trade.
- **Priority order if we have to shed load:** listing creation and loans first, search second, digests last. The separate bulkheads make sure search overload can't block writes.
- Idempotency keys (Failure 1) matter here too. Under load, timeouts and client retries go up, and the keys make sure retried posts don't create duplicate listings.

### Manual response
1. **Before:** on Friday the tech lead confirms the pre-scale profile, SQL scale-up time, and the on-call for Sunday. The Sunday on-call is named and has no other commitments from 08:00 to 20:00, with the tech lead as named backup.
2. **During:** the on-call checks the health dashboard every 30 minutes and posts a one-line status in `#bookswap-incidents`.
3. If CPU stays above 75% at max instances, raise max instances to 15 (the manual override is allowed for the on-call without asking).
4. If search is burning budget fast and SQL CPU is above 90%, turn on `search.cacheOnly = true`: searches are served only from cache and cache misses return the "popular books" list instead of an error.
5. **After 23:00:** set `digest.paused = false` and watch `ActiveMessages` drain to 0.

### Post-incident actions
- Compare forecast (10x) with actual peak RPS per endpoint and update the capacity numbers in the README.
- Record measured RPS per instance at 65% CPU. That number replaces our guess in the autoscale rules.
- Run a 10x load test in staging before any future planned publicity, and add it to the release checklist.
- If the cache-only flag was used, put the search performance item ("Out of budget right now" in the SLO map) at the top of the next sprint.
