# Orbis migration DRY-RUN — 2026-05-09

Shop: wellington    Type: leads    File: Clean Car Collective Leads May 10th 2026.xlsx

| Metric | Count |
|---|---:|
| Rows read | 3579 |
| Filtered as junk | 11 |
| Already imported (idempotent skip) | 0 |
| Contacts created | 3566 |
| Contacts reused (dedup match) | 2 |
| Vehicles created | 2913 |
| Leads created | 3568 |
| Errors | 0 |

## Junk filter breakdown

- **1** — internal cleancarcollective.co.nz email
- **6** — no contact info & no name
- **1** — developer test account
- **3** — junk name "test"
