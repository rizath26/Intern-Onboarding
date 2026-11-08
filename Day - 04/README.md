# GreenChit — Design Pack (Day 4)

GreenChit lets BISTEC staff submit reimbursement claims with receipts, get line-manager approval in
Teams, and hand approved claims to payroll as a CSV, with a tamper-evident audit trail kept for 7 years.

## Start here

1. **`mohamed-rizath-day4-greenchit-design.md`**: context, container and component diagrams with tables, reading order, known risks and assumptions. Its *Reading order* section walks you through everything else.
2. **`diagrams/sequence-submit-approve.md`**: the submit-and-approve journey as Mermaid. Happy path plus two error paths.
3. **`adrs/`**: decisions 0001–0004.
4. **`mohamed-rizath-day4-trade-offs-and-review.md`**: hosting trade-off table, decision rationale and design-review feedback.

## Repository structure

```
├── README.md
├── mohamed-rizath-day4-greenchit-design.md         # Deliverable 1
├── mohamed-rizath-day4-trade-offs-and-review.md    # Deliverable 4
├── diagrams/
│   ├── container-diagram.png / .drawio       # C4 Level 2
│   ├── component-diagram.png / .drawio       # C4 Level 3 (Claims API)
│   ├── sequence-submit-approve.md            # Deliverable 2 (Mermaid source)
│   ├── sequence-submit-approve.png / .svg    # Happy path export
│   ├── sequence-error-upload.png / .svg      # Error path 1 export
│   ├── sequence-error-notification.png / .svg# Error path 2 export
│   └── src/*.dot                             # Graphviz source the PNGs and .drawio files are generated from
├── adrs/
│   ├── 0001-record-architecture-decisions.md
│   ├── 0002-hosting-platform.md
│   ├── 0003-database-choice.md
│   └── 0004-receipts-storage-and-virus-scan.md
└── trade-offs/
    └── hosting-options.md
```

## Editing the diagrams

- **Container and component diagrams:** open the `.drawio` files in draw.io (desktop or VS Code extension). Re-export the PNG after editing so the two don't drift apart.
- **Sequence diagrams:** edit the Mermaid blocks in `sequence-submit-approve.md`. Paste any block into https://mermaid.live to preview it, then re-export the PNG/SVG.

## Decisions at a glance

| ADR | Decision |
|-----|----------|
| 0001 | Record decisions as Nygard-style Markdown ADRs, reviewed in pull requests |
| 0002 | One ASP.NET Core (.NET 10) app on Azure App Service, Linux P0v3 × 2, staging slot |
| 0003 | Azure SQL Database; audit log in an append-only ledger table with immutable digests |
| 0004 | Direct-to-Blob resumable uploads with single-blob user-delegation SAS; Defender for Storage scanning |
