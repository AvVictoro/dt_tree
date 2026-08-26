# Performance report

Local Node.js API over the bundled real-data fixture; 30 iterations after process start. Production performance depends on PostgreSQL/Neon indexes from `migrations/001_catalog.sql`.

| Scenario | Median, ms | P95, ms | Max, ms |
|---|---:|---:|---:|
| manifest | 0 | 0.06 | 911.42 |
| exact mnemonic | 1336.98 | 1345.22 | 1346.15 |
| text search | 1384.57 | 1393.35 | 1437.21 |
| facets | 555.73 | 567.43 | 568.47 |
| hierarchy | 55.2 | 56.36 | 58.18 |
