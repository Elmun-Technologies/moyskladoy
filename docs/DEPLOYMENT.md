# Deploy / rollback / backup

## Birinchi deploy (VPS yoki PaaS, Docker Compose)

1. `git clone` va release tagga o'tish: `git checkout v<versiya>`.
2. `.env` faylni to'ldiring (barcha kalitlar `.env.example`da).
   Kamida: `TELEGRAM_BOT_TOKEN`, `BOT_USERNAME`, `PUBLIC_URL`, `SESSION_SECRET`
   (32+ tasodifiy belgi), `IP_HASH_SALT`, `TELEGRAM_WEBHOOK_SECRET`,
   `ADMIN_EMAIL/ADMIN_PASSWORD`, `SALES_STAFF_TELEGRAM_IDS`.
3. `npm run compose:up` - postgres, redis, api, bot, worker, admin qadaladi.
4. Migratsiyalar va seed:
   `docker compose exec api npm run db:migrate:deploy -w @app/db`
   `docker compose exec api npm run db:seed -w @app/db`
   (seed ichida ADMIN_EMAIL/PASSWORD bo'lsa admin yaratadi).
5. Webhook: `BOT_MODE=webhook` bo'lsa Telegram'ga:
   `curl -X POST "https://api.telegram.org/bot$TOKEN/setWebhook" -H "Content-Type: application/json" -d '{"url":"https://<domain>/telegram/webhook","secret_token":"<TELEGRAM_WEBHOOK_SECRET>"}'`
   Va reverse-proxy'da `/telegram/webhook` ni `apps/bot:4100` ga yo'naltiring.
   (Polling rejimida buning hojati yo'q.)
6. Sayt formasidan `fetch('https://<domain>/api/site/lead', ...)` chaqiriladi;
   `CORS_ORIGINS`ga sayt domeni qo'shiladi.

## Rollback

- `git checkout <oldingi-tag> && npm run compose:up` (compose rebuild qiladi).
- Migratsiyalar oldinga qaytariladi (`prisma migrate deploy`) - schema
  backward-compatible saqlanadi; buzuvchi migratsiyadan oldin albatta
  `pg_dump` oling va migratsiyani alohida `down` skript bilan hujjatlang.

## Backup

- Postgres: `docker compose exec postgres pg_dump -U postgres moyskladoy | gzip > backup-$(date +%F).sql.gz`
  (cron: kuniga 1 marta; offline joyga ko'chiring).
- Tiklash: `gunzip -c backup.sql | docker compose exec -T postgres psql -U postgres moyskladoy`.
- Media fayllar Telegram CDN'da (file_id); bizda katalog yozuvlari - DB backup yetarli.
- Redis - faqat navbat tezligi; o'chsa outbox DB'dan tiklanadi (zarar yo'q).

## Kuzatish

- Har xizmatda `GET /healthz`. Docker healthcheck yoki uptime monitor qo'shing.
- Loglar sanitizatsiyalangan (telefonlar maskPhone bilan) - baribir log fayllarini
  cheklangan saqlash muddati bilan saqlang.

## Sessiyalar eslatmasi

Hozirgi admin sessiyalari API jarayonining xotirasida. Multi-instance deploy'da
sticky session yoki keyingi versiyada Redisga ko'chirish kerak (docs/TODO).
