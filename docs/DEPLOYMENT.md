# Deploy / rollback / backup

## Schema safety

Prisma o'zgarishlari faqat **additive**: mavjud model/ustun o'chirilmaydi yoki qayta nomlanmaydi. Fly asosiy app release bosqichida `npx prisma db push --schema packages/db/prisma/schema.prisma` ishga tushadi; alohida `migrate deploy` ishlatilmaydi. `db push` release muvaffaqiyatsiz bo'lsa, yangi app versiyasi ishga tushmaydi. Rollback'da yangi ustun/jadvallar bazada qoladi — eski app versiyasi bilan moslik shu sabab saqlanadi. Har qanday deploydan oldin Postgres backup oling.

Lokal schema yangilash:

```bash
npm run db:push
npm run db:seed # faqat birinchi o'rnatishda yoki seed ma'lumotini ataylab yangilaganda
```

## Docker Compose

1. `.env.example`dan `.env` yarating va qiymatlarni serverda to'ldiring. Kamida: `TELEGRAM_BOT_TOKEN`, `BOT_USERNAME`, `SESSION_SECRET` (32+ tasodifiy belgi), `IP_HASH_SALT`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SALES_GROUP_CHAT_ID`, `SALES_STAFF_TELEGRAM_IDS`.
2. `npm run compose:up` — Postgres, Redis (ixtiyoriy), API, bot, worker va admin panelni ishga tushiradi.
3. Birinchi deployda: `docker compose exec api npx prisma db push --schema packages/db/prisma/schema.prisma`, keyin `docker compose exec api npm run db:seed -w @app/db`.
4. SMS ixtiyoriy: `SMS_USER` va `SMS_PASSWORD` bo'sh bo'lsa yuborish o'chiriladi, queued SMS qaydlari saqlanadi. Ishga tushirish uchun Eskiz hisob ma'lumotlarini worker/API jarayonlari ko'radigan server secret/env'ga kiriting. Hech qachon qiymatlarni repoga qo'shmang. `SMS_FROM` va `SMS_PRICE_PER_PART_UZS` ham sozlanishi mumkin; ikkinchisi faqat estimate, hisobingizning provayder kotirovkasi emas.
5. Bot `BOT_MODE=polling` bilan ishlasa webhook kerak emas. Webhook rejimida Telegram `setWebhook` va reverse-proxy kerak bo'ladi.

## Fly.io (asosiy app + admin panel)

`fly.toml` bitta `moyskladoy` image'ida API, bot (grammY long polling) va worker'ni alohida process group qiladi. `fly.admin.toml` — alohida Next.js admin app. Repo ildizidan deploy qiling:

1. Birinchi o'rnatishda Fly app/Postgres/volume yarating va **o'zingiz** secrets sozlang:

   ```bash
   fly apps create moyskladoy
   fly postgres create --name moyskladoy-db --vm-size shared-cpu-1x --initial-cluster-size 1 --volume-size 5
   fly postgres attach moyskladoy-db --app moyskladoy
   fly volume create moyskladoy_data --app moyskladoy
   fly secrets set TELEGRAM_BOT_TOKEN=... BOT_USERNAME=... \
     SESSION_SECRET="$(openssl rand -hex 32)" IP_HASH_SALT="$(openssl rand -hex 32)" \
     ADMIN_EMAIL=... ADMIN_PASSWORD=... SALES_GROUP_CHAT_ID=... \
     SALES_STAFF_TELEGRAM_IDS=... --app moyskladoy
   ```

   SMS ixtiyoriy secrets (faqat Eskiz hisobingiz bo'lsa):

   ```bash
   fly secrets set SMS_USER='<Eskiz login>' SMS_PASSWORD='<Eskiz parol>' --app moyskladoy
   # Istasangiz yuboruvchi nomi va estimate narxini alohida sozlang:
   fly secrets set SMS_FROM='4546' SMS_PRICE_PER_PART_UZS='95' --app moyskladoy
   ```

   `SMS_USER`/`SMS_PASSWORD` sozlanmaganida API balans javobida aynan shu env nomlarini ko'rsatadi; worker SMS xabarlarini yo'qotmay navbatda qoldiradi. `SMS_PRICE_PER_PART_UZS=95` — o'zgartiriladigan estimate qiymati, Eskiz hisobingiz narxining tasdig'i emas.

2. Asosiy app'ni deploy qiling. `fly.toml`dagi release command DB schema'ni avtomatik va additive tarzda qo'llaydi:

   ```bash
   fly deploy --config fly.toml
   ```

   Birinchi ishga tushirishda admin/seed ma'lumoti kerak bo'lsa:

   ```bash
   fly ssh console --app moyskladoy -C "npm run db:seed -w @app/db"
   ```

3. Admin panel image'ini alohida deploy qiling:

   ```bash
   fly apps create moyskladoy-admin # faqat birinchi marta
   fly deploy --config fly.admin.toml
   ```

   Admin `/api/*` so'rovlarini `apps/admin/next.config.mjs`dagi build-vaqt rewrite orqali `https://moyskladoy.fly.dev`ga yuboradi. Bu manzil image build vaqtida belgilanadi; Fly runtime env'ni o'zgartirish bilan proxy manzili almashmaydi. Boshqa API domeni kerak bo'lsa, Next/Docker build konfiguratsiyasidagi `API_INTERNAL_URL`ni o'zgartirib admin image'ni qayta build/deploy qiling.

4. Bot `BOT_MODE=polling`da ishlaydi; webhook/domain/sertifikat talab qilinmaydi. `REDIS_URL` ixtiyoriy — Redis bo'lmasa worker bitta mashinada in-process intervaldan foydalanadi. API sessiya va login limiteri RAM'da, shu sabab API'ni bitta machine/instance'da qoldiring.

### Fly deploy tekshiruvi (`curl`)

Quyidagi misollar shell'da `ADMIN_EMAIL`/`ADMIN_PASSWORD` env variable oldindan mavjud deb hisoblaydi. Hech qachon parolni Git'ga yoki chatga yozmang.

```bash
API=https://moyskladoy.fly.dev
ADMIN=https://moyskladoy-admin.fly.dev
curl -fsS "$API/healthz"
curl -fsSI "$ADMIN/"

LOGIN=$(curl -fsS -c /tmp/moyskladoy-cookie.txt \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  "$ADMIN/api/admin/login")
CSRF=$(printf '%s' "$LOGIN" | jq -r .csrf)
curl -fsS -b /tmp/moyskladoy-cookie.txt "$ADMIN/api/admin/funnel?by=week&cohort=weekly"
curl -fsS -b /tmp/moyskladoy-cookie.txt "$ADMIN/api/admin/campaigns"
curl -fsS -b /tmp/moyskladoy-cookie.txt "$ADMIN/api/admin/sms/balance"
```

Bu login va API chaqiruvlari admin'ning `/api/*` rewrite/proxy'sini ham tekshiradi. Yozuvchi API tekshiruvida `-H "x-csrf-token:$CSRF"` yuboring. CSV misol: `curl -b /tmp/moyskladoy-cookie.txt -OJ "$ADMIN/api/admin/campaigns/<id>/export.csv"`. `API` o'zgaruvchisi health check uchun ishlatiladi.

### Yangilash / rollback

```bash
fly deploy --config fly.toml       # release command db push'ni ham bajaradi
fly deploy --config fly.admin.toml
```

App rollback uchun `fly releases rollback --app moyskladoy` (va zarur bo'lsa `--app moyskladoy-admin`) ishlating. Schema faqat additive bo'lgani uchun ustun/jadvallarni rollback paytida qo'lda o'chirmang. Buzuvchi schema o'zgarishi bu ish doirasiga kirmaydi.

## Backup va kuzatish

- Postgres: `fly postgres backup create --app moyskladoy-db` yoki provider tavsiya qilgan schedule. Compose uchun: `docker compose exec postgres pg_dump -U postgres moyskladoy | gzip > backup-$(date +%F).sql.gz`.
- Tiklashni production'da qilishdan oldin backup nusxasida sinang.
- Har deploydan keyin `GET /healthz`; API, bot, worker process loglarini kuzating.
- SMS balans/hisobotlari admin panelda; provider credentials yo'q bo'lsa nomlari aniq ko'rsatiladi.
- Media `file_id` Telegram CDN'da, katalog/boshqa metadata DB'da saqlanadi.

## Cheklovlar

- Fly API app bitta instance: admin sessiyalari va login limiteri jarayon xotirasida.
- Bot grammY long polling bilan ishlaydi; Redis shart emas.
- Admin proxy URL build-time; runtime `API_INTERNAL_URL` o'zgarishi Next rewrite'ni yangilamaydi.
- SMS uchun `SMS_USER`, `SMS_PASSWORD` ixtiyoriy; maxfiy qiymatlarni Fly secrets'da saqlang, repoga qo'shmang.
