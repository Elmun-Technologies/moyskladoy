# Implementation plan and file tree

Project: **Jamshid (@ogriqqa_yechim) - Moy Sklad** - Telegram bot + site form + sales handoff + admin panel.

## Stages

1. Inspect repo (empty, branched from main).
2. Monorepo: `packages/shared`, `packages/db`, `apps/api`, `apps/bot`, `apps/worker`, `apps/admin`.
3. Data model (Prisma schema) and seed content (44 messages, Products, $800 offer kept "unconfirmed").
4. Site form endpoint + Telegram link token + demo page.
5. Bot engine: states, questions, transitions, short paths, menu/back/ask/stop.
6. Content/media/product management (draft -> preview -> approve, versioned).
7. Reminders queue (BullMQ / memory), consent and stop rules, Tashkent time window.
8. Sales triage and lead handoff (idempotent, "O'zimga olish" - claim once).
9. Admin panel (Next.js) and reports.
10. Tests (Vitest, 18 cases), fix failures.
11. Docs: README, deployment, security checklist, content checklist, needed materials.

After each stage report: what works, what is tested, what is missing - in the final report.

## File tree

```
moyskladoy/
- package.json                 # npm workspaces, common scripts
- .env.example                 # settings template (no real values)
- docker-compose.yml           # postgres, redis, api, bot, worker, admin
- tsconfig.base.json
- IMPLEMENTATION_PLAN.md       # this file
- README.md
- docs/
  - ARCHITECTURE.md
  - DEPLOYMENT.md              # deploy to server, update, rollback
  - SECURITY_CHECKLIST.md      # pre-production security checklist
  - CONTENT_CHECKLIST.md       # content/media readiness checklist
  - NEEDED_MATERIALS.md        # list of materials we need from you
- packages/
  - shared/                    # common types, DB interface, time, sanitize, test helpers
    - src/{types,database,time,sanitize,constants}.ts
    - src/testing/{memory-db,test-messenger}.ts
  - db/                        # Prisma schema, migrations, seed, Prisma implementation
    - prisma/schema.prisma
    - src/{client,prisma-db,index}.ts
    - seed/{seed.ts,content-uz.ts,products.ts,tips.ts}
- apps/
  - api/                       # Fastify: site form, webhook, admin API, demo page
  - bot/                       # grammY bot + engine (state machine)
  - worker/                    # BullMQ: reminders, outbox send, nurture
  - admin/                     # Next.js admin panel
```

## Key decisions

- **Demo mode**: if `DATABASE_URL`/`REDIS_URL` are empty - in-memory DB + in-process queues. Real Telegram adapter is NOT used in demo.
- **No payments**: nowhere in the project is there payment/card/auto-confirm. Purchase is confirmed manually by sales.
- **$800 offer**: stored as `special-800` Product, `priceType=unconfirmed`, `visibleToUsers=false` - never shown to users.
- **Tests**: never message real Telegram accounts. Dedicated test adapter (`test-messenger`) + in-memory DB.
- **Uzbek copy**: written in plain ASCII (O' and G' instead of O'/G'). All copy is seed data, editable in the admin panel.

## STATUS (2026-10-08)

Stage 1 (scaffold), packages/shared, packages/db (schema+client+prisma-db+seed),
apps/bot (engine+grammy+demo), apps/api (site form, admin API, roles, CSRF,
SSRF guard), apps/worker (reminders, outbox retry, nurture), apps/admin
(Next.js 11 pages, build OK), docs, Dockerfiles - DONE.

Tests: shared 3, bot 24, api 12, worker 8 = 47 green. Typecheck: all clean.
Not runnable in this sandbox (documented): prisma generate (network),
Playwright browsers, docker/postgres.
