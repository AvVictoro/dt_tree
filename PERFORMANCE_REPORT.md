# Performance report

Local Node.js API over the bundled real-data fixture; 30 iterations after process start. Production performance depends on PostgreSQL/Neon indexes from `migrations/001_catalog.sql`.

| Scenario | Median, ms | P95, ms | Max, ms |
|---|---:|---:|---:|
| manifest | 0 | 0.15 | 62.44 |
| exact mnemonic | 63.53 | 66.3 | 72.77 |
| text search | 65.59 | 67.82 | 71.14 |
| facets | 18.49 | 20.4 | 24.58 |
| hierarchy | 1.77 | 2.48 | 2.64 |
