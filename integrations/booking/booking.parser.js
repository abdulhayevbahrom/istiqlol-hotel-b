const crypto = require("node:crypto");
const { XMLParser } = require("fast-xml-parser");

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  isArray: (_tagName, jPath) =>
    ["reservations.reservation", "reservations.reservation.room"].includes(jPath),
});

const asArray = (value) => {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
};

const textValue = (value) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return String(value["#text"] || "").trim();
  return String(value).trim();
};

const numberValue = (value) => {
  const parsed = Number(textValue(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeStatus = (value) => {
  const status = textValue(value).toLowerCase();
  return ["new", "modified", "cancelled"].includes(status) ? status : "new";
};

const normalizeRoom = (room, index, reservationId, fallbackCurrency) => {
  const roomReservationId = textValue(room?.roomreservation_id);
  return {
    unitId: roomReservationId
      ? `${reservationId}:${roomReservationId}`
      : `${reservationId}:room-${index + 1}`,
    roomReservationId,
    roomTypeId: textValue(room?.id),
    roomName: textValue(room?.name),
    guestName: textValue(room?.guest_name),
    arrivalDate: textValue(room?.arrival_date),
    departureDate: textValue(room?.departure_date),
    guestCount: Math.max(numberValue(room?.numberofguests), 1),
    totalAmount: numberValue(room?.totalprice ?? room?.total_price),
    currency: (textValue(room?.currencycode) || fallbackCurrency).toUpperCase(),
    remarks: textValue(room?.remarks),
  };
};

const normalizeReservation = (reservation) => {
  const reservationId = textValue(reservation?.id);
  const currency = textValue(reservation?.currencycode).toUpperCase();
  const customer = reservation?.customer || {};
  const rooms = asArray(reservation?.room).map((room, index) =>
    normalizeRoom(room, index, reservationId, currency),
  );

  const normalized = {
    reservationId,
    hotelId: textValue(reservation?.hotel_id),
    status: normalizeStatus(reservation?.status),
    bookedAt: textValue(reservation?.booked_at) || [
      textValue(reservation?.date),
      textValue(reservation?.time),
    ].filter(Boolean).join("T"),
    modifiedAt:
      textValue(reservation?.modified_at) ||
      textValue(reservation?.booked_at) ||
      textValue(reservation?.date),
    currency,
    totalAmount: numberValue(
      reservation?.totalprice ?? reservation?.total_price,
    ),
    customer: {
      firstname: textValue(customer?.first_name),
      lastname: textValue(customer?.last_name),
      email: textValue(customer?.email),
      phone: textValue(customer?.telephone),
      countryCode: textValue(customer?.countrycode).toUpperCase(),
      organization: textValue(customer?.company),
      remarks: textValue(customer?.remarks),
    },
    rooms,
  };

  normalized.fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
  return normalized;
};

const parseReservationsXml = (xml) => {
  let parsed;
  try {
    parsed = xmlParser.parse(String(xml || ""));
  } catch (error) {
    throw new Error(`Booking.com XML javobini o'qib bo'lmadi: ${error.message}`);
  }

  if (!Object.prototype.hasOwnProperty.call(parsed || {}, "reservations")) {
    throw new Error("Booking.com javobida reservations elementi yo'q");
  }
  const root = parsed.reservations;
  // Navbat bo'sh bo'lganda Booking.com <reservations/> qaytaradi.
  if (root === "" || root === null) return [];

  if (root.fault) {
    const code = root.fault?.["@_code"] || "unknown";
    const message = root.fault?.["@_string"] || textValue(root.fault);
    throw new Error(`Booking.com API xatosi (${code}): ${message}`);
  }

  return asArray(root?.reservation)
    .map(normalizeReservation)
    .filter((reservation) => reservation.reservationId);
};

module.exports = {
  asArray,
  normalizeReservation,
  parseReservationsXml,
  textValue,
};
