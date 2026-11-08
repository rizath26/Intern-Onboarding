# BookSwap — Backend Design (Day 2)

BookSwap lets neighbours in a Colombo apartment building list, search and borrow
each other's books. This repository is the design only: REST API contract, storage
and cache decisions, a C4 Level 2 container diagram, and a mock smoke-test report.

## How to read the container diagram

![Container diagram](diagrams/container-diagram.png)

1. Start at the **Member** (top left): they only ever touch the **Mobile app**, which signs them in with **Microsoft Entra External ID** and then calls the **API service** with that JWT over HTTPS.
2. **Solid blue arrows are synchronous** calls that wait for an answer, and **dashed orange arrows are asynchronous** messages that nobody waits for; the legend at the top repeats this.
3. Inside the dashed **BookSwap system** boundary, the API service keeps all business data in **Azure SQL** (the system of record), serves the busy home-screen catalogue from the **Redis cache**, and hands out short-lived SAS URLs so the app uploads photos straight to **Blob Storage**.
4. Anything involving email leaves the API as a message on the **Service Bus queue**, so a slow or broken email provider can never block listing a book or requesting a loan.
5. The **Background worker** takes those messages (and runs the Monday digest timer), reads what it needs from SQL, and sends email through **Azure Communication Services**, which delivers it to the member's inbox.

## Repository map

```text
bookswap-design/
├── diagrams/
│   ├── container-diagram.png      # exported image (A5-readable)
│   └── container-diagram.drawio   # editable source (open at app.diagrams.net)
├── openapi/
│   └── bookswap-openapi.yaml      # OpenAPI 3.1 contract, 16 operations
├── decisions/
│   └── storage-decisions.md       # storage, cache and queue decision memo
├── reports/
│   ├── mock-report.md             # smoke-test results and findings
│   ├── smoke-test.sh              # re-runs the 5 required tests
│   └── bookswap-smoke.postman_collection.json
└── README.md
```

## Check it yourself

```bash
# 1. Spec is valid
npx @apidevtools/swagger-cli@4.0.4 validate openapi/bookswap-openapi.yaml

# 2. Start the mock (terminal 1)
npx @stoplight/prism-cli@5.14.2 mock openapi/bookswap-openapi.yaml --port 4010

# 3. Run the smoke tests (terminal 2) — expect "5/5 passing"
bash reports/smoke-test.sh
```

## Key decisions at a glance

| Question | Answer | Where it is argued |
|---|---|---|
| Where does business data live? | One Azure SQL database | `decisions/storage-decisions.md` §2 |
| Where do photos live? | Blob Storage, uploaded directly by the app | §2 and `POST /books/{bookId}/photo-uploads` |
| What is cached? | First catalogue pages per building and book detail, 60 s / 300 s TTL | §3 |
| What is never cached? | Free-text search, availability during accept, member private data | §3 |
| What goes on a queue? | All email: event emails and the weekly digest | §4 |
| How do in-app notifications meet 2 s? | Written in the same SQL transaction; app polls every 2 s | §2 |
