const DEFAULT_AUTH_URL =
  "https://connectivity-authentication.booking.com/token-based-authentication/exchange";
const DEFAULT_RESERVATIONS_URL =
  "https://secure-supply-xml.booking.com/hotels/xml/reservations";

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
};

const parseRoomTypeMap = (value) => {
  const text = String(value || "").trim();
  if (!text) return {};

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_error) {
    throw new Error(
      'BOOKING_ROOM_TYPE_MAP JSON bo\'lishi kerak. Masalan: {"12345":"standart"}',
    );
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("BOOKING_ROOM_TYPE_MAP obyekt bo'lishi kerak");
  }

  return Object.fromEntries(
    Object.entries(parsed)
      .map(([roomTypeId, category]) => [
        String(roomTypeId || "").trim(),
        String(category || "").trim(),
      ])
      .filter(([roomTypeId, category]) => roomTypeId && category),
  );
};

const getBookingConfig = (env = process.env) => {
  const enabled = parseBoolean(env.BOOKING_SYNC_ENABLED, false);
  const config = {
    enabled,
    clientId: String(env.BOOKING_CLIENT_ID || "").trim(),
    clientSecret: String(env.BOOKING_CLIENT_SECRET || "").trim(),
    hotelId: String(env.BOOKING_HOTEL_ID || "").trim(),
    roomTypeMap: parseRoomTypeMap(env.BOOKING_ROOM_TYPE_MAP),
    allowNameFallback: parseBoolean(env.BOOKING_ALLOW_NAME_FALLBACK, false),
    importPrices: parseBoolean(env.BOOKING_IMPORT_PRICES, false),
    localCurrency: String(env.BOOKING_LOCAL_CURRENCY || "UZS")
      .trim()
      .toUpperCase(),
    pollIntervalMs: Math.max(
      Number(env.BOOKING_POLL_INTERVAL_MS || 20_000),
      20_000,
    ),
    requestTimeoutMs: Math.max(
      Number(env.BOOKING_REQUEST_TIMEOUT_MS || 15_000),
      1_000,
    ),
    authUrl: String(env.BOOKING_AUTH_URL || DEFAULT_AUTH_URL).trim(),
    reservationsUrl: String(
      env.BOOKING_RESERVATIONS_URL || DEFAULT_RESERVATIONS_URL,
    ).trim(),
  };

  if (enabled) {
    const missing = [];
    if (!config.clientId) missing.push("BOOKING_CLIENT_ID");
    if (!config.clientSecret) missing.push("BOOKING_CLIENT_SECRET");
    if (!config.hotelId) missing.push("BOOKING_HOTEL_ID");
    if (!Object.keys(config.roomTypeMap).length && !config.allowNameFallback) {
      missing.push("BOOKING_ROOM_TYPE_MAP");
    }
    if (missing.length) {
      throw new Error(`Booking.com sozlamalari yetishmaydi: ${missing.join(", ")}`);
    }
  }

  return config;
};

module.exports = {
  DEFAULT_AUTH_URL,
  DEFAULT_RESERVATIONS_URL,
  getBookingConfig,
  parseBoolean,
  parseRoomTypeMap,
};
