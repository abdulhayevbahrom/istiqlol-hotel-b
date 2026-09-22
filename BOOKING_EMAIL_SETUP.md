# Bron tasdiq emailini sozlash

Server `.env` fayliga quyidagilarni kiriting:

```env
BOOKING_SMTP_HOST=smtp.mail.ru
BOOKING_SMTP_PORT=465
BOOKING_SMTP_SECURE=true
BOOKING_SMTP_USER=hotel.istiqlol@mail.ru
BOOKING_SMTP_PASS=MAIL_RU_APP_PASSWORD
BOOKING_MAIL_FROM=Istiqlol Hotel <hotel.istiqlol@mail.ru>
PUBLIC_WEBSITE_URL=https://istiqlolhotel.uz
```

`BOOKING_SMTP_PASS` uchun Mail.ru hisobining oddiy parolini emas, tashqi dastur uchun yaratilgan maxsus parolni ishlating. Parolni Git repositoryga commit qilmang. Sozlamalar o‘zgargach backend jarayonini qayta ishga tushiring.
