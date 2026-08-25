const { parseReservationsXml } = require("./booking.parser");

const escapeXml = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const fetchWithTimeout = async (url, options, timeoutMs) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const readJwtExpiry = (token) => {
  try {
    const encoded = String(token || "").split(".")[1];
    if (!encoded) return 0;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return Number(payload.exp || 0) * 1000;
  } catch (_error) {
    return 0;
  }
};

class BookingClient {
  constructor(config) {
    this.config = config;
    this.token = "";
    this.tokenExpiresAt = 0;
  }

  async getAccessToken() {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.token;
    }

    const response = await fetchWithTimeout(
      this.config.authUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        }),
      },
      this.config.requestTimeoutMs,
    );
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`Booking.com autentifikatsiya xatosi: HTTP ${response.status}`);
    }

    let body;
    try {
      body = JSON.parse(bodyText);
    } catch (_error) {
      throw new Error("Booking.com autentifikatsiya javobi JSON emas");
    }

    if (!body.jwt) throw new Error("Booking.com autentifikatsiya javobida JWT yo'q");
    this.token = String(body.jwt);
    this.tokenExpiresAt = readJwtExpiry(this.token) || Date.now() + 50 * 60_000;
    return this.token;
  }

  async fetchReservations() {
    const token = await this.getAccessToken();
    const response = await fetchWithTimeout(
      this.config.reservationsUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/xml; charset=UTF-8",
          Accept: "application/xml",
          "User-Agent": "Istiqlol-Hotel-PMS/1.0",
        },
        body: `<request><hotel_id>${escapeXml(this.config.hotelId)}</hotel_id></request>`,
      },
      this.config.requestTimeoutMs,
    );
    const xml = await response.text();
    if (!response.ok) {
      if (response.status === 401) {
        this.token = "";
        this.tokenExpiresAt = 0;
      }
      throw new Error(`Booking.com reservations xatosi: HTTP ${response.status}`);
    }
    return parseReservationsXml(xml);
  }
}

module.exports = {
  BookingClient,
  escapeXml,
  fetchWithTimeout,
  readJwtExpiry,
};
