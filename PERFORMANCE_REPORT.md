# Performance report

Local Node.js API over the bundled real-data fixture; 30 iterations after process start. Production performance depends on PostgreSQL/Neon indexes from `migrations/001_catalog.sql`.

| Scenario | Median, ms | P95, ms | Max, ms |
|---|---:|---:|---:|
| manifest | 0 | 0.07 | 1306.66 |
| exact mnemonic | 2050.22 | 2069.91 | 2090.11 |
| text search | 2130.84 | 2154.91 | 2192.01 |
| facets | 816.37 | 827.29 | 830.63 |
| hierarchy | 82.09 | 83.4 | 83.75 |
