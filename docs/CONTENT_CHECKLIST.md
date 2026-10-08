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
   off. Noto'g'ri yoki mavjud bo'lmagan sahnaenga yo'naltirilgan tugma server
   tomonida rad etiladi (422) - bot hech qachon singan tugma yubormaydi.

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
