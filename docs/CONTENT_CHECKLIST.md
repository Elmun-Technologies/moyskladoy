# Kontent va materiallar tartibi

## Ish oqimi (admin panel: Kontent bo'limi)

1. Blokni tahrirlash -> saqlash avtomatik **yangi DRAFT versiya** yaratadi.
   Bot shu payungacha eski `approved` versiyani yuborib turadi.
2. **Ko'rish (preview)** - matn, tugmalar, media holati tekshiriladi.
3. **Tasdiqlash** - yangi versiya `approved` bo'ladi (faqat admin).
   Majburiy media blokda material bo'lmasa va matn fallback taqiqlangan bo'lsa -
   tasdiqlash 409 bilan rad etiladi.
4. Panel yuqorisida "missing media" ogohlantirishi: approved lekin materialsiz
   majburiy bloklar ro'yxati.

## Video materiallar

`welcome`, `experience_video`, `method_video` (tanishuv, 1-3 bo'limlar),
`after_lesson_video` va objection bloklari (`objection_time/employee/price/start`),
`preflight_video` - Bot API talabiga mos **round video_note** yoki oddiy video;
`lesson_intro` - to'liq video. `client_review` va `student_review` - FAQAT
ruxsat olingan haqiqiy mijoz/bitiruvchi videosi (o'rnida bosqich o'tkaziladi).

Har blokning **"Kamera matni" (videoScript)** maydoni bor - bu yerda spec'dagi
aytiladigan matn saqlanadi (bot uni xabar qilib yubormaydi, foydalanuvchiga
faqat blok matni + video boradi). Yuklash tartibi (Telegram'ga, bot orqali):

1. Videoni tayyorlang (videoproduser Jamshid; biz avtomatik yuklab olmaymiz -
   Instagram'dan ruxsatsiz yuklash taqiqlangan).
2. **Panel orqali (tavsiya):** Media bo'limida faylni tanlang - API uni
   Telegram'ga yuborib `file_id`ni avtomatik oladi (TELEGRAM_BOT_TOKEN va
   target chat_id sozlangan bo'lsa). Token bo'lmasa fayl serverda saqlanadi va
   keyin bog'lanadi.
3. Yoki terminal orqali: `curl -F chat_id=<admin_chat> -F video_note=@intro.mp4
   https://api.telegram.org/bot$TOKEN/sendVideoNote` - javobdagi `file_id`ni
   Media katalogiga qo'shing.
4. Kontent bo'limida: blokni oching -> Media turi = "Dumaloq video" -> katalogdan
   tanlang (yoki file_id kiriting) -> Saqlash (qoralama) -> Tasdiqlash.
5. Shu yerda tugmalarni ham boshqariladi: qo'shish, o'chirish, tartib, yoqish/
   off. Ruxsat etilgan amallar: `goto:<STAGE>`, `answer:field=value`,
   `task:right|wrong|help`, `lesson:open|watched|resend|remind_tomorrow`,
   `consent:grant_marketing|no_reminders|grant_contact|decline|revoke_marketing`,
   `notif:marketing|lessons|off|on`, `contact:phone|telegram`,
   `submit:send|edit`, `cmd:menu|stop|ask|back|edit`. Noto'g'ri yoki tasdiqlangan
   bloki yo'q sahna yo'naltirilgan tugma server tomonida rad etiladi (422) -
   bot hech qachon singan tugma yubormaydi.

## Bo'limni ishga tushirish sharti (bracket placeholderlar)

Spec'dagi [havola/shart]lar jamoa to'ldiriguncha bosqich OCHILMAYDI:
blokning `Ko'rsatish shartlari -> Settings kalitlari` maydoni ishlatiladi.

| Blok | Kalit | To'ldirilmasa |
|---|---|---|
| `lesson_intro` (12) | `lesson_link` | "Bo'lim tez orada" xabari yuboriladi |
| `offer_course` (20) | `terms_course_url` | shu yerda |
| `offer_videos` (21) | `terms_videos_url` | shu yerda |
| `consent_reminders` (18) | - | rozilik site'dan bo'lsa bosqich so'rovsiz o'tkaziladi |

Eslatma kalitlari Sozlamalar bo'limida: `lesson_link`, `terms_course_url`,
`terms_videos_url`, `help_path` (51-blok "Yordam boti"), `service_pricing_text`,
`purchase_start_message`.

## Narxlar va takliflar

- `Kurs` 2,000 USD, `Video darslar` 500 USD - admin o'zgartirilgunicha demo qiymat.
- `Xizmat` - narx ko'lam bo'yicha; matni Sozlamalar'da.
- **$800 taklif: TASDIQLANMAGAN** - holati `unconfirmed`, foydalanuvchiga
  ko'rsatilmaydi. Tarkibi aniqlangach: Mahsulotlar'da `special-800` ni
  tasdiqlangan deb belgilang va ko'rinarli qiling.
- Kurs shartlari (davomiylik, qo'llab-quvvatlash, kirish muddati, bo'lib to'lov,
  qaytarish) - tasdiqlanmagan holda bot ular haqida xabar chiqarmaydi;
  Mahsulot tafsilotlarini paneldan to'ldiring.

## Nurture tip'lari va eslatmalar

- `tip_*` bloklari - dushanba/payshanba, har foydalanuvchiga har tip 1 marta;
  tugaganida jim (eski xabarlarni takrorlamaydi).
- Eslatma shablonlari (38-41): `reminder_intro`, `reminder_lesson` (+
  `reminder_lesson_again`), `reminder_offers`, `reminder_week1` (sotuvga
  uzatilgandan 7 kun keyin, 1 marta) - tahrirlash mumkin.
- 42-45: `tip_cash`, `tip_debt`, `tip_slow`, `tip_owner` - foydali maslahatlar.
- 47-48 bildirishnoma sozlamalari: `notif_settings` / `reminders_off` bloklari;
  "faqat dars eslatmalari" rejimida (`notif:lessons`) `tip_*` yuborilmaydi.
- Task (13-15): tugmalar `task:right|wrong|help` - noto'g'ri javobda ham
  foydalanuvchi chetlashtirilmaydi, izoh + "Davom etish" chiqadi.
- Sotuvga uzatish (36): "sotuv bo'limiga uzatildi" tasdiqi faqat uzatish
  AMALGA OSHSA yuboriladi; texnik xatolikda foydalanuvchiga "kutilmoqda" xabari,
  jamaga ogohlantirish chiqadi - soxta tasdiq yo'q.
- Marketing oynasi va kun limiti - env orqali (`MARKETING_WINDOW_START/END`,
  `MARKETING_MAX_PER_DAY`).
