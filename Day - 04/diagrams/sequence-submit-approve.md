# Sequence — Submit and Approve a Claim

Lifeline names are exactly the container and external-system names used in the
[Container diagram](container-diagram.png). Background components inside the Claims API
(Outbox Publisher, Notification Dispatcher) appear as self-calls on the `Claims API` lifeline.

**Notation**

| Arrow | Meaning |
|-------|---------|
| `->>` solid line, filled head | Synchronous call that waits for a response |
| `-->>` dashed line | Response to an earlier synchronous call |
| `-)` solid line, open head | Asynchronous message (no caller waiting) |
| Arrow back to the same lifeline | Self-call / background work inside that container |

**Precondition:** the user is already signed in through Microsoft Entra ID (MSAL.js, auth code + PKCE),
so every call from the Web App to the Claims API carries a Bearer JWT.

## Happy path

Receipts upload **while the claimant fills in the form**, before they tap Submit.
That's why the 1.5 s p95 target (shaded) covers only the submit call, not up to 50 MB of uploads.

```mermaid
sequenceDiagram
  autonumber
  actor STAFF as Staff member
  participant WEB as Web App
  participant API as Claims API
  participant ENTRA as Microsoft Entra ID
  participant DB as Claims Database
  participant BLOB as Receipt Store
  participant SB as Event Queue
  participant TEAMS as Teams Workflows
  actor MGR as Line manager

  STAFF->>WEB: Start new claim (category, date, amount LKR, description)
  WEB->>+API: POST /claims (Bearer JWT)
  API->>+ENTRA: GET /users/{id}/manager (Microsoft Graph)
  ENTRA-->>-API: Manager object ID and UPN
  API->>DB: INSERT claim status=Draft, approverId + audit row (none to Draft) in one transaction
  API-->>-WEB: 201 Created claimId

  STAFF->>WEB: Attach receipt image(s), up to 5 files of 10 MB each
  WEB->>+API: POST /claims/{id}/receipts (name, size, contentType)
  API->>API: Check count and size limits and allowed type (JPEG or PNG)
  API->>DB: INSERT receipt metadata status=PendingUpload
  API-->>-WEB: 200 OK upload URL (user-delegation SAS, this blob only, 15 min)
  loop Each 1 MiB block of each file
    WEB->>BLOB: PUT Block (SAS)
    BLOB-->>WEB: 201 Created
  end
  WEB->>BLOB: PUT Block List (commit)
  BLOB-->>WEB: 201 Created
  Note over BLOB: Defender for Storage scans the new blob asynchronously and writes the result as a blob index tag

  rect rgb(232, 245, 233)
    Note over STAFF,DB: p95 target under 1.5 s on office Wi-Fi
    STAFF->>WEB: Tap "Submit claim"
    WEB->>+API: POST /claims/{id}/submit (Bearer JWT)
    API->>+BLOB: HEAD each receipt blob (committed, size)
    BLOB-->>-API: 200 OK for every receipt
    API->>DB: BEGIN, UPDATE status=Submitted, INSERT audit row, INSERT outbox claim.submitted, COMMIT
    API-->>-WEB: 200 OK status=Submitted
    WEB-->>STAFF: Show "Submitted, waiting for your manager"
  end

  API->>API: Outbox Publisher picks up the unsent event
  API-)SB: Send claim.submitted (eventId, claimId, approver UPN)
  API->>DB: Mark outbox row as sent
  SB-)API: Deliver claim.submitted to Notification Dispatcher (peek-lock)
  API->>+TEAMS: POST Adaptive Card payload to webhook URL
  TEAMS-->>-API: 202 Accepted
  API->>DB: INSERT notification log (eventId, channel=teams)
  API-)SB: Complete message
  TEAMS-)MGR: Flow bot chat card with "Review claim" deep link

  MGR->>WEB: Open deep link /claims/{id}
  WEB->>+API: GET /claims/{id} (Bearer JWT)
  API->>API: Access policy check (caller is the claim's approver)
  API->>DB: SELECT claim and receipts
  API-->>-WEB: 200 OK claim + read-only receipt URLs (SAS, 5 min)
  WEB->>BLOB: GET receipt images (SAS)
  BLOB-->>WEB: 200 OK

  alt Manager approves
    MGR->>WEB: Tap "Approve"
    WEB->>+API: POST /claims/{id}/approve (Bearer JWT)
    API->>+BLOB: GET blob index tags (malware scan result)
    BLOB-->>-API: No threats found
    API->>DB: UPDATE status=Approved + audit row + outbox claim.decided in one transaction
    API-->>-WEB: 200 OK status=Approved
  else Manager rejects
    MGR->>WEB: Tap "Reject" and enter a reason (required)
    WEB->>+API: POST /claims/{id}/reject (Bearer JWT, reason)
    API->>DB: UPDATE status=Rejected + audit row with reason + outbox claim.decided
    API-->>-WEB: 200 OK status=Rejected
  else Manager requests more information
    MGR->>WEB: Tap "Request info" and enter a question
    WEB->>+API: POST /claims/{id}/request-info (Bearer JWT, question)
    API->>DB: UPDATE status=Draft + audit row with question + outbox claim.info_requested
    API-->>-WEB: 200 OK status=Draft
  end
  Note over API,SB: The claimant is told about the decision through the same outbox, queue and dispatcher path
```

## Error path 1 — receipt upload is interrupted (intermittent connectivity)

The claim already exists as a Draft. Nothing is lost: block blobs keep uploaded-but-uncommitted
blocks for 7 days, so the Web App resumes from the first missing block instead of starting again.

```mermaid
sequenceDiagram
  autonumber
  actor STAFF as Staff member
  participant WEB as Web App
  participant API as Claims API
  participant DB as Claims Database
  participant BLOB as Receipt Store

  WEB->>BLOB: PUT Block n (SAS)
  BLOB--xWEB: Network error or timeout

  alt Connection comes back within the retry budget
    loop Up to 5 retries, backoff 1 s, 2 s, 4 s, 8 s, 16 s
      WEB->>BLOB: PUT Block n (SAS)
    end
    opt SAS expired while offline (403 AuthenticationFailed)
      WEB->>+API: POST /claims/{id}/receipts/{receiptId}/upload-url (Bearer JWT)
      API->>API: Access policy check (caller is the claimant, claim is Draft)
      API-->>-WEB: 200 OK fresh SAS for the same blob path
    end
    WEB->>BLOB: GET Block List (uncommitted)
    BLOB-->>WEB: Blocks already stored
    WEB->>BLOB: PUT remaining blocks, then PUT Block List (commit)
    BLOB-->>WEB: 201 Created
  else Still offline after all retries
    WEB->>WEB: Save upload progress in IndexedDB
    WEB-->>STAFF: "Receipt 2 of 3 paused, will resume when you're back online"
  end

  Note over STAFF,BLOB: If the claimant taps Submit before every receipt is committed
  STAFF->>WEB: Tap "Submit claim"
  WEB->>+API: POST /claims/{id}/submit (Bearer JWT)
  API->>+BLOB: HEAD each receipt blob
  BLOB-->>-API: 404 Not Found for receipt 2 (not committed)
  opt Any receipt missing or not committed
    API->>DB: UPDATE receipt 2 status=UploadIncomplete (claim stays Draft, so no audit row)
    API-->>-WEB: 409 Conflict code=receipts_incomplete, receiptIds=[2]
    WEB-->>STAFF: Highlight receipt 2 with a "Retry upload" button
  end
```

## Error path 2 — Teams notification fails, email fallback

Teams Workflows returns `202 Accepted` when it receives the request. A failure **inside** the
workflow after that point isn't visible to us. See "Known risks" in the design pack (risk R2).

```mermaid
sequenceDiagram
  autonumber
  participant API as Claims API
  participant DB as Claims Database
  participant SB as Event Queue
  participant TEAMS as Teams Workflows
  participant EXO as Exchange Online
  actor MGR as Line manager

  SB-)API: Deliver claim.submitted to Notification Dispatcher (peek-lock)
  API->>DB: Has eventId already been notified? (idempotency check)
  DB-->>API: No

  loop Up to 3 attempts, backoff 2 s, 4 s, 8 s
    API->>+TEAMS: POST Adaptive Card payload
    TEAMS--x-API: 5xx, 429 or timeout after 10 s
  end

  alt Email fallback succeeds
    API->>+EXO: POST /users/{noreply}/sendMail (Microsoft Graph)
    EXO-->>-API: 202 Accepted
    EXO-)MGR: Email with "Review claim" link
    API->>DB: INSERT notification log (eventId, channel=email, reason=teams_failed)
    API-)SB: Complete message
  else Email also fails
    API-)SB: Abandon message (Service Bus redelivers it)
    Note over SB: After 10 deliveries the message moves to the dead-letter queue and an Application Insights alert fires
  end
```
