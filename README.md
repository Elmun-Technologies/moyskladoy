# Moy Sklad - Telegram bot platformasi

Jamshid (@ogriqqa_yechim) biznesi uchun: sayt -> Telegram bot -> funnell -> sotuv
guruhiga ariza -> xodimning o'zlashtirishi -> nazorat qilingan eslatmalar.
Stage/button/source analytics, funnel va retention hisobotlari, segmentlar hamda
Telegram/SMS kampaniyalari admin panelida boshqariladi. Bot matnlarida AI erkin javob YO'Q.

## Komponentlar

| Qism | Texnologiya | Holat |
|---|---|---|
| `apps/bot` - funnel dvigateli | TypeScript + grammY | stage/button/source/link analytics, polling |
| `apps/api` - sayt formasi + admin API | Fastify 5 + zod | segment, kampaniya, SMS, funnel/source API |
| `apps/worker` - outbox/kampaniyalar | interval fallback (Redis ixtiyoriy) | idempotent Telegram/SMS navbati va limitlar |
| `apps/admin` - boshqaruv paneli | Next.js 15 | dashboard, funnel, bosqichlar, campaigns, SMS |
| `packages/shared` - domen modeli | TypeScript | rozilik, analytics, segment va kampaniya modellari |
| `packages/db` - Prisma + seed | Prisma 6 + PostgreSQL | deploy'da additive `prisma db push` |

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
# additive schema va seed (birinchi o'rnatishda):
docker compose exec api npx prisma db push --schema packages/db/prisma/schema.prisma
docker compose exec api npm run db:seed -w @app/db
```

Docker bo'lmasa (local): `docker compose up -d postgres redis`, so'ng

```bash
npm run db:generate    # Prisma client
npm run db:push        # additive schema sync (migrate deploy ishlatilmaydi)
npm run db:seed        # kontent + mahsulotlar + admin
npm run dev:api & npm run dev:bot & npm run dev:worker & npm run dev:admin
```

Bot uchun: `BOT_MODE=polling` (eng oddiy, webhook kerak emas) yoki
`BOT_MODE=webhook` + `curl -X POST https://api.telegram.org/bot<TOKEN>/setWebhook -d '{"url":"https://<domain>/telegram/webhook","secret_token":"<TELEGRAM_WEBHOOK_SECRET>"}'`.

## Testlar

```bash
npm run test        # barcha workspace Vitest testlari
npm run typecheck   # barcha paketlar
```

Testlar haqiqiy Telegram yoki SMS providerlariga tarmoq so'rovi yubormaydi; fake transportlar ishlatiladi.
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
- Telegram marketing: faqat faol rozilik va bloklanmagan foydalanuvchiga, Toshkent
  09:00-20:00, kuniga 1 tagacha; revoke/sotuv/xariddan keyin yuborish to'xtaydi.
- SMS: alohida SMS roziligi va telefon shart; Toshkent 10:00-20:00,
  har bir raqamga rolling 7 kunda 2 tacha. `SMS_USER`/`SMS_PASSWORD` optional.
- Funnel analitikasi bosqich ko'rilishi/tugashi, tugma bosilishi, `/start` manbasi,
  havola ochilishi va kampaniyaga bog'liq javobni yozib boradi.
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

- Ushbu sandbox'da `prisma generate` binaries.prisma.sh tarmog'iga ulana olmadi;
  generate/DB push bajarilmadi. Fly image build `prisma generate` qiladi, release
  command esa additive schema uchun `npx prisma db push` bajaradi.
- Demo rejim (xotiradagi DB) - faqat bitta jarayon; api va bot alohida procesda
  bo'lsa, ularning xotira DB'lari ALOSHIDA bo'ladi (prod: Postgres'da umumlashadi).
- API sessiyalari va login limiteri RAM'da; API bitta machine'da qolishi kerak.
  Redis ixtiyoriy va faqat worker navbatini sozlash uchun ishlatiladi.
- Fayl upload'i media katalogga file_id yozish orqali - video Telegram'ga
  CONTENT_CHECKLIST bo'yicha yuklanadi (auto-download YO'Q).
- To'lov integratsiyasi YO'Q - bu dizayn qarori, xato emas.
