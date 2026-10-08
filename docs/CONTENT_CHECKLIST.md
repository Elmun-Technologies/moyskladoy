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

## Video materiallar (3 ta)

`intro_video`, `experience_video`, `method_video` - Bot API talabiga mos
**round video_note** yoki oddiy video. Yuklash tartibi (Telegram'ga, bot orqali):

1. Videoni tayyorlang (videoproduser Jamshid; biz avtomatik yuklab olmaymiz -
   Instagram'dan ruxsatsiz yuklash taqiqlangan).
2. Vaqtincha chatga yuborib `file_id` oling yoki `sendVideoNote` API bilan:
   `curl -F chat_id=<admin_chat> -F video_note=@intro.mp4 https://api.telegram.org/bot$TOKEN/sendVideoNote`
   (javobdagi `file_id`ni nusxalang - u doimiy).
3. Panel: Media bo'limiga `file_id`ni qo'shing, keyin blokka bog'lang va tasdiqlang.

Sinov darsi havolasi: Sozlamalar -> "Sinov darsi havolasi" (bo'sh bo'lsa bot
"Darsni ochish" tugmasini ko'rsatmaydi - dars berilmaydi, halokat bo'lmaydi).

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
- Eslatma shablonlari: `reminder_intro/lesson/offers/review` - tahrirlash mumkin.
- Marketing oynasi va kun limiti - env orqali (`MARKETING_WINDOW_START/END`,
  `MARKETING_MAX_PER_DAY`).
