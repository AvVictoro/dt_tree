# Статус полноразмерного каталога

- Контрольный объём: **1 606 756 индикаторов**.
- Доступно в переносимом файловом режиме: **3 000 индикаторов**.
- Статус файловой проверки: **PASS_DEMO**.
- `fullDataReady`: **false**.
- Полноразмерная активная версия PostgreSQL/Neon: **не создана**.

Причина: в окружении проекта отсутствует `DATABASE_URL`. Без адреса целевой PostgreSQL/Neon невозможно выполнить миграцию, потоково импортировать 1 606 756 строк, сверить контрольные объёмы в самой БД и атомарно активировать версию. Код импорта и схема готовы; неподтверждённая полнота не объявляется.

После предоставления `DATABASE_URL` требуется выполнить:

```bash
python3 scripts/catalog/import_full.py \
  --taxonomy /Users/victorgrishin/Downloads/02_indicator_taxonomy_assignment_final.zip \
  --blocks /Users/victorgrishin/Downloads/03_data_blocks_and_assignments_final.zip \
  --taxonomy3 /Users/victorgrishin/Downloads/05_taxonomy_3_levels_assignment_final.zip
```

Импортёр оставляет версию в `loading` до прохождения всех контрольных сумм и переводит её в `active` только в одной транзакции. В database-режиме `/api/catalog/manifest` выставит `fullDataReady=true` только при равенстве `queryableIndicators === controlIndicators`.
