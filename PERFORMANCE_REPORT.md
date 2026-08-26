# Performance report

Local Node.js API over the bundled real-data fixture; 30 iterations after process start. Production performance depends on PostgreSQL/Neon indexes from `migrations/001_catalog.sql`.

| Scenario | Median, ms | P95, ms | Max, ms |
|---|---:|---:|---:|
| manifest | 0 | 0.06 | 560.8 |
| exact mnemonic | 583.35 | 589.38 | 592.02 |
| text search | 603.93 | 637.53 | 677.77 |
| facets | 264.61 | 288.77 | 297.44 |
| hierarchy | 25.73 | 26.04 | 26.91 |
