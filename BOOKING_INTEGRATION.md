# Booking.com integratsiyasini ishga tushirish

Integratsiya Booking.com Connectivity Reservations API (`B.XML`) orqali yangi,
o'zgargan va bekor qilingan bronlarni oladi. Har bir bron tashqi ID bilan
saqlanadi, shuning uchun qayta kelgan xabar dublikat yaratmaydi.

## Booking.com tomonda kerak bo'ladigan ma'lumotlar

Oddiy Extranet login/paroli API uchun ishlamaydi. Booking.com Connectivity
Portal'da token-based machine account va Reservations API ruxsati kerak:

- `Client ID`
- `Client Secret`
- hotel/property ID
- har bir Booking.com room type'ning raqamli IDsi

Hotel Booking.com'da avvaldan ishlayotgani API ruxsati avtomatik ochilganini
anglatmaydi. Agar Connectivity Portal ko'rinmasa, Booking.com account manager
yoki Connectivity Support orqali ruxsat olinadi.

## Backend sozlamasi

`.env.example` dagi Booking qiymatlarini production backend secretlariga
ko'chiring. Xona kategoriyasi xaritasi misoli:

```env
BOOKING_ROOM_TYPE_MAP={"123456":"standart","123457":"lyuks"}
BOOKING_SYNC_ENABLED=true
```

Avval ID va kategoriyalarni kiriting, eng oxirida `BOOKING_SYNC_ENABLED=true`
qiling va backendni qayta ishga tushiring.

## Tekshirish

Administrator tokeni bilan:

- `GET /api/booking/status` — ulanish, navbat va oxirgi xatolar;
- `POST /api/booking/sync` — navbatni qo'lda bir marta tekshirish.

Productionda odatiy sinxronizatsiya har 20 sekundda avtomatik ishlaydi. Bir
nechta backend instance bo'lsa ham MongoDB lock bir vaqtda faqat bittasiga
Booking.com'dan bron olishga ruxsat beradi.

## Muhim xatti-harakatlar

- Booking.com room type ID lokal kategoriya bilan moslanadi.
- Shu kategoriyadagi sanalar kesishmaydigan fizik xona avtomatik tanlanadi.
- Booking bron qilgan unit butun fizik xonani band qiladi.
- Bekor qilingan kelajak broni shaxmatkadan yo'qoladi, lekin audit uchun
  bazada `cancelled` holatda qoladi.
- Allaqachon yashayotgan (`active`) mehmonning Booking bekori resepsiya
  tasdig'isiz avtomatik checkout qilinmaydi.
- Karta raqami/CVC kabi PCI ma'lumotlari umuman saqlanmaydi.
- Narx importi valyuta xatosidan himoya uchun standartda o'chiq.
