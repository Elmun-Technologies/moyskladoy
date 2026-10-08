# Moy Sklad - Telegram bot platformasi

Jamshid (@ogriqqa_yechim) biznesi uchun: sayt -> Telegram bot -> funnell -> sotuv
guruhiga ariza -> xodimning o'zlashtirishi -> nazorat qilingan eslatmalar.
Kontent (44 xabar), mahsulot/narxlar, roziklar - hammasi ma'lumotlar bazasida,
admin panelidan tahrirlanadi. Bot matnlarida AI erkin javob YO'Q.

## Komponentlar

| Qism | Texnologiya | Holat |
|---|---|---|
| `apps/bot` - funnel dvigateli | TypeScript + grammY | tayyor, 24 test o'tdi |
| `apps/api` - sayt formasi + admin API | Fastify 5 + zod | tayyor, 12 test o'tdi |
| `apps/worker` - eslatmalar/outbox | BullMQ yoki interval fallback | tayyor, 8 test o'tdi |
| `apps/admin` - boshqaruv paneli | Next.js 15 | tayyor (build OK, e2e yozilgan, browser yo'qligi sababli Ishga tushirilmagan) |
| `packages/shared` - domen modeli | TypeScript | tayyor |
| `packages/db` - Prisma + seed | Prisma 6 + PostgreSQL | tayyor (generate/migrate sizning mashinangizda) |

## Tez start (demo - Postgres/Redis ham kerak emas)

```bash
npm install
npm run dev:api        # http://localhost:4000 oching: sayt formasi + bot simulyatori
# ikkinchi terminal:
npm run dev:admin      # http://localhost:3000 - admin panel (login: ADMIN_EMAIL/PASSWORD)
```

Demo rejimda: DB xotirada (jarayon yangilansa tozalanadi), Telegramga HECH NARSA
yuborilmaydi - xabarlar simulyator oynasida ko'rinadi.

## To'liq stek (Docker)

```bash
cp .env.example .env   # qiymatlarni to'ldiring (token, domen va h.k.)
npm run compose:up     # postgres+redis+api+bot+worker+admin
# migratsiya va seed bir marta:
docker compose exec api npm run db:migrate:deploy -w @app/db
docker compose exec api npm run db:seed -w @app/db
```

Docker bo'lmasa (local): `docker compose up -d postgres redis`, so'ng

```bash
npm run db:generate    # prisma client
npm run db:migrate     # migratsiya (birinchi marta)
npm run db:seed        # kontent + mahsulotlar + admin
npm run dev:api & npm run dev:bot & npm run dev:worker & npm run dev:admin
```

Bot uchun: `BOT_MODE=polling` (eng oddiy, webhook kerak emas) yoki
`BOT_MODE=webhook` + `curl -X POST https://api.telegram.org/bot<TOKEN>/setWebhook -d '{"url":"https://<domain>/telegram/webhook","secret_token":"<TELEGRAM_WEBHOOK_SECRET>"}'`.

## Testlar

```bash
npm run test        # barcha workspace vitestlari (bot 24 + api 12 + worker 8)
npm run typecheck   # barcha paketlar
```

Testlar HAQIQIY Telegram akkauntlariga tegmaydi (TestMessenger adapteri).
E2E (Playwright): `apps/admin/e2e/funnel.spec.ts` - `npx playwright install chromium`
bilan ishga tushadi; bu muhitda browser yuklab bo'lmagani uchun Ishlatilmagan.

## Muhim biznes qoidalari (kodda bajarilgan)

- Sayt havolasida FAQAT random token (ism/telefon yo'q); birinchi ochishda
  foydalanuvchiga bog'lanadi; muddati o'tgan/band token - oddiy kirish.
- To'lov tizimi YO'Q - xaridni sotuvchi qo'lda tasdiqlaydi; tasdiqlangan xarid
  sahna tugmalarini o'chiradi va navbatlarni to'xtatadi.
- $800 taklifi "tasdiqlanmagan" holatda saqlangan va foydalanuvchiga ko'rsatilmaydi.
- Kurs/video dars shartlari (davomiylik, qo'llab-quvvatlash, bo'lib to'lov) -
  admin panelida to'ldirilgunicha bot ular haqida gapirmaydi.
- Marketing/eslatmalar: faqat faol rozilik bilan, Toshkent 09:00-20:00,
  kuniga 1 tagacha; blok/revoke/sotuvda/xarid qilingan/oddiy suhbat - to'xtatadi.
- "Video yuborildi" != "ko'rildi" - darsni ko'rishni foydalanuvchi o'zi belgilaydi.
- Eski/takroriy tugmalar ariza yaratmaydi va sotuv holatini orqaga qaytarmaydi.
- Ikki xodim bir vaqtning o'zida "O'zimga olish" - bitta g'olib (atomik).
- Guruhga xabar bor saqlanmadi ham - ariza yo'qolmaydi (outbox qayta urinishi).

## Hujjatlar

- `docs/ARCHITECTURE.md` - komponentlar va ma'lumot oqimi
- `docs/DEPLOYMENT.md` - deploy, rollback, backup
- `docs/SECURITY_CHECKLIST.md` - xavfsizlik tekshiruv ro'yxati
- `docs/CONTENT_CHECKLIST.md` - kontent/materiallar tartibi
- `docs/NEEDED_MATERIALS.md` - sizdan kerak bo'ladigan ma'lumotlar ro'yxati

## Limitlar (halol ro'yxat)

- Bu sandbox'da `prisma generate` ishlamaydi (binaries.prisma.sh torga yopiq) -
  kod typecheck'dan o'tgan, Prisma API'ga mos yozilgan; birinchi `npm run db:generate`
  sizning mashinangizda bir marta ishga tushadi.
- Demo rejim (xotiradagi DB) - faqat bitta jarayon; api va bot alohida procesda
  bo'lsa, ularning xotira DB'lari ALOSHIDA bo'ladi (prod: Postgres'da umumlashadi).
- Admin sessiyalari hozircha API jarayonining xotirasida (Map) - api restart bilan
  chiqish bo'ladi; Redis'da saqlash keyingi bosqich (docs/DEPLOYMENT.md).
- Fayl upload'i media katalogga file_id yozish orqali - video Telegram'ga
  CONTENT_CHECKLIST bo'yicha yuklanadi (auto-download YO'Q).
- To'lov integratsiyasi YO'Q - bu dizayn qarori, xato emas.
