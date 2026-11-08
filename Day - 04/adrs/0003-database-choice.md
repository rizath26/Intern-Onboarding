# ADR 0003: Use Azure SQL Database, with the audit log in an append-only ledger table

## Status

Accepted (date: 2026-11-08)

## Context

- **Data shape is relational and small.** The entities are Claim (category, date, amount in LKR, description, status, claimant, approver), Receipt (1 to 5 per claim), AuditEntry (many per claim), ExportBatch (many claims), Outbox and NotificationLog. They're linked by foreign keys, with a few thousand claims a year (assumption A3).
- **State changes must be atomic.** Submit has to change the claim's status, write an audit row and write an outbox event **in one transaction**. Otherwise we risk a submitted claim with no audit trail, or a notification for a change that was rolled back.
- **Finance queries cut across claims.** "All Approved claims not yet exported, by employee and date range" is a natural SQL query and an awkward document-store query.
- **Audit must be tamper-evident and kept for 7 years** (finance policy). "Tamper-evident" means that if someone with database access edits or deletes history, we can **prove** it happened. Restricting access alone isn't enough.
- **Team skills:** the team writes SQL and EF Core every day (assumption A1). Nobody has run Cosmos DB in production.
- **Availability:** 99.9% during business hours. The database is on the critical path for every request.
- **What we don't yet know:** whether Finance's 7-year rule applies to receipts and claim data, or only to the audit log. Also whether BISTEC must honour data-erasure requests from leavers under Sri Lanka's Personal Data Protection Act. **Open question for Finance and Legal.**

## Decision

- We use **Azure SQL Database, General Purpose, provisioned 2 vCores**.
- We **do not** use serverless auto-pause. Resuming after a pause adds a delay that would break the 1.5 s p95 for the first submissions at 08:00.
- **Authentication is Microsoft Entra only.** The App Service managed identity is the only application login, and SQL authentication is disabled.
- **The audit log is an append-only ledger table** (`audit.ClaimTransition`: claimId, fromStatus, toStatus, actorObjectId, occurredAtUtc, reason). SQL Server refuses UPDATE and DELETE on that table, and the ledger's hashes let us detect any tampering with the history.
- **Automatic digest storage** writes the database ledger digests to the *Ledger Digest Store*, a separate Storage account with a time-based immutability policy. Verification (`sys.sp_verify_database_ledger_from_digest_storage`) runs weekly, and a failure raises an alert.
- **To minimise personal data in the audit**, audit rows store Entra object IDs, never names or emails. Names are resolved when displayed.
- **Data conventions:** amounts are `DECIMAL(12,2)` in LKR, never floating point. All timestamps are `datetime2` in UTC and shown in SLST (UTC+05:30).
- **Backups:** we keep the default point-in-time restore window, plus **long-term retention with yearly full backups kept for 7 years**.

## Consequences

- **Easier:** the claim, its audit row and its outbox event commit or fail together. Finance export and reporting are plain SQL. The team uses familiar tools (EF Core migrations, SSMS). Tamper evidence comes built in, so we don't need a separate audit service.
- **Harder (uncomfortable):** **audit rows can never be corrected or deleted, by anyone, including us.** If a bug writes a wrong audit row, the only fix is a new compensating row ("correction of entry X"), and auditors will see both. If BISTEC ever receives a valid data-erasure request for a leaver, we **cannot** remove their audit history. Using object IDs reduces the exposure but doesn't remove it. Legal must accept this before go-live.
- **Harder:** a ledger table can't be turned back into a normal table, and its schema is harder to change. Migrations to `audit.ClaimTransition` need extra review.
- **Harder:** a provisioned database costs money 24/7 even though the app is used about 55 hours a week. We pay for the evenings to protect the morning p95.
- **Different:** "the audit is safe" now depends on a process (weekly digest verification and someone acting on the alert), not just on the database configuration.

## Alternatives considered

- **Azure Cosmos DB (NoSQL API):** rejected. A claim with its receipts would fit well as a document, and we could keep claim, audit and outbox items in one logical partition (claimId) to use transactional batch. But finance queries across many claims would be cross-partition and awkward. Cosmos has no built-in tamper-evident ledger, so we'd have to build one from the change feed and immutable storage. And the team has no production Cosmos experience. Its main strengths, global distribution and huge scale, don't apply here.
- **Azure SQL with a normal audit table and restricted permissions:** rejected. Restricting who can write isn't **tamper-evident**: a DBA or a compromised identity could change history without any trace. That fails the brief.
- **Azure Confidential Ledger as a separate audit store:** rejected for v1. It's strongly tamper-proof, but it adds a second store that must stay consistent with SQL. We'd need cross-store writes for every transition, which reintroduces the atomicity problem this ADR avoids. Automatic digest storage can target Confidential Ledger later if auditors demand it.
