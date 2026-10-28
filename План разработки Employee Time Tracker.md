# План разработки: Employee Time Tracker

Oct 28, 2026 · @nevorahq digital

> **Статус (2026-10-28):** план реализован. Актуальное состояние проекта, фактические команды и результаты проверок — в `README.md`, решения — в `docs/decisions.md`. Отличия от плана при реализации: клиентские тесты лежат в `tests/client/`, а не в `src/client/`; плагин `vite-tsconfig-paths` не понадобился (Vitest 5 разрешает пути сам); добавлены `src/server/routes.ts` (JSON 503 при недоступной БД), запрет управляющих символов в именах и описаниях и регистронезависимые UUID.

## Цели и scope

Цель — рабочий трекер времени сотрудников, где SQLite является единственным источником истины, а активный таймер переживает реальный рестарт сервера. Сдаётся код, тесты, README с разделами AI Usage и Bugs Found and Fixed. План — это фаза 1 ТЗ; реализация идёт сразу за ним.

**В scope:**

- Сотрудники: список, создание, валидация имени, нормализация пробелов.
- Таймер: start/stop по задаче, не более одного активного на сотрудника, восстановление после рестарта и перезагрузки страницы.
- История: фильтр по сотруднику и диапазону дат.
- Отчёты: per-employee и общий итог по полуоткрытому интервалу `[start, end)`, активные записи как provisional.
- Health-check с реальной проверкой БД.
- Автотесты: unit, API-интеграция, тест рестарта на файловой БД, frontend там, где есть риск.

**Вне scope:** аутентификация, роли, платежи, удаление и редактирование записей времени, мультитенантность, деплой в публичный интернет.

**Решение по дубликатам имён (ТЗ, FR-EMP-5):** имена не обязаны быть уникальными, unique index на `name` нет. Если имя повторяется, UI добавляет суффикс id (`Alice Smith · #a1b2`, первые 4 символа id) в списках и выпадающих меню; решение фиксируется в README. Удаление сотрудников не реализуем: оно опционально и создаёт риск потери истории.

## Текущее состояние репозитория

Папка `test-app` пустая и не является git-репозиторием, поэтому конфликтов с существующим кодом нет: проект создаётся с нуля. Проверено 28.10.2026 командами `ls -la`, `git status`, `node -v`, `npm view`.

| Проверка | Результат |
| --- | --- |
| Содержимое папки | Пусто |
| Git | Не инициализирован — первый шаг `git init` + `.gitignore` |
| Node.js / npm | v22.23.1 / 10.9.8 (Darwin arm64, рабочая машина, проверено 28.10.2026) |
| npm registry | Доступен |
| `node:sqlite` | Работает, но выдаёт `ExperimentalWarning` |
| Актуальные версии в npm | next 16.4.3, react 19.3.1, eslint-config-next 16.4.3, better-sqlite3 13.0.3, zod 4.6.7, vitest 5.0.5 |

**Отступление от стека, рекомендованного в ТЗ (решение от 28.10.2026):** вместо React + Vite + Express используем Next.js 16 (App Router). ТЗ допускает такую замену при обосновании; обоснование и trade-offs — в разделе «Архитектура и стек». Версии фиксируем точно (`save-exact=true` в `.npmrc`) и коммитим `package-lock.json`. Перед стартом сверяем breaking changes Next.js 16, Zod 4 и Vitest 5 по официальной документации, а не по памяти.

## Архитектура и стек

Одно Next.js-приложение (App Router) в одном Node-процессе: UI — страница с Client Components, REST API — Route Handlers в `app/api/**/route.ts`. Один dev-сервер и один origin: ни proxy, ни CORS не нужны. Route Handlers остаются тонкими, вся логика — в framework-agnostic ядре `src/server/`: handlers → services → repositories → SQLite.

&#91;embedded content: архитектура · браузер, Node-процесс, SQLite\]

Запрос идёт сверху вниз по слоям. Бизнес-правила живут в `services/`, а последняя гарантия — индексы и `CHECK` в SQLite. Браузер только отображает состояние.

| Слой | Выбор | Почему |
| --- | --- | --- |
| Фреймворк | Next.js 16, App Router, React 19, TypeScript strict | Основной стек команды; UI и API в одном проекте, файловая маршрутизация, Web `Request`/`Response` |
| API | Route Handlers, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'` | Node runtime нужен для нативного SQLite (Edge не подходит); `force-dynamic` явно исключает кэш |
| БД | SQLite через `better-sqlite3`, без ORM | Синхронные транзакции; пакет уже в списке `serverExternalPackages` Next.js, не бандлится. `node:sqlite` пока experimental |
| Валидация | Zod, схемы в `src/shared/` | Один контракт для handlers и Client Components |
| UI | Server Component-оболочка `app/page.tsx` + 4 Client Components | Интерактив (формы, тикер) только на клиенте; данные через тот же REST API |
| Стили | Обычный CSS (`globals.css`) с переменными | Минус зависимость; Tailwind — допустимая альтернатива |
| Тесты | Vitest + `@vitejs/plugin-react` + jsdom, React Testing Library; API — вызов handlers с Web `Request` | Схема из официального гайда Next.js; Supertest не нужен — handler это функция `Request → Response` |
| E2E-smoke | Скрипт над `next build && next start` | Проверяет wiring route-файлов и настоящий рестарт процесса |
| Линт | ESLint CLI + flat config `eslint-config-next/core-web-vitals` | В Next.js 16 `next lint` удалён |

Trade-offs замены: Next.js тяжелее связки Vite + Express, а сервером и его shutdown управляет `next start`, а не наш код. Кроме того, у Route Handlers нет цепочки middleware — валидацию и обработку ошибок делает обёртка `withErrors()`. Взамен — один процесс, один build и привычный тебе стек.

Для тестируемости важны три фабрики: `openDatabase(path)`, `createContainer({ db, clock })` и handler-фабрики вида `timerHandlers(container)`. Route-файл берёт процессный singleton `getContainer()`; он хранится на `globalThis`, чтобы HMR в `next dev` не плодил соединения. Тест подставляет свой container. Рестарт в тесте = `db.close()` + новые `openDatabase` и `createContainer` на том же файле.

```ts
// app/api/timer/[id]/stop/route.ts — весь route-файл, без логики
import { getContainer } from '@/server/container';
import { timerHandlers } from '@/server/handlers/timer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: RouteContext<'/api/timer/[id]/stop'>) {
  const { id } = await ctx.params;            // в Next.js 15+ params — Promise
  return timerHandlers(getContainer()).stop(req, id);
}

// src/server/container.ts
const g = globalThis as unknown as { __container?: Container };
export function getContainer(): Container {
  return (g.__container ??= createContainer({
    db: openDatabase(env.DATABASE_PATH),
    clock: systemClock,
  }));
}
```

```text
test-app/
├── app/
│   ├── layout.tsx, page.tsx, globals.css   # Server Component-оболочка
│   └── api/
│       ├── health/route.ts
│       ├── employees/route.ts
│       ├── timer/active/route.ts, timer/start/route.ts, timer/[id]/stop/route.ts
│       ├── time-entries/route.ts
│       ├── reports/summary/route.ts
│       └── [...slug]/route.ts                # JSON 404 NOT_FOUND для неизвестных /api/*
├── src/
│   ├── shared/        # Zod-схемы, типы контракта, коды ошибок
│   ├── server/        # только серверный код, не импортируется из Client Components
│   │   ├── container.ts   # createContainer, getContainer (globalThis)
│   │   ├── config.ts      # DATABASE_PATH (без NEXT_PUBLIC_ — в бандл клиента не попадает)
│   │   ├── clock.ts       # Clock { now(): number }
│   │   ├── http.ts        # withErrors(), parseJson (≤ 10 KB), parseQuery, json()
│   │   ├── handlers/      # employees, timer, timeEntries, reports, health: Request → Response
│   │   ├── db/            # openDatabase, прагмы, migrations/*.sql, migrate.ts
│   │   ├── domain/        # time.ts (overlap, elapsed), errors.ts (AppError)
│   │   ├── repositories/  # только SQL
│   │   └── services/      # timerService, reportService — бизнес-правила
│   └── client/        # 'use client': features/{employees,timer,history,reports}, lib/api-client.ts, lib/format.ts, lib/dates.ts
├── tests/             # unit/, integration/, e2e/smoke.mjs, helpers (tmp DB, FakeClock)
├── data/              # БД по умолчанию, в .gitignore
└── next.config.ts, eslint.config.mjs, vitest.config.mts, tsconfig.json, .env.example, README.md
```

## Модель данных и инварианты

Две таблицы. Время храним как `INTEGER` — миллисекунды Unix epoch UTC: это однозначно, индексируется и напрямую участвует в расчёте пересечений. В API отдаём ISO 8601 с `Z`. ID — UUID v4 через `crypto.randomUUID()`.

```sql
-- migrations/001_init.sql (применяется в транзакции, версия в PRAGMA user_version)
CREATE TABLE employees (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL
              CHECK (length(name) BETWEEN 1 AND 100 AND name = trim(name)),
  created_at  INTEGER NOT NULL
) STRICT;

CREATE TABLE time_entries (
  id           TEXT    PRIMARY KEY,
  employee_id  TEXT    NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  description  TEXT    NOT NULL
               CHECK (length(description) BETWEEN 1 AND 500 AND description = trim(description)),
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  created_at   INTEGER NOT NULL,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
) STRICT;

-- инвариант «один активный таймер на сотрудника» на уровне БД
CREATE UNIQUE INDEX ux_time_entries_one_active
  ON time_entries(employee_id) WHERE ended_at IS NULL;
-- история/отчёты по сотруднику и по всем
CREATE INDEX ix_time_entries_employee_started ON time_entries(employee_id, started_at);
CREATE INDEX ix_time_entries_started ON time_entries(started_at);
```

Прагмы на каждом соединении: `foreign_keys = ON` (в SQLite по умолчанию выключено), `journal_mode = WAL`, `busy_timeout = 5000`. `synchronous` задаём явно `FULL`: на нашем объёме цена незаметна, а закоммиченный start не пропадёт при потере питания. Мигратор создаёт папку БД, применяет только неприменённые файлы и никогда не делает `DROP`.

| Инвариант | Где гарантируется |
| --- | --- |
| Не более одного активного таймера на сотрудника | Partial unique index; `SQLITE_CONSTRAINT_UNIQUE` → `409 TIMER_ALREADY_RUNNING` |
| Разные сотрудники — параллельно | Индекс по `employee_id`, а не глобальный |
| Активный: `ended_at IS NULL`; завершённый: `ended_at >= started_at` | `CHECK` в таблице |
| Атомарный start при конкурентных запросах | `db.transaction(...).immediate()`: проверка сотрудника + `INSERT`; индекс — последняя линия защиты |
| Stop без дубликатов | `UPDATE … SET ended_at = max(?, started_at) WHERE id = ? AND ended_at IS NULL RETURNING *` — compare-and-set на той же строке; `max` держит `CHECK` при откате часов |
| Shutdown не останавливает таймеры | Ни один shutdown-хук не трогает `time_entries`; процессом управляет `next start`, а закоммиченные транзакции уже на диске (`synchronous = FULL`) |
| Восстановление с исходными `id` и `started_at` | Состояние только в БД; `GET /api/timer/active` читает строки с `ended_at IS NULL` |
| Клиентский интервал не определяет длительность | UI считает `Date.now() - startedAt` на каждом тике; сервер длительность от клиента не принимает |
| История не теряется | `ON DELETE RESTRICT`, нет DELETE-эндпоинтов |

Пример start в сервисе (код ошибки `SqliteError.code` проверяем тестом, а не доверяем памяти):

```ts
export function createTimerService(db: Database, repo: TimeEntryRepo, clock: Clock) {
  const startTx = db.transaction((employeeId: string, description: string): TimeEntry => {
    if (!repo.employeeExists(employeeId)) throw new AppError(404, 'EMPLOYEE_NOT_FOUND');
    const now = clock.now();
    try {
      return repo.insertActive({ id: randomUUID(), employeeId, description, startedAt: now, createdAt: now });
    } catch (err) {
      if (isSqliteError(err, 'SQLITE_CONSTRAINT_UNIQUE')) throw new AppError(409, 'TIMER_ALREADY_RUNNING');
      throw err;
    }
  });
  return { start: (employeeId: string, description: string) => startTx.immediate(employeeId, description) };
}
```

## API-контракт

У всех ответов один конверт: успех — `{ "data": … }`, ошибка — `{ "error": { "code", "message", "details"? } }`. Время в ответах — ISO 8601 UTC. Даты в query (`from`, `to`) — ISO 8601 instant со смещением (`Z` или `+02:00`); дату без времени отклоняем как неоднозначную.

| Эндпоинт | Вход | Успех | Ошибки |
| --- | --- | --- | --- |
| `GET /api/health` | — | `200 { status: "ok", database: "ok" }` | `503 DATABASE_UNAVAILABLE` (если `SELECT 1` падает) |
| `GET /api/employees` | — | `200 Employee[]`, сортировка по имени | — |
| `POST /api/employees` | `{ name }` | `201 Employee` | `400 VALIDATION_ERROR` |
| `GET /api/timer/active` | `?employeeId` | `200 { timers: TimeEntry[], serverTime }` | `400 VALIDATION_ERROR` |
| `POST /api/timer/start` | `{ employeeId, description }` | `201 TimeEntry` | `400`, `404 EMPLOYEE_NOT_FOUND`, `409 TIMER_ALREADY_RUNNING` |
| `POST /api/timer/:id/stop` | — | `200 TimeEntry` | `400` (не UUID), `404 TIMER_NOT_FOUND`, `409 TIMER_ALREADY_STOPPED` |
| `GET /api/time-entries` | `?employeeId&from&to&limit&offset` | `200 { entries, total }`, новые сверху | `400 VALIDATION_ERROR`, `400 INVALID_DATE_RANGE` |
| `GET /api/reports/summary` | `?from&to` (обяз.), `?employeeId` | `200 Report` | `400 VALIDATION_ERROR`, `400 INVALID_DATE_RANGE` |

Дополнительные правила:

- `serverTime` в `/timer/active` нужен клиенту, чтобы поправить расхождение часов браузера и сервера: `offset = serverTime - clientNowAtResponse`.
- `limit` — по умолчанию 100, максимум 500. Фильтр истории и отчёта один: запись попадает, если пересекает `[from, to)`.
- `INVALID_DATE_RANGE` — при `from >= to` или диапазоне длиннее 366 дней (ограничивает payload).
- Битый JSON → `400 INVALID_JSON`, тело больше 10 KB → `413 PAYLOAD_TOO_LARGE`. Оба проверяет наш `parseJson`, не полагаясь на настройки фреймворка. Неизвестный `/api/*` → `404 NOT_FOUND` из catch-all `app/api/[...slug]/route.ts`. Любая непредвиденная ошибка → `500 INTERNAL_ERROR` из `withErrors()`, без stack trace и SQL; полная ошибка — только в лог сервера.
- Валидация строк: `trim()`, затем длина 1–100 для имени и 1–500 для описания — те же границы, что и в `CHECK`.
- Каждый route-файл объявляет `runtime = 'nodejs'` и `dynamic = 'force-dynamic'`. Без этого нет гарантии от статического кэша и Edge-рантайма, а ответы с активными таймерами нельзя кэшировать.

Форма отчёта:

```ts
type Report = {
  period: { from: string; to: string };          // как пришло, в UTC
  evaluatedAt: string;                            // верхняя граница для активных
  totals: { finalizedMs: number; provisionalMs: number; totalMs: number };
  employees: Array<{ employeeId: string; name: string; entryCount: number;
                     finalizedMs: number; provisionalMs: number; totalMs: number }>;
  entries: Array<TimeEntry & { contributionMs: number; isActive: boolean }>;
};
```

## Расчёт времени и отчёты

Вклад записи в период считает одна чистая функция `overlapMs` в `domain/time.ts` в целых миллисекундах. Округление делается только в UI, в `formatDuration`. SQL выбирает кандидатов, а сервис агрегирует — так у правила одна реализация, покрытая unit-тестами.

```latex
\text{contribution} = \max\bigl(0,\ \min(\text{end}_e, \text{to}) - \max(\text{start}_e, \text{from})\bigr), \quad \text{end}_e = \begin{cases} \text{endedAt} & \text{завершена} \\ \text{evaluatedAt} & \text{активна} \end{cases}
```

```ts
// domain/time.ts
export const overlapMs = (start: number, end: number, from: number, to: number): number =>
  Math.max(0, Math.min(end, to) - Math.max(start, from));

// reportService.ts — evaluatedAt фиксируется один раз на запрос
const evaluatedAt = clock.now();
const rows = repo.findOverlapping({ from, to, evaluatedAt, employeeId });
const entries = rows.map((r) => ({
  ...r,
  isActive: r.endedAt === null,
  contributionMs: overlapMs(r.startedAt, r.endedAt ?? evaluatedAt, from, to),
}));
```

```sql
-- repositories/timeEntries.ts: findOverlapping
SELECT t.*, e.name AS employee_name
FROM time_entries t JOIN employees e ON e.id = t.employee_id
WHERE t.started_at < :to
  AND COALESCE(t.ended_at, :evaluatedAt) > :from
  AND (:employeeId IS NULL OR t.employee_id = :employeeId)
ORDER BY t.started_at DESC, t.id;
```

Правила семантики (пойдут в README):

- **Интервал** — полуоткрытый `[from, to)`. Запись, закончившаяся ровно в `from`, или начавшаяся ровно в `to`, вклада не даёт.
- **Часовой пояс отчёта** — часовой пояс браузера. Клиент переводит выбранные даты в instants: `from = new Date(y, m - 1, d)`, `to = new Date(y2, m2 - 1, d2 + 1)`, то есть конечная дата включительно. Имя пояса из `Intl.DateTimeFormat().resolvedOptions().timeZone` показываем рядом с фильтром. Локальная полночь корректно даёт сутки по 23 и 25 ч при переходе на летнее/зимнее время.
- **Сервер не знает о часовых поясах** — он получает только однозначные instants. Это убирает целый класс багов с `new Date('2026-10-01')`, которая парсится как UTC.
- **Активные записи** считаются до `evaluatedAt`, помечаются `isActive: true`, их время идёт в `provisionalMs`, `endedAt` остаётся `null`. В UI — бейдж «In progress» и пометка «as of HH:MM».
- **Без двойного учёта**: каждая строка даёт ровно один вклад. Инварианты, которые проверяем тестом: `totals.totalMs = Σ employees.totalMs = Σ entries.contributionMs` и `totalMs = finalizedMs + provisionalMs`.
- **Длительность активного таймера в UI** = `Date.now() + serverOffset - startedAt`, пересчёт раз в секунду. После перезагрузки страницы или рестарта сервера значение верное сразу, включая время простоя.

## Этапы разработки

Шесть этапов, каждый строится на предыдущем. Каждый закрывается gate — командами, которые реально запущены и прошли, после чего идёт коммит. Backend делается и тестируется до UI: все критичные инварианты живут на сервере.

&#91;embedded content: этапы · 6 вех и их gate\]

Идём последовательно: сначала M3, потому что рестарт — самый рискованный критерий приёмки. M4 зависит только от контракта M2, так что порядок можно поменять.

**M0 — Каркас.** Gate: `npm run typecheck && npm run lint && npm test && npm run build` зелёные на пустой странице.

- [ ] `git init`, `.gitignore` (`node_modules`, `.next`, `data/`, `*.db*`, `.env*` кроме `.env.example`), `.npmrc` с `save-exact=true` и `engine-strict=true`, `.nvmrc`, `engines.node >=22` в `package.json`
- [ ] Ручной setup без шаблона: `next react react-dom better-sqlite3 zod`; dev — `typescript @types/node @types/react @types/react-dom @types/better-sqlite3 eslint eslint-config-next vitest @vitejs/plugin-react vite-tsconfig-paths jsdom @testing-library/react @testing-library/dom`
- [ ] Скрипты: `dev` = `next dev -H 127.0.0.1`, `build` = `next build`, `start` = `next start -H 127.0.0.1`, `typecheck` = `next typegen && tsc --noEmit`, `lint` = `eslint .`, `test` = `vitest run` (c `TZ=Europe/Chisinau`) + `check-scenarios`, `test:e2e`, `seed` (SHOULD)
- [ ] `tsconfig.json` с `strict`, `noUncheckedIndexedAccess`, alias `@/*` → `src/*`; `next.config.ts`, `eslint.config.mjs`, `vitest.config.mts`, `.env.example`
- [ ] Проверка риска № 1: `better-sqlite3` ставится, а `next build` с route-файлом, импортирующим его, проходит

**M1 — Домен и БД.** Gate: unit-тесты `overlapMs` и тесты ограничений БД зелёные.

- [ ] `Clock` + `FakeClock`, `overlapMs`, `AppError` и каталог кодов ошибок
- [ ] `openDatabase(path)`: `mkdir -p`, прагмы, миграции по `user_version`
- [ ] Репозитории employees / timeEntries, только prepared statements
- [ ] Тесты: прямая вставка второй активной записи падает на индексе; повторный `openDatabase` не трогает данные

**M2 — REST API на Route Handlers.** Gate: handler-тесты S1–S11 и S22–S32 зелёные (S12 — в M3, ему нужны воркеры).

- [ ] `createContainer`, `getContainer` (singleton на `globalThis`), `http.ts`: `withErrors`, `parseJson`, `parseQuery`
- [ ] Handler-фабрики: health, employees, timer (start/stop/active), time-entries, reports/summary
- [ ] Тонкие route-файлы в `app/api/**` + catch-all `[...slug]` для JSON-404
- [ ] Маппинг `SQLITE_CONSTRAINT_*` → бизнес-коды с кодом 409; `SQLITE_BUSY`/`SQLITE_LOCKED` → `503 DB_BUSY` с `Retry-After: 1`
- [ ] Стоп: `SET ended_at = max(?, started_at)` и warning в лог при откате часов; логи без тел запросов

**M3 — Рестарт и конкурентность.** Gate: restart-тест (S13–S21), S12 и конкурентные тесты на `worker_threads`, process-level smoke с `kill -9` зелёные на реальном файле БД; разово проведена мутационная проверка.

- [ ] Restart-тест: старт → `db.close()` → новые `openDatabase` + `createContainer` → сдвиг `FakeClock` → проверка `id`/`startedAt`/elapsed → stop → ровно 1 строка
- [ ] S12: воркеры `worker_threads`, у каждого своё соединение к одному файлу, параллельные start одного сотрудника → ровно один `201`, остальные `409`, ни одного 5xx, одна активная строка
- [ ] Параллельные stop одного таймера → один `200`, остальные `409 TIMER_ALREADY_STOPPED`; start разных сотрудников под нагрузкой → все успешны
- [ ] Мутационная проверка (ручная, один раз): временно убрать partial unique index — S7 и S12 должны упасть; результат — в Bugs Found / README
- [ ] `tests/e2e/smoke.mjs`: `next start` на временном `DATABASE_PATH` → сотрудник + start → `kill -9` → повторный `next start` → тот же `id` и `startedAt` → stop → одна строка. Это настоящий рестарт процесса и проверка wiring route-файлов

**M4 — Frontend.** Gate: RTL-тесты зелёные, ручная проверка на ширинах 375 px и 1280 px.

- [ ] `app/layout.tsx` + `app/page.tsx` (Server Component-оболочка), 4 секции — Client Components (`'use client'`)
- [ ] `lib/api-client.ts`: типизированный fetch (`cache: 'no-store'`), `ApiError` с `code`, схемы из `shared/`
- [ ] Employees: список (имя, дата создания в локальной зоне), форма, inline-ошибки, toast об успехе; суффикс id при совпадении имён — в списке и в выпадающих меню
- [ ] Active Timer: выбор сотрудника, описание, start/stop, предупреждение «already running», тикающие часы, восстановление при загрузке
- [ ] History: фильтры по сотруднику и датам, показ текущих фильтров, empty state
- [ ] Reports: период + сотрудник / All, итоги по сотрудникам и общий, выделение provisional
- [ ] Кнопки неактивны во время запроса; после мутации — refetch таймеров и истории; `label`, видимый `:focus-visible`, `aria-live` для сообщений

**M5 — Hardening и документация.** Gate: чеклист Definition of Done ниже.

- [ ] `npm run build && npm start` на чистой БД, ручной прогон всех 4 секций в браузере, перезагрузка страницы с активным таймером
- [ ] AI code review по промпту из ТЗ, каждую находку проверяем регрессионным тестом до записи в Bugs Found and Fixed
- [ ] README: все 18 пунктов ТЗ + обоснование выбора Next.js, решение о неуникальных именах, предупреждение «не для публичного доступа»; команды сверены с `package.json`
- [ ] AI Usage — только фактически использованное; Bugs Found and Fixed — только подтверждённые падающим тестом
- [ ] `docs/decisions.md` (ADR: Next.js, better-sqlite3 без ORM, неуникальные имена, epoch-ms, откат часов, `503 DB_BUSY`)
- [ ] SHOULD, если укладывается: `npm run seed`, GitHub Actions (`npm ci`, typecheck, lint, test, build, test:e2e), `EXPLAIN QUERY PLAN`
- [ ] Финальный отчёт (ТЗ 13.3): реализовано / протестировано / не проверено, только с фактическим выводом команд

## Стратегия тестирования

Все 32 сценария из ТЗ раскладываем по файлам. API тестируем вызовом handler-фабрик с настоящим Web `Request`: это тот же код, что вызывает route-файл, только без запуска Next. Wiring самих route-файлов и реальный рестарт процесса проверяет smoke-скрипт над `next start`. Каждый тест получает свой файл БД в `os.tmpdir()` и `FakeClock`. `:memory:` не используем, а `DATABASE_PATH` тесты не читают — случайно попасть в рабочую БД невозможно.

| Файл | Уровень | Сценарии ТЗ |
| --- | --- | --- |
| `unit/time.test.ts` | unit | 26–29, 31 на уровне `overlapMs`: границы, нулевая длина, запись целиком вне периода |
| `unit/schemas.test.ts` | unit | 2, 11: пустые и whitespace-строки, trim, длины, даты без смещения |
| `integration/db.test.ts` | DB | partial unique index, `CHECK`, FK, идемпотентность миграций |
| `integration/employees.test.ts` | handler | S1–S4; одинаковые имена допускаются |
| `integration/timer.test.ts` | handler | S5–S11, откат часов (`FakeClock`) |
| `integration/concurrency.test.ts` | `worker_threads`, отдельные соединения | S12; параллельные stop; разные сотрудники под нагрузкой. `Promise.all` в одном процессе не используем |
| `unit/dst.test.ts` | unit, `TZ=Europe/Chisinau` | сутки 2026-03-29 — 23 ч, 2026-10-25 — 25 ч; дата без смещения → `400` |
| `integration/restart.test.ts` | handler + файл БД | 13–21 |
| `integration/reports.test.ts` | handler | 22–32 + фильтры `time-entries` |
| `integration/health.test.ts` | handler | `200` на живой БД, `503` после `db.close()` |
| `e2e/smoke.mjs` | процесс `next start` | все маршруты отвечают JSON; жёсткий рестарт (`kill -9`) с активным таймером |

Имена тестов начинаются с ID сценария (`[S7]`, `[S13-S21]`); `scripts/check-scenarios.mjs` падает, если ID не хватает. Тесты запускаются с `TZ=Europe/Chisinau`.
| `tests/client/*.test.tsx` | RTL + jsdom | валидация форм, disabled во время запроса, восстановление таймера, пустой отчёт, конвертация локальных дат |

Vitest не поддерживает async Server Components (так сказано в гайде Next.js), поэтому оболочка `page.tsx` держится синхронной и без данных, а вся логика UI — в Client Components.

Скелет restart-теста — самого важного критерия приёмки:

```ts
const req = (method: string, path: string, body?: unknown) =>
  new Request(`http://test${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

it('active timer survives a genuine restart', async () => {
  const file = tmpDbPath();
  const clock = new FakeClock(Date.parse('2026-10-28T09:00:00Z'));

  let db = openDatabase(file);
  let c = createContainer({ db, clock });
  const emp = (await (await employeeHandlers(c).create(
    req('POST', '/api/employees', { name: 'Ada Example' }))).json()).data;
  const started = (await (await timerHandlers(c).start(
    req('POST', '/api/timer/start', { employeeId: emp.id, description: 'Write report' }))).json()).data;
  db.close();                                    // «процесс умер»

  clock.advance(90 * 60_000);                    // сервер лежал 90 минут
  db = openDatabase(file);
  c = createContainer({ db, clock });

  const { timers, serverTime } = (await (await timerHandlers(c).active(
    req('GET', '/api/timer/active'))).json()).data;
  expect(timers).toHaveLength(1);
  expect(timers[0]).toMatchObject({ id: started.id, startedAt: started.startedAt, endedAt: null });
  expect(Date.parse(serverTime) - Date.parse(timers[0].startedAt)).toBe(90 * 60_000);

  const res = await timerHandlers(c).stop(req('POST', `/api/timer/${started.id}/stop`), started.id);
  expect(res.status).toBe(200);
  const rows = db.prepare('SELECT * FROM time_entries').all();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: started.id, ended_at: clock.now() });
  db.close();
});
```

Правило: найденный баг сначала воспроизводится падающим тестом, потом чинится. В `Bugs Found and Fixed` попадает только то, что так и прошло.

## Риски, открытые вопросы и Definition of Done

Главный технический риск — сборка нативного `better-sqlite3`, поэтому он проверяется первым же `npm install` в M0. Остальные риски закрываются дизайном или честно документируются как ограничения.

| Риск | Сценарий сбоя | Решение |
| --- | --- | --- |
| Нативный модуль не собирается | Нет prebuild под Node 22 / arm64 или нет toolchain | Проверка в M0 вместе с `next build`; fallback — `node:sqlite` за тем же интерфейсом репозитория, с пометкой experimental |
| HMR в `next dev` | Переисполнение модуля открывает новое соединение на каждое сохранение файла | `getContainer()` хранит единственный экземпляр на `globalThis` |
| Кэширование Next.js | GET отдаёт устаревший список активных таймеров | `dynamic = 'force-dynamic'` в каждом route-файле, `cache: 'no-store'` в api-client; проверяет smoke-тест |
| Серверный код в клиентском бандле | Client Component импортирует `@/server/*` → SQLite тянется в браузер, build падает | ESLint `no-restricted-imports` для `src/client/**` и `app/**/*.tsx`; клиенту доступен только `@/shared/*` |
| Системные часы ушли назад | NTP-коррекция между start и stop → `ended_at < started_at`, `CHECK` падает | `ended_at = max(now, started_at)` + warning в лог; поведение покрыто тестом |
| Два процесса на одном файле | Гонка start между инстансами | `BEGIN IMMEDIATE` + `busy_timeout` + partial index; в README — поддерживается один инстанс |
| Двойной клик / повтор запроса | Два start или два stop подряд | UI: disabled + in-flight guard; сервер: индекс и compare-and-set дают детерминированный `409` |
| Забытый таймер | Таймер идёт несколько дней и раздувает provisional | Авто-стоп запрещён инвариантами; в UI — предупреждение для таймеров старше 12 ч, ручная коррекция — future work |
| Дубликаты имён | Два «Alice Smith» неразличимы в списках и меню | Суффикс id в UI (FR-EMP-5), решение в README |
| `SQLITE_BUSY` / `SQLITE_LOCKED` | Блокировка не снялась за `busy_timeout` и превращается в 500 | Маппинг в `503 DB_BUSY` с `Retry-After: 1` (BR-10) |
| Нет аутентификации | Любой из сети меняет данные | `next dev/start -H 127.0.0.1` по умолчанию, в README — не для публичного деплоя |
| Новые major-версии | Next.js 16: `params` — Promise, `next lint` удалён; API Zod 4 / Vitest 5 отличается от привычного | Сверяем с официальной документацией; `next typegen && tsc --noEmit` ловит расхождения типов |

**Открытые вопросы** (дефолты уже выбраны, работу не блокируют):

Закрыто 28.10.2026: имена не уникальны (по ТЗ); Next.js оставляем; git-история разрешена, коммит после каждого gate. По умолчанию: обычный CSS, часовой пояс отчётов = пояс браузера (ТЗ, решение №4).

Остаётся на стороне заказчика: согласована ли смена стека на Next.js с проверяющим (ТЗ 14.2 №1).

**Definition of Done** (из ТЗ, отмечаем только по факту запущенных проверок):

- [ ] Сотрудники создаются и отображаются списком
- [ ] Start/stop таймера по задаче; не более одного активного на сотрудника, параллельно у разных
- [ ] Данные в реальном SQLite-файле; активный таймер переживает рестарт с исходным `startedAt`
- [ ] История фильтруется по сотруднику и датам
- [ ] Отчёты: итоги по сотрудникам и общий, корректные границы, пустой отчёт без ошибок
- [ ] Автотесты покрывают все 32 сценария и проходят
- [ ] `npm run typecheck`, `npm run lint`, `npm run build` проходят
- [ ] Приложение запускается по README с чистого checkout
- [ ] README описывает реальное использование AI и проверенные фиксы
- [ ] Нет реальных персональных данных и секретов; ограничения задокументированы
