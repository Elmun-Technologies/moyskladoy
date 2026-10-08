# Arxitektura

```
 Sayt (form)                 Admin panel (Next.js)
      |  POST /api/site/lead        |  /api/admin/* (sessiya+CSRF+rol)
      v                             v
 +----------------------- Fastify API (apps/api) ------------------------+
 | zod validatsiya | rate-limit | honeypot | min-fill | token generatsiya|
 +-----------------------------------+------------------------------------+
                                     |  link token (DB)
                                     v
 +------------------ PostgreSQL (Prisma, packages/db) --------------------+
 | users, states, blocks, products+versions, leads, consents, outbox,    |
 | media, events, settings, audit, processed_updates                      |
 +-----------+----------------------------------------------+------------+
             |                                              |
   grammY Bot (apps/bot)                       Worker (apps/worker)
   - webhook yoki polling                      - tick: reminder/nurture qoidalari
   - update dedupe (ProcessedUpdate)           - outbox sender: retry+backoff
   - DB-driven state machine (BotEngine)       - yuborishdan oldin qayta tekshiruv:
   - Messenger interfeysi:                       rozilik/blok/sotuv/oyna/kun limiti
     GrammyMessenger (prod)
     TestMessenger (test/demo)
             |
             v
   Telegram Bot API  <--->  Sotuv guruhi (claim:<leadId> tugmasi, atomik)
```

## Asosiy oqimlar

1. **Form -> link.** `POST /api/site/lead` SiteLead + random `LinkToken`
   (TTL default 24 soat) yaratadi. Link: `https://t.me/<bot>?start=<token>` - shaxsiy ma'lumot yo'q.
2. **Bog'lash.** `/start <token>` -> `claimLinkToken` atomik: birinchi foydalanuvchi
   egasiga aylanadi; eski/band token - oddiy kirish (xato ko'rsatilmaydi).
3. **Funnel.** `BotEngine.renderStage` har bosqichda faqat `approved` blok versiyasini
   oladi. Media yo'q + `requiresMedia` va fallback taqiqlangan -> blok o'tkaziladi va
   admin panelida "missing media" ogohlantirishida ko'rinadi.
4. **Ariza.** `submit:send` -> `createSalesLead` (foydalanuvchi+mahsulot bo'yicha
   idempotent, faol holatlar ichida). Sotuvga o'tgach: reminder/marketing bekor,
   holat `in_sales`. Eski tugmalar holatni orqaga qaytara olmaydi.
5. **Guruh xabari.** Outbox (`notification`, dedupeKey `sales:notify:<leadId>`).
   Yuborishda xatolik -> ariza baribir bazada; worker qayta urinishi bilan yuboradi.
6. **Claim.** `claim:<leadId>` tugmasi - faqat `sales_staff` xaritasidagi telegram
   ID'lar uchun; DB tranzaksiyasida `assignedToId IS NULL` sharti bilan atomik.
7. **Narx versiyalari.** Product version'lari tarix; ariza qaysi versiyani ko'rgan
   bo'lsa o'sha yoziladi - keyinchalik narx o'zgarsa ham eskirmaydi.
8. **Eslatmalar.** Worker har tick'da qoidalarni qo'llaydi (24h intro / lesson
   self-report / 24h offers / 7 kun keyin fikr / dush-pay nurture tip'lari, har tip
   1 marta). Barchasi `dedupeKey` bilan idempotent; yuborish paytida qayta tekshiriladi.

## Idempotentlik (va "exactly-once" emasligi)

- Har Telegram update `ProcessedUpdate` jadvali bilan bir marta qayta ishlanadi.
- Har foydalanuvchi bo'yicha vazifalar navbatda (per-user serialization).
- Tashqariga yuborishda transport kafolatini bermaymiz: holatlar
  (`pending->sending->sent/failed/cancelled`) kuzatiladi, tarmoq xatolarida
  qayta urinish + ambiguous holat yozib qo'yiladi.
