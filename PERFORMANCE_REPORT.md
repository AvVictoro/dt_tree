# Performance report

Local Node.js API over the bundled real-data fixture; 30 iterations after process start. Production performance depends on PostgreSQL/Neon indexes from `migrations/001_catalog.sql`.

| Scenario | Median, ms | P95, ms | Max, ms |
|---|---:|---:|---:|
| manifest | 0 | 0.06 | 306.48 |
| exact mnemonic | 302.28 | 306.64 | 314.27 |
| text search | 313.43 | 315.79 | 317.51 |
| facets | 85.54 | 93.91 | 103.74 |
| hierarchy | 8.53 | 10.36 | 10.57 |
