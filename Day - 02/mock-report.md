# BookSwap — Mock Smoke Test Report

**Spec under test:** `openapi/bookswap-openapi.yaml` (BookSwap API 0.1.0, OpenAPI 3.1.0)
**Mock server:** Stoplight Prism CLI 5.14.2 · **Runtime:** Node.js 20+ · **Result:** 5 / 5 passing

## Setup

Run every command from the repository root (`bookswap-design/`).

1. Validate the spec (must print `... is valid`):

   ```bash
   npx @apidevtools/swagger-cli@4.0.4 validate openapi/bookswap-openapi.yaml
   ```

2. Start the mock in terminal 1:

   ```bash
   npx @stoplight/prism-cli@5.14.2 mock openapi/bookswap-openapi.yaml --port 4010
   ```

   > The session guide says `npx @stoplight/prism mock`. That package name does not
   > exist on npm (it returns `404 Not Found`). The Prism CLI is published as
   > `@stoplight/prism-cli`. Pinning the version keeps results reproducible.

3. Run the tests in terminal 2, using **either** option:

   * **Script:** `bash reports/smoke-test.sh` (prints one PASS/FAIL line per test and exits non-zero on any failure)
   * **Postman / Bruno:** import `reports/bookswap-smoke.postman_collection.json` (Bruno imports Postman collections directly), keep `baseUrl = http://127.0.0.1:4010`, and run the collection. The same collection was run headless with `npx newman run reports/bookswap-smoke.postman_collection.json` and gave identical status codes.

Prism checks that an `Authorization: Bearer …` header is **present and well-formed**; it does not verify the JWT signature. Any token string works for tests 1–4.

## Results

| # | Endpoint | Method | Body / Params | Expected status | Actual status | Result |
|---|---|---|---|---|---|---|
| 1 | `/books` | GET | `page=1&pageSize=20`, bearer token | 200 | **200** | Pass |
| 2 | `/books` | POST | `{"title":"Ponniyin Selvan","author":"Kalki Krishnamurthy","isbn":"9788184930801","condition":"good"}` | 201 | **201** | Pass |
| 3 | `/books` | POST | `{"author":"Kalki Krishnamurthy","condition":"good"}` (no `title`) | 400 or 422 | **422** | Pass |
| 4 | `/books/999/borrow-requests` | POST | borrower token, `Idempotency-Key` header, `{"message":"Can I borrow it this weekend?"}` | 201 | **201** | Pass |
| 5 | `/books` | GET | no `Authorization` header | 401 | **401** | Pass |

Script output:

```text
1  GET  /books?page=1&pageSize=20                   expected 200       actual 200  PASS
2  POST /books (valid payload)                      expected 201       actual 201  PASS
3  POST /books (missing title)                      expected 400 422   actual 422  PASS
4  POST /books/999/borrow-requests (borrower JWT)   expected 201       actual 201  PASS
5  GET  /books (no Authorization header)            expected 401       actual 401  PASS
----
5/5 passing
```

Additional probes run during the session (not part of the required five):

| Probe | Actual | What it shows |
|---|---|---|
| `GET /books?pageSize=500` | 400 | `maximum: 100` on `pageSize` is enforced |
| `POST /books` with `"isbn":"12-34"` | 422 | ISBN pattern is enforced |
| `POST /books/bk1/photo-uploads` with `contentLength: 6000000` | 422 | 5 MB photo limit is enforced at the API contract |
| `POST /books` with `Authorization: Basic abc` | 401 | Wrong auth scheme is rejected, not just a missing header |
| `POST /books` (valid) — response headers | `Location: /books/bk_8d2f41`, `X-Request-Id: req_7f3c9a1e` | Both headers declared in the spec are returned |
| `POST /books/999/borrow-requests` with `Prefer: code=409` | 409 | Error paths can be exercised on demand (see finding 5) |

## Results summary

| Metric | Target | Achieved |
|---|---|---|
| Tests run | 5 | 5 |
| Tests passing against the mock | 5 | 5 |
| Endpoints with explicit error responses | 4+ | 16 of 16 operations (all declare 401 plus at least one of 400 / 404; 9 distinct status codes used across the API: 200, 201, 204, 400, 401, 403, 404, 409, 422) |

## Findings

**1. Every error body says "422 — title is required", even on a 401.**
Test 5 returned status 401, but the body Prism generated was
`{"status":422,"detail":"title is required", …}`. Prism builds error bodies from the
`examples` on the shared `Problem` schema, so every error response looks like a
validation failure. A mobile developer building against this mock would write
error-handling code against the wrong message. The status code contract is right;
the example payloads are wrong.

**2. List metadata in the mock contradicts itself.**
`GET /books?page=1&pageSize=20` (and `pageSize=5`) returned
`"pageSize":1,"total":0` together with one item in `items`. Prism invents the
numbers from the schema minimums because the 200 response has no example. Anyone
testing pagination UI ("Page 1 of N") against the mock gets nonsense.

**3. Mock borrow request breaks our own business rule and reuses one id everywhere.**
Test 4 returned `"status":"pending"` with `"loanId":"string"` and a `decidedAt` date,
but a pending request by definition has no loan and no decision. The same
response also showed the book id, the borrower id and the owner id all as
`bk_8d2f41`, because the shared `Id` schema carries a book-style example. This looks
like a member *is* a book, which is confusing for anyone reading the mock output.

**4. The 400 vs 422 split works, but it is not written down.**
Out-of-range query parameters gave 400 (`pageSize=500`), while a well-formed JSON
body that fails a rule gave 422 (missing title, bad ISBN, 6 MB photo). That is the
convention we intended, but a client developer can only discover it by
experiment.

**5. Error paths need a `Prefer` header to test.**
Prism always returns the first success code unless asked otherwise, so 404 and
409 can only be exercised with `Prefer: code=404` / `Prefer: code=409`. Testers must
know this or they will believe those paths are untested.

### Endpoints that feel awkward to call

* **Photo upload is two calls.** `POST /books/{bookId}/photo-uploads` returns a SAS
  URL, then the app must `PUT` the bytes to Blob Storage. This is deliberate (photos
  never pass through the API), but the mock returns `uploadUrl: http://example.com`,
  so the second step cannot be rehearsed at all against the mock.
* **`role` is required on `GET /loans` and `GET /borrow-requests`.** Calling
  `GET /loans` without it returns 400. A "show me everything I'm involved in" screen
  needs two calls.

## Spec changes I would make

All line numbers refer to `openapi/bookswap-openapi.yaml` at version 0.1.0.

1. **Lines 632–689 (`components.responses`):** add a named example to each shared
   error response so the body matches the status, e.g. under `Unauthorized`
   (line 642) add `content.application/problem+json.examples.missing-token` with
   `{"type":"…/problems/unauthorized","title":"Missing or invalid token","status":401}`;
   do the same for `BadRequest` (400), `Forbidden` (403), `NotFound` (404),
   `Conflict` (409) and `UnprocessableEntity` (422). Fixes finding 1.
2. **Line 61 (`GET /books` → `200`):** add an `examples.first-page` block with
   `page: 1, pageSize: 20, total: 2` and two realistic books, so mock pagination
   metadata is consistent. Fixes finding 2.
3. **Line 694 (`components.schemas.Id`):** remove `examples: [bk_8d2f41]`, and
   **line 268 (`POST /books/{bookId}/borrow-requests` → `201`):** add an example
   with `status: pending`, `loanId: null`, `decidedAt: null`, and distinct ids
   (`br_19`, `bk_8d2f41`, `mem_77`, `mem_41`). Fixes finding 3.
4. **Line 22 (`info.description`):** add one bullet: "Invalid query or path
   parameters return 400; a well-formed body that breaks a validation rule returns
   422." Fixes finding 4.
5. **Lines 295 and 389 (`role` on `/borrow-requests` and `/loans`):** make `role`
   optional (`required: false`) and document "omit to return both". Removes the
   double call described above.

Finding 5 needs no spec change; it is covered in the Setup section of this report.
