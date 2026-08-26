# DataTracker — варианты каталога

Отдельный проект `AvVictoro/dt_tree` для сравнения четырёх вариантов поиска и навигации по каталогу индикаторов. Исходный `AvVictoro/DTTTT` и его production-развёртывание не изменяются.

## Что реализовано

- ровно пять основных разделов: «Дом», «Каталог», «Каталог 1», «Каталог 2», «Каталог 3»;
- исходный «Каталог» сохранён без изменений и работает независимо от экспериментального модуля;
- единый API, модель карточки, поиск, фасеты и URL-состояние для трёх новых вариантов;
- последовательная иерархия «блок → топик → тема → сабтема → сабтема 2» по одному уровню на экран;
- переход к обязательным фильтрам и выдаче после выбора «Сабтемы 2»;
- одновременные таксономические и атрибутивные фасеты в «Каталоге 2»;
- OR внутри одного измерения и AND между измерениями;
- защита от массовой выдачи при выборе только блока в «Каталоге 2»;
- прямой поиск с задержкой 200 мс, отменой устаревшего запроса, восемью подсказками и управлением клавиатурой;
- карточка ряда без искусственного графика, если наблюдений нет;
- потоковый импорт полного набора 1 606 756 индикаторов в PostgreSQL/Neon;
- автономный максимально расширенный набор из 28 355 реальных индикаторов: до 2 000 первичных рядов на каждый блок, а для меньших блоков — все доступные.

Проект не загружает и не парсит данные из интернета. Локальный режим читает только файл `catalog/demo/catalog-demo.json`, собранный из приложенных ZIP-архивов.

## Локальный запуск

Требуется Node.js 20 или новее. У проекта нет обязательных npm-зависимостей.

```bash
npm run dev
```

Откройте [http://127.0.0.1:4173/](http://127.0.0.1:4173/).

## Проверки

```bash
npm test
npm run validate:catalog
npm run benchmark:catalog
```

Результаты находятся в `reports/catalog-validation.json`, `reports/catalog-validation.md` и `PERFORMANCE_REPORT.md`.

## Пересборка автономного набора

Команда ниже использует только локальные архивы. Значение `--per-block 2000` даёт максимально широкий проверенный файловый набор из 28 355 строк. Его размер — около 89 МБ, что остаётся ниже ограничения GitHub на отдельный файл и сохраняет работоспособность локального API.

```bash
python3 scripts/catalog/build_demo.py \
  --taxonomy /path/to/02_indicator_taxonomy_assignment_final.zip \
  --blocks /path/to/03_data_blocks_and_assignments_final.zip \
  --taxonomy3 /path/to/05_taxonomy_3_levels_assignment_final.zip \
  --output catalog/demo/catalog-demo.json \
  --per-block 2000
```

## Полный импорт 1 606 756 индикаторов

1. Создайте PostgreSQL 15+ или Neon и скопируйте `.env.example` в `.env`.
2. Установите единственную зависимость импортёра:

```bash
python3 -m pip install 'psycopg[binary]'
```

3. Запустите импорт:

```bash
python3 scripts/catalog/import_full.py \
  --taxonomy /path/to/02_indicator_taxonomy_assignment_final.zip \
  --blocks /path/to/03_data_blocks_and_assignments_final.zip \
  --taxonomy3 /path/to/05_taxonomy_3_levels_assignment_final.zip
```

Импорт идёт пакетами по 10 000 строк, хранит checkpoints, проверяет контрольные объёмы и только после успешной проверки атомарно делает новую версию активной. Предыдущая активная версия переводится в архивную в той же транзакции. До подключения `DATABASE_URL` API сообщает `mode=demo`, `queryableIndicators=28355` и `fullDataReady=false`; состояние `fullDataReady=true` возможно только для активной БД с контрольными 1 606 756 строками.

Предлагаемые реальные сценарии для быстрых действий «Каталога 3» находятся в [CATALOG3_SEARCH_SCENARIOS_PROPOSAL.md](CATALOG3_SEARCH_SCENARIOS_PROPOSAL.md). Их кнопки намеренно не добавлены до выбора заказчика.

## API

- `GET /api/catalog/manifest`
- `GET /api/catalog/blocks`
- `GET /api/catalog/hierarchy`
- `GET /api/catalog/facets`
- `GET /api/catalog/indicators`
- `GET /api/catalog/search`
- `GET /api/catalog/suggest`
- `GET /api/catalog/indicators/:seriesId`

Пагинация cursor-based, размер страницы по умолчанию 50, максимум 100.

## Vercel

`vercel.json` и catch-all-функция `api/catalog/[...route].mjs` готовы к созданию отдельного Preview/Production-проекта для репозитория `dt_tree`. Это развёртывание не связано с текущим production `DTTTT`.
