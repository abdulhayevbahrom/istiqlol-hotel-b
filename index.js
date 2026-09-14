require("dotenv").config();
const express = require("express");
const path = require("node:path");
const connectDB = require("./config/dbConfig"); // yoki ./utils/connect
const cors = require("cors");
const mongoose = require("mongoose"); // ⬅️ qo‘shamiz
const applyTimezone = require("./model/mongoose-timezone"); // ⬅️ pluginni chaqiramiz
const PORT = process.env.PORT || 8343;
const notfound = require("./middleware/notfound.middleware");
const router = require("./routes/router");
const authMiddleware = require("./middleware/AuthMiddleware");
const {
  createPublicBooking,
} = require("./controllers/publicBooking.controller");
const { getPublicRoomCategories } = require("./controllers/setting.controller");
const { getRooms } = require("./controllers/room.controller");
const { createServer } = require("node:http");
const { startGuestBillingCron } = require("./jobs/guestBilling.cron");

const { startBookingSync } = require("./integrations/booking/booking.service");

const soket = require("./socket");

const app = express();
const server = createServer(app);
const io = require("./middleware/socket.header")(server);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// CORS sozlamalari. Brauzerning Origin qiymatida yakuniy `/` bo'lmaydi,
// shuning uchun domenlarni normallashtirib solishtiramiz.
const normalizeOrigin = (value) => String(value || "").replace(/\/+$/, "");
const allowedOrigins = [
  "https://istiqlolhotel.uz",
  "https://www.istiqlolhotel.uz",
  "https://istiqlol-hotel.vercel.app",
  "https://istiqlol-hotel-website.vercel.app",
  ...(process.env.CLIENT_ORIGINS || "").split(","),
]
  .map((origin) => normalizeOrigin(origin.trim()))
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(normalizeOrigin(origin))) {
      return callback(null, true);
    }
    return callback(new Error("Bu domen uchun CORS ruxsati yo'q"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  credentials: true,
};
app.use(cors(corsOptions));

// ⬇️ Mongoose pluginni shu yerda ulaymiz
mongoose.plugin(applyTimezone);

// Socket.IO sozlamalari
app.set("socket", io);
soket.connect(io);

const getRequestOrigin = (req) => {
  const origin = req.get("origin");
  if (origin) return normalizeOrigin(origin);

  const referer = req.get("referer");
  if (!referer) return "";

  try {
    const url = new URL(referer);
    return normalizeOrigin(url.origin);
  } catch {
    return "";
  }
};

const requireAllowedClientOrigin = (req, res, next) => {
  const requestOrigin = getRequestOrigin(req);
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) return next();

  return res.status(403).json({
    state: false,
    message:
      "So'rov faqat ruxsat berilgan dastur yoki website orqali qabul qilinadi",
    innerData: null,
  });
};

app.use(["/api", "/uploads"], requireAllowedClientOrigin);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.get("/api/rooms", getRooms);
app.get("/api/public/room-categories", getPublicRoomCategories);
app.post("/api/public/booking", createPublicBooking);
app.use("/api", authMiddleware, router); // Routerlarni ulash
app.get("/", (req, res) => res.send("Salom dunyo")); // Bosh sahifa
app.use(notfound); // 404 middleware

// Booking.com navbatini faqat MongoDB tayyor bo'lgandan keyin o'qiymiz.
// Aks holda Booking xabari API navbatidan olinib, lokal bazaga yozilmay qolishi mumkin.
const startServer = async () => {
  try {
    await connectDB();
    startGuestBillingCron(io);
    startBookingSync(io);
    server.listen(PORT, () => console.log(`http://localhost:${PORT}`));
  } catch (error) {
    console.error("Server ishga tushmadi:", error.message);
    process.exitCode = 1;
  }
};

startServer();
