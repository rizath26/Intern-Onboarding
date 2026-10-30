# BookSwap — Storage and Cache Decisions

**Status:** Proposed for review · **Version:** 0.1 · **Scope:** BookSwap backend v1

## Summary

BookSwap keeps all business data in **one Azure SQL database**, because the core
flow (request → accept → loan → return) changes several related rows at once and
must never double-lend a book. Photos go to **Azure Blob Storage** and never touch
the API or the database. **Azure Cache for Redis** holds one thing: the first page
of each building's catalogue, which every member sees on the home screen. **Azure
Service Bus** carries all email work, so listing a book or requesting a loan never
waits on, or fails because of, the email service.

### Sizing assumptions

These numbers drive every choice below. They are estimates for year one and should
be replaced with real figures after launch.

| Assumption | Value | Basis |
|---|---|---|
| Buildings | 10 | Brief allows up to 5,000 books per building; 10 × 5,000 = 50,000 books |
| Members | ~4,000 | ~400 flats per building, one active member per flat |
| Catalogue reads | ~40,000 / day | 4,000 members × ~10 catalogue views per day at peak adoption |
| Borrow requests | ~100,000 / year | ~2 requests per member per month |

---

## 1. Data inventory

| Data type | Example record | Volume estimate (1y) | Read/write ratio |
|---|---|---|---|
| Member | `mem_41 · "Kavitha S." · building b_3 · flat 12B · +94 77…` | ~4,000 rows | Read-heavy (read on every request via JWT lookup, written at sign-up) |
| Book listing | `bk_8d2f41 · Ponniyin Selvan · Kalki · good · available` | ~50,000 rows across all buildings | Read-heavy, roughly 100 : 1 |
| Book photo | `photos/bk_8d2f41.jpg`, ≤ 5 MB | ~50,000 files, ~75 GB (avg 1.5 MB) | Read-heavy |
| Borrow request | `br_19 · bk_8d2f41 · borrower mem_77 · pending` | ~100,000 rows | Balanced, roughly 3 : 1 |
| Loan | `ln_7 · bk_8d2f41 · lender mem_41 · borrower mem_77 · due 2026-11-25` | ~60,000 rows | Read-heavy, roughly 5 : 1 |
| In-app notification | `nt_301 · mem_41 · "Kavitha S. wants to borrow…" · unread` | ~250,000 rows | Read-heavy (polled while app is open) |
| Email job (message) | `{type: "digest", memberId: "mem_41", week: "2026-W44"}` | ~210,000 digest + ~200,000 event emails | Write once, read once, then deleted |
| Digest send log | `mem_41 · 2026-W44 · sent 08:01` | ~210,000 rows | Write-heavy, read only for de-duplication |
| Hot catalogue page (copy) | `catalogue:b_3:v42:p1:s20:any` → 20 books as JSON | ≤ 100 keys, < 5 MB total | Very read-heavy |

## 2. Storage selection

**Source of truth rule:** every piece of business data has exactly one source of
truth, shown in the last column. Redis and Service Bus never hold anything that
cannot be rebuilt from Azure SQL.

| Data type | Chosen store | Why this store | Why not the alternatives | Source of truth |
|---|---|---|---|---|
| Member | Azure SQL (`members`, `member_private`) | Every book, request and loan has a foreign key to a member. Address and phone sit in a separate `member_private` table that the API's read model never selects, which enforces the privacy rule in the schema, not just in code. | **Cosmos DB:** profiles are small and fixed-shape; we would lose the foreign keys that stop a loan pointing at a deleted member. **Entra External ID only:** Entra holds identity, but building and flat are BookSwap business data and we need to join on them. | Azure SQL (identity itself: Entra) |
| Book listing | Azure SQL (`books`) | Searched by title/author/ISBN and filtered by condition and building. An index on `(building_id, created_at DESC)` narrows any query to at most 5,000 rows before the text filter runs, which keeps p95 well under 300 ms without a search engine. | **Cosmos DB:** accepting a request must update the book, the request and a new loan in one transaction; Cosmos only guarantees transactions inside one logical partition, so we would have to design every partition key around that one flow. **Azure AI Search:** adds a second copy of the data, a sync pipeline and a monthly cost, for 5,000 rows per building that SQL already handles. Revisit if we need fuzzy matching ("Ponniyan" → "Ponniyin") or exceed ~1 million books. | Azure SQL |
| Book photo | Azure Blob Storage (`photos` container) | Binary and up to 5 MB. The app uploads directly with a 10-minute write-only SAS URL, so the API never streams megabytes and App Service stays small. Hot tier with a lifecycle rule to Cool after 180 days. | **SQL `VARBINARY`:** 75 GB of images would make the database ~100 times larger than its real data, slow every backup and restore, and cost far more per GB. **Storing on App Service disk:** lost on redeploy or scale-out. | Blob Storage (SQL stores only the blob name) |
| Borrow request | Azure SQL (`borrow_requests`) | State machine (pending → accepted / declined / cancelled) with strict rules. A unique filtered index on `(book_id, borrower_id) WHERE status = 'pending'` makes duplicate requests impossible at the database level. | **Redis:** fast but not a durable record; a restart could lose a pending request. **Queue:** a request must be queryable ("show my incoming requests"); a queue only supports take-next. | Azure SQL |
| Loan | Azure SQL (`loans`) | Created in the same transaction that accepts a request and flips `books.available` to false. "Overdue" is computed as `returned_at IS NULL AND due_at < now()`, so no nightly job is needed to keep it correct. Borrower history is one indexed query on `book_id`. | **Cosmos DB:** same multi-row transaction problem as Book listing. **Storing an `overdue` flag:** would need a scheduled job and could be wrong between runs; computing it is always right. | Azure SQL |
| In-app notification | Azure SQL (`notifications`) | Written **in the same transaction** as the borrow request, so the owner's notification exists the instant the request does. The app polls `GET /notifications?unread=true` every 2 seconds while open, which meets the 2-second target. | **Created by a queue consumer:** if the worker were down, notifications would miss the 2-second target. **Redis only:** lost on cache restart; notifications are a record the member may scroll back through. | Azure SQL |
| Email jobs | Azure Service Bus queues (`event-emails`, `digest-emails`) | Decouples the API from the email provider. Messages survive a worker or email outage and are retried automatically. | **Calling ACS Email inside the API request:** an email outage would fail or slow book listing, breaking a non-functional requirement. **Storage Queues:** cheaper, but no built-in dead-letter queue or duplicate detection, both of which we use below. | Azure SQL (a message only says "send X"; the content is read from SQL when sending) |
| Digest send log | Azure SQL (`digest_sends`) | Primary key `(member_id, iso_week)` makes a second send of the same digest impossible even if Service Bus delivers a message twice. | **Relying on Service Bus duplicate detection alone:** it only covers a time window of minutes to days and only for identical message IDs; a database key is permanent. | Azure SQL |
| Hot catalogue page | Azure Cache for Redis | Sub-millisecond reads for the busiest screen. Pure copy, see section 3. | **No cache at all:** a valid choice at today's volume (see "hit-rate hypothesis" below); the cache is justified by cost and headroom, not by the 300 ms target alone. | Azure SQL (Redis is a disposable copy) |

> **Note on Azure Cache for Redis.** The brief names Azure Cache for Redis. Microsoft
> has announced its retirement (Basic/Standard/Premium on 30 September 2028) and
> recommends Azure Managed Redis for new work. The design below is identical on
> either service, because both speak the standard Redis protocol; for a real build
> we would provision Azure Managed Redis.

## 3. Cache plan

### What is hot enough to cache?

| Cached | Key | TTL | Why |
|---|---|---|---|
| First catalogue page per building, per condition filter, no search text | `catalogue:{buildingId}:v{version}:p{page}:s{pageSize}:{condition or "any"}` (pages 1–2 only) | 60 s | The home screen: every member opening the app requests exactly this. Many identical reads, changes only when a neighbour lists or lends a book. |
| Single book detail | `book:{bookId}` | 300 s | Opened from the home screen and from notifications; changes rarely. Explicitly deleted on every write. |

**Hit-rate hypothesis:** we expect at least 70% of `GET /books` calls to be the
unfiltered first page. If the measured hit rate on `catalogue:*` keys is below 50%
after two weeks in production, we remove this cache, because it would then be
infrastructure without benefit.

**TTL rationale:** a neighbour seeing a new listing up to 60 seconds late is
harmless. The TTL is a safety net only; correctness comes from versioned keys,
which make every write in a building instantly invisible to old cached pages.

### Cache-aside pattern (pseudocode)

```javascript
const CACHE_TIMEOUT_MS = 50;            // never let a slow cache slow the API

async function getCataloguePage(buildingId, page, pageSize, condition) {
  const cacheable = page <= 2 && !searchText;      // only the hot pages
  if (!cacheable) return db.queryCatalogue(buildingId, page, pageSize, condition);

  let version = 0;
  try {
    version = (await redis.get(`catalogue-version:${buildingId}`, { timeout: CACHE_TIMEOUT_MS })) ?? 0;
    const key = `catalogue:${buildingId}:v${version}:p${page}:s${pageSize}:${condition ?? "any"}`;
    const cached = await redis.get(key, { timeout: CACHE_TIMEOUT_MS });
    if (cached) return JSON.parse(cached);                       // cache hit

    const rows = await db.queryCatalogue(buildingId, page, pageSize, condition); // miss → source of truth
    // TTL 60 s: a listing appearing up to 1 minute late is acceptable
    await redis.set(key, JSON.stringify(rows), "EX", 60);
    return rows;
  } catch (cacheError) {
    log.warn("cache unavailable, reading from SQL", { cacheError });
    return db.queryCatalogue(buildingId, page, pageSize, condition); // cache down → slower, not broken
  }
}

async function onBookChanged(book) {       // called after create, update, delete, accept, return
  await db.commit();                        // 1. write the source of truth first
  try {
    await redis.incr(`catalogue-version:${book.buildingId}`); // 2. old page keys become unreachable
    await redis.del(`book:${book.id}`);                       // 3. drop the stale detail copy
  } catch (e) {
    log.warn("cache invalidation failed; TTL will expire it", { e }); // worst case: 60 s / 300 s stale
  }
}
```

Bumping a per-building version number instead of deleting keys one by one means we
never have to know which page, page size or filter combinations exist in the cache.
Old keys simply expire on their own.

### When **not** to cache

| Not cached | Reason |
|---|---|
| Searches with free text (`?search=…`) | Long tail of different queries, so the hit rate would be close to zero. SQL answers them in a few milliseconds over ≤ 5,000 rows. |
| Book availability when **accepting a borrow request** | The accept transaction reads `books.available` directly from SQL with a row lock. A cached "available: true" could lend one book to two people. |
| Borrow requests, loans, notifications | Per-member data with low repeat reads, and freshness matters (2-second notification target). Caching would add staleness without saving meaningful load. |
| Anything from `member_private` | Never leaves SQL, so it can never leak through a cache dump or a wrong key. |

## 4. Queue plan

### What goes on a queue and why

| Queue | Producer | Consumer | Messages | Why a queue |
|---|---|---|---|---|
| `event-emails` | API service, after its database transaction commits | Worker → ACS Email | "Borrow request received" email to owner; "accepted / declined" email to borrower; "your loan is overdue" | Email is slow and can fail. The member's action must succeed even when email is down. |
| `digest-emails` | Worker's weekly timer (Monday 08:00 Asia/Colombo) fans out **one message per member** | Worker → ACS Email | `{memberId, isoWeek}` | 4,000 emails as one big job would restart from zero on any failure; one message per member retries only the member that failed. |

In-app notifications are **not** on a queue (see section 2); they are written in
the request's own transaction to meet the 2-second target.

If publishing to Service Bus fails right after the commit, the API still returns
success to the member and writes the event to a small `pending_events` table; the
worker re-publishes those rows every minute. The member's action is never lost,
and at worst the email is a minute late.

### Settings

| Setting | `event-emails` | `digest-emails` | Reason |
|---|---|---|---|
| Max delivery count | 10 | 10 | Guards against a "poison" message that crashes the worker every time: after 10 deliveries it moves to the dead-letter queue instead of looping forever. Normal send failures use scheduled retries instead (see below). |
| Message time-to-live | 24 hours | 72 hours | A "someone wants your book" email two days late is worse than none (the in-app notification already told them). A digest is still useful later in the week. |
| Lock duration | 1 minute | 1 minute | Long enough for one ACS send call. |
| Duplicate detection | On, 10 minutes, `MessageId = eventId` | On, 10 minutes, `MessageId = memberId:isoWeek` | Stops double-sends when a producer retries. `digest_sends` is the permanent guard. |

### What happens if the consumer is down for 30 minutes?

1. **Members notice nothing in the app.** Listings, requests, accepts and returns all
   succeed, because they only need SQL. In-app notifications still arrive within
   2 seconds.
2. **Messages wait safely in Service Bus.** At our volume a 30-minute backlog is at
   most a few hundred messages, far inside any limit; nothing is lost and no message
   comes close to its 24-hour TTL.
3. **When the worker returns, it drains the backlog** in arrival order. Emails are
   up to 30 minutes late, which the brief allows ("email digest is best-effort").
4. **No duplicates on recovery.** A message whose lock expired mid-send is delivered
   again; the worker checks `digest_sends` (or the event's `sent_at`) before calling
   ACS, so the member gets one email.
5. **Alerts fire** when the oldest message in either queue is older than 15 minutes,
   or when the dead-letter queue has more than 0 messages, so the team learns about
   the outage from monitoring rather than from members.

### Retry and dead-letter handling

* **Transient failure** (ACS returns 429 or 5xx, or times out): the worker sends a
  copy of the message scheduled for later and completes the original, in one Service
  Bus transaction so the email is neither lost nor duplicated. Delays grow 1, 2, 4,
  8, 16, 30, 30, 30 minutes (about 2 hours in total), tracked in an `attempt`
  property. After the 8th attempt the message is dead-lettered. Scheduling the retry,
  rather than abandoning the message, means a 30-minute ACS outage does not burn
  through all retries in the first minute.
* **Circuit breaker:** after 5 consecutive ACS failures the worker stops receiving
  for 60 seconds (or the `Retry-After` value on a 429), so it backs off as a whole
  instead of hammering a provider that is already struggling.
* **Permanent failure** (invalid email address, member deleted): the worker
  dead-letters the message immediately with a reason. Retrying cannot fix it.
* **Dead-letter queue review:** an engineer inspects the DLQ daily; fixed messages
  are re-submitted with a small script. Messages untouched for 14 days are deleted.

## 5. Decisions requested

1. Approve Azure SQL as the single system of record (no Cosmos DB in v1).
2. Approve caching only the first two catalogue pages and book detail, with removal
   if hit rate stays below 50%.
3. Approve the 2-second polling approach for in-app notifications in v1. Upgrade
   path if polling cost becomes noticeable: Azure Web PubSub push, with no change
   to the data model.
