const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");

const PURPLE = "#4c2cac";
const PALE = "#eee9f6";
const TEXT = "#444444";
const BORDER = "#d9d4df";
const HOTEL_NAME = "Istiqlol Hotel Namangan";
const HOTEL_ADDRESS = "Namangan shahri, Islom Karimov ko'chasi, 20-uy";
const HOTEL_PHONE = "+998 78 223 00 15 - Administrator 24/7";
const HOTEL_EMAIL = "hotel.istiqlol@mail.ru";
const COPY = {
  uz: {
    confirmation: "Bron tasdiqnomasi", bookingNumber: "Bron raqami", bookedAt: "Bron qilingan vaqt", address: "Manzil", phone: "Telefon", email: "Email",
    details: "Bron tafsilotlari", checkIn: "Kelish", checkOut: "Ketish", nights: "Kecha", guests: "Mehmon", rooms: "Xona", customer: "MIJOZ MA'LUMOTLARI",
    fullName: "F.I.SH.", phoneEmail: "Telefon / email", price: "Bron narxi", tariff: "Tarif", resident: "O'zbekiston rezidenti tarifi", nonresident: "Norezident tarifi",
    total: "Jami", paymentType: "To'lov turi", payAtHotel: "Mehmonxonaga kelganda to'lanadi", prepaid: "Oldindan to'lov", amountDue: "Mehmon to'lashi kerak",
    selectedRooms: "Tanlangan xonalar", room: "xona", capacity: "Sig'imi", person: "kishi", guest: "Mehmon", roomPrice: "Narx", night: "kecha",
    location: "Mehmonxona joylashuvi", generated: "Hujjat Istiqlol Suite tizimida avtomatik yaratildi", confirmed: "Bron tasdiqlandi",
    greeting: "Assalomu alaykum", success: "Broningiz muvaffaqiyatli qabul qilindi.", attached: "PMS shaxmatkadagi bron qog'ozi formatidagi PDF ushbu xatga biriktirildi.", open: "Bron qog'ozini ochish",
    categories: { standart: "Standart xona", polulyuks: "Polulyuks", lyuks: "Lyuks", apartament: "Apartament", bir_kishilik: "Bir kishilik xona" },
  },
  ru: {
    confirmation: "Подтверждение бронирования", bookingNumber: "Номер бронирования", bookedAt: "Дата и время бронирования", address: "Адрес", phone: "Телефон", email: "Эл. почта",
    details: "Детали бронирования", checkIn: "Заезд", checkOut: "Выезд", nights: "Ночей", guests: "Гостей", rooms: "Номеров", customer: "ДАННЫЕ ЗАКАЗЧИКА",
    fullName: "Ф.И.О.", phoneEmail: "Телефон / эл. почта", price: "Стоимость бронирования", tariff: "Тариф", resident: "Тариф для резидентов Узбекистана", nonresident: "Тариф для нерезидентов",
    total: "Общая стоимость", paymentType: "Способ оплаты", payAtHotel: "Оплата при заселении", prepaid: "Внесена предоплата", amountDue: "К оплате гостем",
    selectedRooms: "Выбранные номера", room: "номер", capacity: "Вместимость", person: "чел.", guest: "Гость", roomPrice: "Стоимость", night: "ноч.",
    location: "Местоположение отеля", generated: "Документ автоматически сформирован в Istiqlol Suite", confirmed: "Бронирование подтверждено",
    greeting: "Здравствуйте", success: "Ваше бронирование успешно принято.", attached: "PDF в формате документа бронирования из шахматки PMS прикреплен к этому письму.", open: "Открыть документ бронирования",
    categories: { standart: "Стандартный номер", polulyuks: "Полулюкс", lyuks: "Люкс", apartament: "Апартаменты", bir_kishilik: "Одноместный номер" },
  },
  en: {
    confirmation: "Booking confirmation", bookingNumber: "Booking number", bookedAt: "Booking date and time", address: "Address", phone: "Phone", email: "Email",
    details: "Booking details", checkIn: "Check-in", checkOut: "Check-out", nights: "Nights", guests: "Guests", rooms: "Rooms", customer: "CUSTOMER DETAILS",
    fullName: "Full name", phoneEmail: "Phone / email", price: "Booking price", tariff: "Rate", resident: "Uzbekistan resident rate", nonresident: "Non-resident rate",
    total: "Total", paymentType: "Payment method", payAtHotel: "Pay at the hotel", prepaid: "Prepayment", amountDue: "Amount due at the hotel",
    selectedRooms: "Selected rooms", room: "room", capacity: "Capacity", person: "guest(s)", guest: "Guest", roomPrice: "Price", night: "night(s)",
    location: "Hotel location", generated: "This document was generated automatically by Istiqlol Suite", confirmed: "Booking confirmed",
    greeting: "Hello", success: "Your booking has been successfully received.", attached: "The PDF matching the PMS booking document format is attached to this email.", open: "Open booking document",
    categories: { standart: "Standard room", polulyuks: "Junior suite", lyuks: "Suite", apartament: "Apartment", bir_kishilik: "Single room" },
  },
};
const LOGO_PATH = path.resolve(__dirname, "../../frontend/src/assets/istiqlol-hotel-logo.png");
const MAP_PATH = path.resolve(__dirname, "../../frontend/src/assets/istiqlol-hotel-map.png");
const firstExisting = (paths) => paths.find((filePath) => fs.existsSync(filePath));
const FONT_REGULAR_PATH = firstExisting(["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf"]);
const FONT_BOLD_PATH = firstExisting(["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"]);

const createPublicToken = () => crypto.randomBytes(32).toString("hex");
const hashPublicToken = (token) => crypto.createHash("sha256").update(String(token || "")).digest("hex");
const createBookingReference = () => `IH-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
const getWebsiteUrl = () => String(process.env.PUBLIC_WEBSITE_URL || "https://istiqlolhotel.uz").replace(/\/+$/, "");
const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const safeDate = (value) => { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date : null; };
const localeFor = (language) => language === "ru" ? "ru-RU" : language === "en" ? "en-GB" : "uz-UZ";
const formatDate = (value, language) => { const date = safeDate(value); return date ? new Intl.DateTimeFormat(localeFor(language), { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Tashkent" }).format(date) : "-"; };
const formatDateTime = (value, language) => { const date = safeDate(value); return date ? new Intl.DateTimeFormat(localeFor(language), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tashkent" }).format(date) : "-"; };
const formatMoney = (value) => `${Number(value || 0).toLocaleString("uz-UZ")} UZS`;
const getCopy = (language) => COPY[language] || COPY.uz;
const roomName = (category, copy) => copy.categories[String(category || "").trim().toLowerCase()] || String(category || copy.room);

const getTransporter = () => {
  const user = process.env.BOOKING_SMTP_USER || HOTEL_EMAIL;
  const pass = process.env.BOOKING_SMTP_PASS;
  if (!pass) return null;
  return nodemailer.createTransport({ host: process.env.BOOKING_SMTP_HOST || "smtp.mail.ru", port: Number(process.env.BOOKING_SMTP_PORT || 465), secure: String(process.env.BOOKING_SMTP_SECURE || "true") !== "false", auth: { user, pass } });
};

const box = (doc, x, y, width, height, fill, stroke = fill) => doc.save().rect(x, y, width, height).fillAndStroke(fill, stroke).restore();
const label = (doc, value, x, y, options = {}) => {
  const { bold = false, color = TEXT, size = 9, ...rest } = options;
  doc.font(bold ? (FONT_BOLD_PATH ? "IstiqlolBold" : "Helvetica-Bold") : (FONT_REGULAR_PATH ? "IstiqlolRegular" : "Helvetica")).fontSize(size).fillColor(color).text(String(value ?? "-"), x, y, rest);
};
const pageChrome = (doc, reference, page, copy) => {
  label(doc, `${copy.confirmation}. ${copy.bookingNumber}: ${reference}`, 48, 18, { size: 8, color: "#111", align: "center", width: 499 });
  label(doc, `${page}/2`, 48, 812, { size: 8, color: "#111", align: "right", width: 499 });
};
const drawHeader = (doc, booking) => {
  const copy = getCopy(booking.language);
  box(doc, 48, 36, 499, 92, PURPLE);
  label(doc, copy.confirmation, 62, 51, { size: 21, color: "#fff" });
  label(doc, `${copy.bookingNumber}: ${booking.reference}`, 62, 81, { size: 13, bold: true, color: "#fff" });
  label(doc, `${copy.bookedAt}: ${formatDateTime(booking.createdAt || new Date(), booking.language)} (UTC +05:00)`, 62, 105, { size: 8, color: "#fff" });
};
const drawHotel = (doc, booking) => {
  const copy = getCopy(booking.language);
  label(doc, HOTEL_NAME, 62, 148, { size: 15, bold: true, color: PURPLE });
  [[copy.address, HOTEL_ADDRESS], [copy.phone, HOTEL_PHONE], [copy.email, HOTEL_EMAIL]].forEach(([key, value], index) => {
    label(doc, key, 62, 178 + index * 16, { size: 8, color: "#666" });
    label(doc, value, 108, 178 + index * 16, { size: 8, width: 300 });
  });
  if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, 452, 148, { fit: [76, 72], align: "center", valign: "center" });
  else { doc.circle(488, 180, 25).fill(PURPLE); label(doc, "IH", 466, 169, { size: 17, bold: true, color: "#fff", width: 44, align: "center" }); }
  doc.save().moveTo(62, 232).lineTo(533, 232).dash(3, { space: 3 }).strokeColor("#ccc").stroke().restore();
};
const drawStay = (doc, booking) => {
  const copy = getCopy(booking.language);
  const rooms = booking.rooms || [];
  const nights = Math.max(Number(rooms[0]?.stayDays || 1), 1);
  label(doc, copy.details, 62, 250, { size: 15, color: PURPLE });
  const widths = [138, 132, 65, 65, 71];
  const values = [[copy.checkIn, formatDate(booking.checkIn, booking.language)], [copy.checkOut, formatDate(booking.checkOut, booking.language)], [copy.nights, nights], [copy.guests, booking.guestsCount || "-"], [copy.rooms, rooms.length]];
  let x = 62;
  values.forEach(([title, value], index) => { box(doc, x, 278, widths[index], 55, PURPLE, "#fff"); label(doc, title, x + 8, 287, { size: 8, color: "#fff" }); label(doc, value, x + 8, 306, { size: 10, bold: true, color: "#fff", width: widths[index] - 16 }); x += widths[index]; });
};
const drawCustomer = (doc, booking) => {
  const copy = getCopy(booking.language);
  label(doc, copy.customer, 62, 356, { size: 10, bold: true });
  [[copy.fullName, booking.guestName], [copy.phoneEmail, `${booking.phone || "-"}  |  ${booking.email || "-"}`]].forEach(([title, value], index) => { const y = 373 + index * 28; box(doc, 62, y, 471, 28, "#fff", BORDER); label(doc, title, 72, y + 9, { size: 8, color: "#666" }); label(doc, value, 160, y + 8, { size: 9, bold: true, width: 360 }); });
};
const drawCosts = (doc, booking) => {
  const rooms = booking.rooms || [];
  const copy = getCopy(booking.language);
  label(doc, copy.price, 62, 454, { size: 15, color: PURPLE });
  box(doc, 62, 480, 471, 27, PALE, BORDER); label(doc, copy.tariff, 72, 489, { size: 8 }); label(doc, booking.guestType === "chetellik" ? copy.nonresident : copy.resident, 180, 488, { size: 9, bold: true });
  let y = 519;
  rooms.forEach((room, index) => { const total = Number(room.dailyRate || 0) * Math.max(Number(room.stayDays || 1), 1); box(doc, 62, y, 471, 31, index % 2 ? "#fff" : "#f8f6fb", BORDER); label(doc, `${index + 1}. ${roomName(room.category, copy)} - ${room.roomNumber || "-"}`, 72, y + 8, { size: 9, bold: true, width: 280 }); label(doc, formatMoney(total), 386, y + 8, { size: 9, bold: true, align: "right", width: 137 }); y += 31; });
  box(doc, 62, y, 471, 32, PURPLE); label(doc, copy.total, 72, y + 10, { size: 10, bold: true, color: "#fff" }); label(doc, formatMoney(booking.totalAmount), 386, y + 10, { size: 10, bold: true, color: "#fff", align: "right", width: 137 });
  y += 44;
  [[copy.paymentType, copy.payAtHotel], [copy.prepaid, "0 UZS"], [copy.amountDue, formatMoney(booking.totalAmount)]].forEach(([title, value], index) => { label(doc, title, 72, y + index * 24, { size: index === 2 ? 10 : 9, bold: true }); label(doc, value, 300, y + index * 24, { size: index === 2 ? 10 : 9, bold: index === 2, align: "right", width: 223 }); });
};
const drawRooms = (doc, booking) => {
  const rooms = booking.rooms || [];
  const copy = getCopy(booking.language);
  label(doc, copy.selectedRooms, 62, 52, { size: 16, color: PURPLE });
  let y = 82;
  rooms.forEach((room, index) => { const nights = Math.max(Number(room.stayDays || 1), 1); const total = Number(room.dailyRate || 0) * nights; box(doc, 62, y, 471, 34, PURPLE); label(doc, `${index + 1}`, 74, y + 10, { size: 11, bold: true, color: "#fff" }); label(doc, `${roomName(room.category, copy)}, ${copy.room} ${room.roomNumber || "-"}`, 105, y + 9, { size: 11, bold: true, color: "#fff", width: 410 }); y += 34; box(doc, 62, y, 471, 74, "#fff", BORDER); [[copy.capacity, `${room.capacity || "-"} ${copy.person}`], [copy.guest, booking.guestName], [copy.roomPrice, `${formatMoney(room.dailyRate)} x ${nights} ${copy.night} = ${formatMoney(total)}`]].forEach(([title, value], row) => { label(doc, title, 74, y + 12 + row * 21, { size: 8, color: "#666" }); label(doc, value, 170, y + 11 + row * 21, { size: 9, bold: true, width: 340 }); }); y += 90; });
  const locationY = Math.max(y + 12, 410);
  doc.save().moveTo(62, locationY).lineTo(533, locationY).dash(3, { space: 3 }).strokeColor("#ccc").stroke().restore();
  label(doc, copy.location, 62, locationY + 20, { size: 15, color: PURPLE }); label(doc, HOTEL_ADDRESS, 62, locationY + 46, { size: 9, width: 471 });
  if (fs.existsSync(MAP_PATH) && locationY < 620) { doc.image(MAP_PATH, 62, locationY + 70, { fit: [471, 142], align: "center", valign: "center" }); doc.save().rect(62, locationY + 70, 471, 142).strokeColor(PURPLE).stroke().restore(); }
  box(doc, 48, 748, 499, 55, PURPLE); label(doc, `${HOTEL_NAME}\n${HOTEL_ADDRESS}`, 62, 762, { size: 8, color: "#fff", width: 300 }); label(doc, copy.generated, 330, 774, { size: 7, color: "#fff", align: "right", width: 203 });
};

const buildBookingPdfBuffer = (booking) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `Bron ${booking.reference}`, Author: HOTEL_NAME } });
  if (FONT_REGULAR_PATH) doc.registerFont("IstiqlolRegular", FONT_REGULAR_PATH);
  if (FONT_BOLD_PATH) doc.registerFont("IstiqlolBold", FONT_BOLD_PATH);
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
  const copy = getCopy(booking.language);
  pageChrome(doc, booking.reference, 1, copy); drawHeader(doc, booking); drawHotel(doc, booking); drawStay(doc, booking); drawCustomer(doc, booking); drawCosts(doc, booking);
  doc.addPage({ size: "A4", margin: 0 }); pageChrome(doc, booking.reference, 2, copy); drawRooms(doc, booking); doc.end();
});

const sendBookingConfirmationEmail = async ({ email, guestName, reference, token, booking }) => {
  const transporter = getTransporter();
  if (!transporter) return { sent: false, reason: "BOOKING_SMTP_PASS sozlanmagan" };
  const confirmationUrl = `${getWebsiteUrl()}/booking-confirmation/${token}`;
  const copy = getCopy(booking?.language);
  const safeGuestName = escapeHtml(guestName); const safeReference = escapeHtml(reference);
  const pdf = await buildBookingPdfBuffer(booking);
  await transporter.sendMail({
    from: process.env.BOOKING_MAIL_FROM || `Istiqlol Hotel <${process.env.BOOKING_SMTP_USER || HOTEL_EMAIL}>`, to: email, subject: `${copy.confirmed} - ${reference}`,
    text: `${copy.greeting}, ${guestName}. ${copy.success} ${copy.bookingNumber}: ${reference}. ${copy.open}: ${confirmationUrl}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172033"><h2>Istiqlol Hotel</h2><p>${copy.greeting}, <strong>${safeGuestName}</strong>.</p><p>${copy.success}</p><p>${copy.bookingNumber}: <strong>${safeReference}</strong></p><p>${copy.attached}</p><p><a href="${confirmationUrl}" style="display:inline-block;padding:13px 20px;border-radius:8px;background:#bb8b3d;color:#fff;text-decoration:none;font-weight:700">${copy.open}</a></p></div>`,
    attachments: [{ filename: `istiqlol-booking-${reference}.pdf`, content: pdf, contentType: "application/pdf" }],
  });
  return { sent: true, confirmationUrl };
};
const writeBookingPdf = async ({ res, booking }) => {
  const pdf = await buildBookingPdfBuffer(booking);
  res.setHeader("Content-Type", "application/pdf"); res.setHeader("Content-Length", pdf.length); res.setHeader("Content-Disposition", `attachment; filename="istiqlol-booking-${booking.reference}.pdf"`); return res.end(pdf);
};

module.exports = { createPublicToken, hashPublicToken, createBookingReference, sendBookingConfirmationEmail, writeBookingPdf, buildBookingPdfBuffer };
