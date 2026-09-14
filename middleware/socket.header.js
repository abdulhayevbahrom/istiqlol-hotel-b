const { Server } = require("socket.io");

const normalizeOrigin = (value) => String(value || "").replace(/\/+$/, "");
const allowedOrigins = [
  "https://istiqlolhotel.uz",
  "https://www.istiqlolhotel.uz",
  "https://istiqlol-hotel.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...(process.env.CLIENT_ORIGINS || "").split(","),
]
  .map((origin) => normalizeOrigin(origin.trim()))
  .filter(Boolean);

const io = (server) => {
  return new Server(server, {
    cors: {
      origin(origin, callback) {
        if (origin && allowedOrigins.includes(normalizeOrigin(origin))) {
          return callback(null, true);
        }
        return callback(new Error("Bu domen uchun Socket.IO ruxsati yo'q"));
      },
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  });
};

module.exports = io;
