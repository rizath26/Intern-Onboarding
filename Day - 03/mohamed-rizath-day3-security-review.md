# BookSwap: Security Review of the API

Scope: the Day 2 OpenAPI spec (endpoints listed in the README), the Azure deployment around it, and the Prism mock used for the ZAP scan. Severities are based on realistic impact for a building-level book-lending app, so not everything is High. Finding IDs match `threats.csv`.

## Review table

| Category | Question | Finding | Severity (H/M/L) | Mitigation |
|---|---|---|---|---|
| Authn | Is every non-public endpoint protected by JWT? | **S-01:** the spec has no global `security` requirement. `GET /books` and `GET /books/{bookId}` have no `security` block, so they're effectively public. The spec also doesn't say how tokens are validated. | M | Add a global `security: [bearerAuth: []]` and set `security: []` only on `/health`. API validates `alg` = RS256 only (reject `none` and HS256), `iss`, `aud`, `exp`, `nbf`, with 2 min clock skew. Access token lifetime 30 min (well within the 1 h NFR). CI contract test S5 checks every operation returns 401 without a token. |
| Authz | Does every /{id}-shaped endpoint check object ownership? | **S-02:** `GET /members/{memberId}/loans` returns the loan history of whatever `memberId` is in the URL, and `GET /members/{memberId}` returns their flat number. IDs are sequential integers, so they're trivial to guess. Classic BOLA (OWASP API1). Full scenario below. | H | Take the member from the token's `sub` claim, never from the URL: replace with `GET /me/loans` and `GET /me`. For `/loans/{loanId}` and `/listings/{listingId}` writes, check `loan.BorrowerId == sub or loan.LenderId == sub` in the query itself, and return 404 (not 403) when it doesn't match so IDs can't be probed. Switch public IDs to GUIDs as defence in depth (not as the fix). CI test S6 covers every `/{id}` path. |
| Injection | Are all DB queries parameterised? | **S-03:** `sort` on `GET /books` is a free-text string. Column names can't be passed as SQL parameters, so this is exactly where developers end up concatenating strings (`ORDER BY " + sort`). `q` also has no `maxLength`. | M | Make `sort` an enum in the spec (`title`, `author`, `createdAt`) and map it to a fixed column name in code via a switch/dictionary. `q`: `maxLength: 100`, passed as a parameter, with `%`, `_` and `[` escaped for `LIKE`. Code review checklist item: no string-built SQL anywhere. |
| Secrets | Where are connection strings stored? | **S-04:** Day 2 keeps the SQL connection string (with password) and the Redis key as plain App Service app settings, and `appsettings.Development.json` with real values is in the git history. | M (H if those values are still valid) | Rotate any secret that was ever in git. Use a managed identity for Azure SQL (Entra authentication, no password at all), Service Bus and Blob Storage (RBAC roles). Redis key and JWT signing key go in Key Vault, referenced from App Service as `@Microsoft.KeyVault(SecretUri=...)`. Key Vault access via the app's managed identity with "Key Vault Secrets User" only. |
| Transport | Is TLS enforced at Front Door? | **S-05:** Front Door has "Redirect to HTTPS" on and minimum TLS 1.2, which is good. But the App Service still accepts traffic directly on `bookswap-api.azurewebsites.net`, so anyone can skip the WAF and the rate limits by calling the origin directly. | M | App Service access restriction: allow only service tag `AzureFrontDoor.Backend` **and** require header `X-Azure-FDID` = our Front Door profile ID (the service tag alone allows *any* Front Door customer). Set App Service "HTTPS only" and min TLS 1.2. Add `Strict-Transport-Security: max-age=31536000`. Blob Storage: disable anonymous access, SAS URLs for covers expire after 15 min. |
| Rate limit | Are auth and write endpoints rate-limited? | **S-06:** `POST /auth/login` has no rate limit anywhere, so credential stuffing with leaked passwords is unlimited. `POST /listings` also has none, so one account could flood the building's catalogue. | H (login), M (listings) | Front Door WAF custom rate-limit rule: `RequestUri` contains `/auth/login`, threshold 10 per 1 minute per client IP, action Block. In the API: after 5 failed logins for one account in 15 minutes, lock that account for 15 minutes (lock the account, not the IP, because of shared NAT). Listings: 20 per member per hour in the API, plus the WAF rule from the runbook. Return 429 with `Retry-After`. |
| PII | What PII appears in responses, logs, or queues? | **S-07:** the request-logging middleware logs full request bodies, so `POST /auth/login` passwords and `PATCH /members` phone numbers end up in Azure Monitor Logs. **S-08:** `GET /listings/{listingId}` returns the owner's full object, including flat number and phone, to any member (excessive data exposure). **S-09:** `email-digest` Service Bus messages contain the member's email and full name. | H (S-07), M (S-08), L (S-09) | S-07: switch off body logging; add a telemetry processor that drops `Authorization` headers and redacts `password`, `phone`, `email`, `address`, `flatNumber` fields; purge the affected logs with the Log Analytics purge API. S-08: listing response DTO returns owner display name only. Pickup details are visible only to the borrower of an approved loan. S-09: put only `memberId` on the message and let the worker look up the email when sending. |

## BOLA scenario (S-02) in detail

Two members in the same building: Nadeesha (member 1042) and Kasun (member 1043). Nadeesha logs in normally and gets a valid token for herself.

```http
GET /members/1043/loans HTTP/1.1
Host: api.bookswap.example
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...   (token for member 1042, sub = "1042")
```

What happens today: the API checks the token is valid (it is), then runs `SELECT ... FROM Loans WHERE MemberId = @memberId` using the URL value. It returns **200** with Kasun's full loan history, and the embedded lender/borrower objects include flat numbers. A short loop from 1 to 25,000 dumps the reading history and flat number of every member across all 200 buildings. HTTPS doesn't help at all: the request is perfectly legitimate at the transport level. The missing check is inside the application.

After the fix:

```http
GET /me/loans HTTP/1.1
Authorization: Bearer <token for 1042>
-> 200, only loans where BorrowerId = 1042 or LenderId = 1042

GET /loans/88731 HTTP/1.1          (a loan between two other members)
Authorization: Bearer <token for 1042>
-> 404 Not Found
```

The ownership filter goes into the SQL query (`WHERE LoanId = @id AND (BorrowerId = @sub OR LenderId = @sub)`) instead of being an `if` after loading the row, so a forgotten check can't leak the object.

## ZAP baseline findings

Scan: `run-zap.sh` (baseline profile) against the Prism mock on `http://host.docker.internal:4010`. The full report is in `zap-baseline-report.html`.

Two findings we're discussing:

1. **X-Content-Type-Options header missing (Low, rule 10021).** The mock doesn't send `X-Content-Type-Options: nosniff`, so a browser could try to guess the content type of a response. For a JSON API this is low impact, but it's a one-line fix, so it's going into the response-headers middleware along with HSTS (S-05). Real finding for production; fix it.
2. **Cross-domain misconfiguration (CORS) (Medium per ZAP, rule 10098).** Prism allows any origin (`Access-Control-Allow-Origin: *`) by default. This one is partly a **false positive for the mock**: Prism does it to make local development easy. But it's a good reminder to check production. Our real API must set CORS to only the BookSwap web app origin. We're adding that as an explicit config item so it isn't left to framework defaults.

What a baseline scan can't tell us: it doesn't log in, so it never tests BOLA (S-02), rate limits (S-06), or logging (S-07). Our three High findings came from reading the spec and the design, not from ZAP. Next time we'd use `zap-api-scan.py` with the OpenAPI file and a test token, so ZAP can reach the authenticated endpoints.

## Summary by severity

| Severity | Findings |
|---|---|
| High | S-02 BOLA on member loans and profile, S-06 no login rate limit, S-07 passwords and PII in logs |
| Medium | S-01 public search endpoints, S-03 sort-parameter injection risk, S-04 secrets in app settings and git history, S-05 origin reachable without Front Door, S-08 owner contact details in listing responses, ZAP CORS |
| Low | S-09 PII in digest queue messages, ZAP missing `nosniff` header |

If we only fix three things before Sunday: S-02, S-06 and S-07. The tabloid will bring curious people and bots, and these are the ones they'd find first.
