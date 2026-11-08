# ADR 0004: Upload receipts straight to Blob Storage with user-delegation SAS, scanned by Defender for Storage

## Status

Accepted (date: 2026-11-08)

## Context

- **Volume per claim:** up to 5 files of 10 MB each, so up to 50 MB.
- **Network reality:** staff often submit from phones. The brief says uploads "must succeed even with intermittent connectivity", so an upload that fails at 90% must not start again from zero.
- **Latency target:** submit round-trip under 1.5 s p95. That's impossible if 50 MB has to travel inside the submit request.
- **Constraint from the brief:** Azure Blob Storage with a signed-URL pattern.
- **Privacy:** only the claimant, the approver, Finance and the Auditor may see a receipt. Receipts can contain personal data such as card digits, addresses and medical details.
- **Security:** files come from every staff member and are opened by managers and Finance, so a malicious file is a real risk.
- **Retention:** receipts are financial records. We assume they follow the same 7-year rule as the audit log (assumption A5, to be confirmed with Finance).
- **What we don't yet know:** whether some staff will need PDF e-receipts. The brief says "receipt images", so v1 accepts JPEG and PNG only.

## Decision

- **Storage:** a private container `receipts` in a dedicated Storage account with no public access, HTTPS only, and **shared-key access disabled**. Blob paths are `receipts/{claimId}/{receiptId}` and never include the original file name, which could contain personal data.
- **Signed URLs:** the Claims API issues **user-delegation SAS** tokens, signed through its managed identity, never with account keys. Each token covers **one blob only**:
  - for upload: create, write and read permissions, valid for 15 minutes (read is needed to resume an interrupted upload);
  - for viewing: read only, valid for 5 minutes, issued only after the access-policy check.
  - SAS tokens **never** include the tag-write permission. The malware scan result is stored as a blob index tag, and index tags aren't tamper-resistant, so the uploader must not be able to overwrite it.
- **Resumable upload:** the Web App uploads directly to Blob Storage in **1 MiB blocks** (Put Block, then Put Block List). Failed blocks are retried with backoff, and progress is saved in IndexedDB. After a reconnect, the Web App calls Get Block List and resumes from the first missing block. (See error path 1 in the sequence diagram.)
- **Limits enforced twice:** the API refuses to issue a SAS beyond 5 files or 10 MB declared size. On submit, it checks the actual committed size of every blob.
- **Malware scanning:** **Microsoft Defender for Storage on-upload malware scanning** is enabled on the account, with a monthly spending cap. Defender writes the tag `Malware Scanning scan result`, and the Claims API reads it:
  - `No threats found`: the claim can be approved.
  - `Malicious`: the claim goes back to Draft with reason `malware_detected` and the blob is deleted. Security is alerted through Defender for Cloud.
  - `Error`, `Not scanned` or no tag yet: approval is blocked, and the manager sees "receipt still being checked". An alert fires if this lasts more than 1 hour.
- **CORS** on the Storage account allows only the GreenChit origin, with methods PUT, GET and HEAD.
- **Lifecycle:** a Storage lifecycle rule moves receipts to the Cool tier 90 days after creation and deletes them 7 years and 30 days after creation. Lifecycle rules only see blob dates, not claim status, so the extra 30 days covers the usual gap between upload and payment. A nightly job in the Claims API deletes receipts belonging to Drafts untouched for 30 days. Uncommitted blocks are removed automatically by Blob Storage after 7 days.

## Consequences

- **Easier:** large files never pass through the App Service, so submit stays fast and API instances aren't tied up streaming 50 MB. Interrupted uploads resume. There are no storage keys to rotate or leak.
- **Harder (uncomfortable):** **scanning is asynchronous, so a claim can be Submitted, and the manager notified, before we know whether its receipt is malware.** The manager may open the claim and see "receipt still being checked". During that window, the blob can still be read by anyone holding a valid read SAS, which in practice means the claimant who uploaded it. We accept this and rely on blocking approval rather than blocking submission.
- **Harder:** the Storage account has to be reachable from the public internet, because staff upload from phones outside the office. We can't put it behind a private endpoint. Protection comes from short, single-blob SAS tokens and disabled shared keys, not from the network.
- **Harder:** Defender for Storage is charged per GB scanned plus a per-account fee. It's small at our volume, but it's a new line on the Azure bill that Finance must approve.
- **Different:** the Web App is no longer a "thin" client. It owns block-upload, retry and resume logic, which needs its own tests, including on poor networks.

## Alternatives considered

- **Upload through the Claims API (API streams to Blob):** rejected. Up to 50 MB per claim would flow through App Service workers, which can't resume a broken upload, and would compete with submit requests for the p95 target (see ADR-0002's shared-process risk).
- **Self-hosted ClamAV (container or Function) triggered by Event Grid:** rejected. We'd own the virus-signature updates, scaling and patching of a security component, which a 10-person team shouldn't take on when a managed scanner exists.
- **No scanning, rely on staff endpoint antivirus:** rejected. Managers and Finance open files from every employee, and a single infected receipt would reach the people with payroll access.
- **Store receipts in Azure SQL (`varbinary`):** rejected. It bloats the database, its backups and 7 years of long-term retention. And it rules out the signed-URL pattern the brief requires.
