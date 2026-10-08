# Xavfsizlik tekshiruv ro'yxati (production oldidan)

Belgilanganlar - kodda bajarilgan va testlangan; [ ] - sizning tomoningizda.

- [x] Git'da maxfiy kalitlar yo'q; `.env` .gitignore'da; `.env.example` namuna.
- [x] Admin parollari bcrypt (cost 10) bilan hash'lanadi; panelga faqat sessiya bilan.
- [x] Login brute-force: 5 urinishdan so'ng 15 daqiqa qulflash + IP chegaralash.
- [x] Sessiya cookie: HttpOnly, SameSite=Lax, prod'da Secure; logout bilan bekor.
- [x] CSRF: yozuv amallarida `x-csrf-token` (double-submit) majburiy.
- [x] Telegram webhook: `x-telegram-bot-api-secret-token` tekshiriladi (webhook mode).
- [x] Webhook update dedupe (ProcessedUpdate) - qayta yuborilgan update ikki marta ishlamaydi.
- [x] Chiqarish sanizatsiyasi: foydalanuvchi matni panelda `toPlainText` orqali
      (boshqaruv belgilari/HTML yo'q); xabarlar Telegram'ga parse_mode'siz (plain text).
- [x] Loglarda telefon/token yashirin: `maskPhone`, `maskToken`, grammy xato
      matnidan token strippinqi.
- [x] Sayt formasi anti-spam: rate-limit (IP), minimum to'ldirish vaqti, honeypot,
      zod validatsiya, consent majburiy.
- [x] Linkda shaxsiy ma'lumot YO'Q - faqat random token; token bir marta bog'lanadi,
      TTL bilan eskiradi.
- [x] Upload: `MEDIA_MAX_BYTES` + mime/kengayma mosligi (validateUploadName); Fastify
      bodyLimit 10MB (media fayllar Telegram CDN orqali, bizda katalog yozuvlari).
- [x] SSRF guard: media manba URL faqat http(s), DNS javoblari tekshiriladi,
      private/link-local/loopback rad etiladi.
- [x] Marketing faqat faol rozilik bilan; yuborishdan OLDIN qayta tekshiriladi;
      revoke -> kutayotgan navbatlar bekor.
- [x] Bloklangan foydalanuvchiga yuborish to'xtaydi (blockedAt + send natijasi kuzatuvi).
- [x] Rol ajratish: `content_editor` - narx eksport/konta aktlar yo'q; `sales` - narx
      o'zgartira olmaydi; `admin` - hammasi. Sotuvchi guruh claim'ida qo'shimcha
      telegram ID ro'yxati tekshiriladi.
- [x] Kontakt eksport va "o'chirish" - faqat admin + audit yozuvi (kim, qachon, necha).
- [x] Soft-delete: foydalanuvchi bloklanadi va navbatlari to'xtatiladi; hard delete
      RETENTION_DAYS>0 bo'lsa rejalashtirilgan (hozircha panel xabari bilan cheklangan).
- [ ] DOMEN va HTTPS: reverse-proxy (Caddy/nginx) + `PUBLIC_URL` sozlash.
- [ ] `SESSION_SECRET`, `IP_HASH_SALT`, `TELEGRAM_WEBHOOK_SECRET` - uzun, tasodifiy
      qiymatlar bilan almashtirish (dev defaultlari ishlatsa ham xavfsiz emas).
- [ ] Postgres: parolni .env'da almashtirish; 5432 tashqi portga yopilsin (compose'da
      faqat local'ga map qilingan - server firewall bilan yopib qo'ying).
- [ ] Redis: parol yoki faqat ichki tarmoq; tashqariga ochiq bo'lmasin.
- [ ] Backup: pg_dump cron + off-site; tiklash sinovi.
- [ ] Monitoring: /healthz uptime alarmlari; disk joyi (loglar) kuzatuvi.
- [ ] Rate-limit'ni sayt tomonida (nginx/Caddy) ham qo'shimcha sozlash.
- [ ] Foydalanuvchi matnli help sahifasida spam'ga qarshi so'z filtr (ixtiyoriy).
