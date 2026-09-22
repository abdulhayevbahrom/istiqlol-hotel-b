const crypto = require("node:crypto");
const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");

const createPublicToken = () => crypto.randomBytes(32).toString("hex");
const hashPublicToken = (token) => crypto.createHash("sha256").update(String(token || "")).digest("hex");
const createBookingReference = () => `IH-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

const getWebsiteUrl = () => String(process.env.PUBLIC_WEBSITE_URL || "https://istiqlolhotel.uz").replace(/\/+$/, "");
const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));

const getTransporter = () => {
  const user = process.env.BOOKING_SMTP_USER || "hotel.istiqlol@mail.ru";
  const pass = process.env.BOOKING_SMTP_PASS;
  if (!pass) return null;
  return nodemailer.createTransport({
    host: process.env.BOOKING_SMTP_HOST || "smtp.mail.ru",
    port: Number(process.env.BOOKING_SMTP_PORT || 465),
    secure: String(process.env.BOOKING_SMTP_SECURE || "true") !== "false",
    auth: { user, pass },
  });
};

const sendBookingConfirmationEmail = async ({ email, guestName, reference, token }) => {
  const transporter = getTransporter();
  if (!transporter) return { sent: false, reason: "BOOKING_SMTP_PASS sozlanmagan" };
  const confirmationUrl = `${getWebsiteUrl()}/booking-confirmation/${token}`;
  const safeGuestName = escapeHtml(guestName);
  const safeReference = escapeHtml(reference);
  const from = process.env.BOOKING_MAIL_FROM || `Istiqlol Hotel <${process.env.BOOKING_SMTP_USER || "hotel.istiqlol@mail.ru"}>`;
  await transporter.sendMail({
    from,
    to: email,
    subject: `Bron tasdiqlandi - ${reference}`,
    text: `${guestName}, broningiz tasdiqlandi. Bron raqami: ${reference}. Bron qog'ozini ko'rish va yuklab olish: ${confirmationUrl}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172033"><h2>Istiqlol Hotel</h2><p>Assalomu alaykum, <strong>${safeGuestName}</strong>.</p><p>Broningiz muvaffaqiyatli qabul qilindi.</p><p>Bron raqami: <strong>${safeReference}</strong></p><p><a href="${confirmationUrl}" style="display:inline-block;padding:13px 20px;border-radius:8px;background:#bb8b3d;color:#fff;text-decoration:none;font-weight:700">Bron qog'ozini ochish</a></p><p>Ushbu havola orqali bron ma'lumotlarini ko'rishingiz va PDF yuklab olishingiz mumkin.</p></div>`,
  });
  return { sent: true, confirmationUrl };
};

const formatDate = (value) => new Intl.DateTimeFormat("uz-UZ", { dateStyle: "medium", timeZone: "Asia/Tashkent" }).format(new Date(value));
const formatMoney = (value) => `${Number(value || 0).toLocaleString("uz-UZ")} UZS`;

const writeBookingPdf = ({ res, booking }) => {
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Bron ${booking.reference}` } });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="istiqlol-booking-${booking.reference}.pdf"`);
  doc.pipe(res);
  doc.fontSize(24).fillColor("#0e5b76").text("ISTIQLOL HOTEL", { align: "center" });
  doc.moveDown(0.5).fontSize(16).fillColor("#172033").text("Bron tasdiq qogozi", { align: "center" });
  doc.moveDown(1.5).fontSize(11).fillColor("#536179");
  const row = (label, value) => { doc.font("Helvetica-Bold").text(`${label}: `, { continued: true }); doc.font("Helvetica").text(String(value || "-")); doc.moveDown(0.5); };
  row("Bron raqami", booking.reference);
  row("Mehmon", booking.guestName);
  row("Telefon", booking.phone);
  row("Email", booking.email);
  row("Kelish", formatDate(booking.checkIn));
  row("Ketish", formatDate(booking.checkOut));
  row("Xonalar", booking.rooms.map((room) => `${room.category} (${room.capacity} kishilik) - ${room.roomNumber}`).join(", "));
  row("Jami", formatMoney(booking.totalAmount));
  doc.moveDown(1).fillColor("#238b45").font("Helvetica-Bold").text("Broningiz muvaffaqiyatli tasdiqlandi.");
  doc.moveDown(2).fillColor("#536179").font("Helvetica").fontSize(9).text("Istiqlol Hotel | hotel.istiqlol@mail.ru", { align: "center" });
  doc.end();
};

module.exports = { createPublicToken, hashPublicToken, createBookingReference, sendBookingConfirmationEmail, writeBookingPdf };
