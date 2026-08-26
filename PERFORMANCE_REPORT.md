# Performance report

Local Node.js API over the bundled real-data fixture; 30 iterations after process start. Production performance depends on PostgreSQL/Neon indexes from `migrations/001_catalog.sql` and `migrations/002_catalog_grouping.sql`.

| Scenario | Median, ms | P95, ms | Max, ms |
|---|---:|---:|---:|
| manifest | 0 | 0.07 | 1432.6 |
| exact mnemonic | 0.02 | 0.19 | 0.4 |
| text search | 2102.16 | 2317.98 | 2359.37 |
| facets | 830.3 | 839.15 | 868.05 |
| hierarchy | 82.15 | 84 | 85.89 |
| grouped exact member | 139.79 | 158.25 | 203.93 |
