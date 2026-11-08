# ADR 0002: Host GreenChit as a single ASP.NET Core app on Azure App Service

## Status

Accepted (date: 2026-11-08)

## Context

- **Team:** about 10 people, strong in .NET and SQL, with limited container and infrastructure-as-code experience (assumption A1 in the README). Nobody is on call outside business hours.
- **Load is small:** BISTEC staff submitting expense claims. We estimate fewer than 50 submissions per peak hour (assumption A3), which is well under 1 request per second.
- **Quality targets:** submit round-trip under 1.5 s p95, and 99.9% availability from 08:00 to 19:00 SLST, Monday to Friday. Outside those hours we can deploy and do maintenance.
- **Constraint from the brief:** host on App Service or Container Apps. We compared both in `trade-offs/hosting-options.md`.
- **Forces pulling against each other:** the business wants it live quickly and cheaply (time-to-first-deploy, operability). Container Apps gives independent deploys and per-service scaling, which we don't need at this load yet but might later.
- **The design needs background work** (outbox publisher, notification dispatcher, abandoned-draft clean-up) as well as request handling.
- **What we don't yet know:** which Azure region BISTEC already uses for production workloads, and whether BISTEC has a data-residency rule for finance data. Our default is the BISTEC standard region, or Central India if there isn't one.

## Decision

- We host GreenChit as **one deployable**: an ASP.NET Core (.NET 10 LTS) application that serves the React Web App's static files, the REST API, and the background components (Outbox Publisher, Notification Dispatcher) as `BackgroundService`s.
- It runs on **Azure App Service for Linux, Premium v3 P0v3, 2 instances**, with:
  - **Always On** enabled, so background services aren't unloaded when the app goes idle;
  - a **staging deployment slot**: we deploy to staging, smoke-test it, then swap, with no downtime during business hours;
  - the App Service **health check** pointed at `/healthz`, so a broken instance is taken out of rotation;
  - a **system-assigned managed identity** for every Azure dependency (SQL, Blob, Service Bus, Key Vault). No connection-string secrets.
- With 2 instances, background work must be safe to run twice. The Outbox Publisher claims rows with `UPDLOCK, READPAST`, and the Notification Dispatcher is idempotent on `eventId`.
- We chose .NET 10 because .NET 8 support ends in November 2026, and .NET 10 is the current LTS release.
- **Revisit trigger:** we write a superseding ADR if sustained load passes 200 requests per second, if a component needs to be deployed or scaled on its own, or if background work starts measurably hurting submit p95.

## Consequences

- **Easier:** one CI/CD pipeline, one artifact and one set of logs. The team uses skills it already has, so the first deploy can happen in days rather than weeks. Same-origin hosting means the API needs no CORS. Slot swaps give zero-downtime releases.
- **Harder (uncomfortable):** **the background workers share a process with the submit endpoint.** A slow Teams webhook, a retry storm or a memory leak in the Notification Dispatcher can push submit p95 over 1.5 s or recycle the instance that's serving staff. We can't scale or restart notifications separately from the API. Mitigations: bounded concurrency on the dispatcher (`MaxConcurrentCalls = 2`), a 10 s timeout on outbound calls, and an alert on submit p95. We're accepting this risk rather than solving it.
- **Harder:** every change, even a one-line notification template fix, redeploys the whole application.
- **Harder:** running 2 instances costs about twice as much as one. A single instance would be cheaper, but it can't be patched or restarted by the platform without a business-hours outage.
- **Different:** the team won't pick up container skills on this project. If BISTEC wants that capability, it needs a separate proof of concept.

## Alternatives considered

- **Azure Container Apps, split into web/API and worker services (Option B in the trade-off table):** rejected. It wins on independent deploy and future scaling, but those attributes don't matter at under 1 request per second. It loses on our two decision-driving attributes: time-to-first-deploy (container build, registry, Bicep, networking) and operability for a 10-person team with little container experience.
- **Azure Functions for the API and workers:** rejected. Cold starts on the Consumption plan would put the 08:00 first-submit at risk for the p95 target. A Premium plan to avoid that would cost more than App Service for no benefit at this scale, and we'd have two programming models in one small codebase.
- **Azure Static Web Apps for the SPA plus App Service for the API:** considered seriously. It's cheap and well suited to SPAs. Rejected for v1 because it adds a second deployment and a cross-origin setup for little gain, since App Service already serves static files well. We can revisit it if front-end and back-end release cadences diverge.
