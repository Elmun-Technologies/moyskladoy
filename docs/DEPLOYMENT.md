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


## Fly.io deploy (bizning server)

Tayyor konfiguratsiyalar: `Dockerfile` (root) + `deploy/fly/fly.web.toml` +
`deploy/fly/fly.admin.toml`. Kerakli: `flyctl` o'rnatilgan va `fly auth login`.

1. **Asosiy app** (api+bot+worker, bitta image, 3 process group):

   ```bash
   fly apps create moyskladoy
   fly postgres create --name moyskladoy-db --vm-size shared-cpu-1x \
     --initial-cluster-size 1 --volume-size 5
   fly postgres attach moyskladoy-db --app moyskladoy   # DATABASE_URL auto
   fly volume create moyskladoy_data --app moyskladoy   # MEDIA_DIR uchun
   fly secrets set TELEGRAM_BOT_TOKEN=... BOT_USERNAME=... \
     SESSION_SECRET="$(openssl rand -hex 32)" IP_HASH_SALT="$(openssl rand -hex 32)" \
     ADMIN_EMAIL=... ADMIN_PASSWORD=... SALES_GROUP_CHAT_ID=... \
     SALES_STAFF_TELEGRAM_IDS=... CORS_ORIGINS=https://<sayt-domene> --app moyskladoy
   fly deploy --config deploy/fly/fly.web.toml
   fly ssh console -C "npm run db:migrate:deploy -w @app/db"
   fly ssh console -C "npm run db:seed -w @app/db"
   ```

2. **Admin panel** (alohida app, ichki tarmoq orqali API'ga ulanadi):

   ```bash
   fly apps create moyskladoy-admin
   fly deploy --config deploy/fly/fly.admin.toml
   ```

3. **Bot rejimi:** toml'da `BOT_MODE=polling` - webhook, sertifikat, domain
   sozlash shart emas (bot o'zi Telegram'dan yangi oladi). Webhook kerak
   bo'lsa: `BOT_MODE=webhook` secret bilan + docs yuqoridagi 5-band.

4. **Redis kerak emas:** `REDIS_URL` bo'lmasa worker in-process interval
   navbatda ishlaydi (bir machina uchun to'liq yetarli; reminder-lar
   DB outbox'da, u qismidan holat saqlanadi). Keyinchalik parallel
   bot/worker instance kerak bo'lsa - Upstash Redis qo'shib `REDIS_URL`
   secret'ini bering.

5. **Demo sahifa** (`GET /` api'da) `https://moyskladoy.fly.dev` da ochiladi -
   sayt formasi + bot simulyatori. Haqiqiy sayt formasini boshqa domendan
   chaqirsangiz, o'sha domenni `CORS_ORIGINS`ga qo'shing.

6. **Yangilash:** `git push` -> `fly deploy --config ...` (ikkala app uchun
   alohida). Rollback: `fly releases rollback` yoki eski commitga
   `git checkout` + qayta deploy (migratsiyalar backward-compatible).

7. **Cheklovlar:** `auto_stop_machines="stop"` bo'lsa idle'da bot/worker
   to'xtamaydi (faqat app group processes'da) - reminderlar uzluksiz ishlashi
   uchun web group ham `min_machines_running=1` qilingan. Full-time ish
   hajmi uchun hisobni kuzating; kerak bo'lsa `fly scale memory 512`.

Eslatma: Fly'dagi birinchi deploy'da Docker build remote builder'da ketadi
(~3-5 daqiqa). Bu sandbox'da docker/build qatlam sinovdan o'tkazilmagan -
birinchi `fly deploy`'ni kuzatib chiqing.

## Sessiyalar eslatmasi

Hozirgi admin sessiyalari API jarayonining xotirasida. Multi-instance deploy'da
sticky session yoki keyingi versiyada Redisga ko'chirish kerak (docs/TODO).
