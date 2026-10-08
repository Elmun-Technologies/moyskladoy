# Sizdan kerak bo'ladigan ma'lumotlar (production uchun)

Yulduzcha (*) - bularchsiz lokal ishlaydi, lekin prod uchun shart.

1. * Telegram bot token (`TELEGRAM_BOT_TOKEN`) va bot username (`BOT_USERNAME`).
2. * Domen + HTTPS (reverse-proxy) va `PUBLIC_URL`.
3. * Sotuv guruhi: guruhga botni qo'shish, chat_id (`SALES_GROUP_CHAT_ID`),
   xodimlarning Telegram ID ro'yxati (`SALES_STAFF_TELEGRAM_IDS`) va
   har biriga admin hisobi (email) + panel "sales" roli.
4. * 3 ta tanishuv videosi (welcome/experience/method bloklarining kamera matni
   seed'da tayyor - docs/CONTENT_CHECKLIST.md) + ruxsat olingan mijoz videosi
   (Nefrit) va kurs bitiruvchisi videosi. Bularchiz bo'limlar o'chib qolmaydi,
   faqat video qismi yuborilmaydi yoki bosqich o'tkaziladi.
5. * Sinov darsi: havola/video - Sozlamalar'ga (`lesson_link`). Shu kalit
   to'ldirilgunicha dars bo'limi umuman ochilmaydi.
5a. * Kurs va videodarslar SHARTLARI havolalari (`terms_course_url`,
   `terms_videos_url`) + yordam boti manzili (`help_path`) - bracket
   placeholder'lar; to'ldirilmasa tegishli bo'lim ishga tushmaydi.
5b. * 28-34 bosqichlardagi "so'rab tekshiriladigan" atamalarni sotuv jamoasi
   bilishi uchun qo'ng'iroq savollari ro'yxati (preflight video tamoyilan
   yozib bo'lingan - ovoz/ko'rinish kerak).
6. * $800 taklif: nomi, tarkibi, kimga qandaq ko'rsatilishi (tasdiqlangach
   panel'da yoqiladi).
7. Kurs mahsuloti shartlari: davomiyligi, qo'llab-quvvatlash turi, kirish
   muddati, bo'lib to'lov bormi, qaytarish siyosati - bitmasa ham mayli,
   bot shu paytgacha ular haqida gapirmaydi.
8. Rozilik matnlari: bog'lanish + marketing (hozircha qisqa versiya seed'langan;
   huquqiy tekshiruvdan o'tkazing).
9. Sayt formasi joyi: qaysi sahifaga qo'yiladi, UTM manbalar ro'yxati
   (reklama kampaniyalari nomlari) - statistika bo'limi uchun.
10. Brend talablari: botning menyu tugmalari tartibi, ovozli videolardagi
   matnlar (hozirgi 58 blok - panel'dan to'liq tahrirlanadi).
11. Ma'lumotlar siyosati: saqlash muddati (`RETENTION_DAYS`), eksportga ruxsat
    beruvchi shaxs; O'zbekiston shaxsiy ma'lumotlar talablariga muvofiqlik.
12. Server/infra: Docker compose'ni qayerda ishga tushiramiz (VPS), backup
    joyi, monitoring kanali.

Bular kelguncha: sozlanadigan maydonlar ochiq, demo mode to'liq ishlaydi,
hech narsa local ishlanmani to'xtatmaydi.
