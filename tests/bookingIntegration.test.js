const test = require("node:test");
const assert = require("node:assert/strict");
const { getBookingConfig } = require("../integrations/booking/booking.config");
const {
  parseReservationsXml,
} = require("../integrations/booking/booking.parser");
const {
  calendarStayDays,
  compareEventOrder,
  resolveRoomCategory,
  splitFullName,
} = require("../integrations/booking/booking.service");

const sampleXml = `
<reservations>
  <reservation>
    <booked_at>2026-08-20T11:15:36+00:00</booked_at>
    <modified_at>2026-08-20T11:16:00+00:00</modified_at>
    <currencycode>UZS</currencycode>
    <customer>
      <first_name>Ali</first_name>
      <last_name>Valiyev</last_name>
      <email>ali@example.com</email>
      <telephone>+998900000000</telephone>
      <countrycode>uz</countrycode>
      <cc_number>4111111111111111</cc_number>
      <cc_cvc>123</cc_cvc>
    </customer>
    <hotel_id>777</hotel_id>
    <id>991122</id>
    <room>
      <arrival_date>2026-09-01</arrival_date>
      <departure_date>2026-09-04</departure_date>
      <guest_name>Ali Valiyev</guest_name>
      <id>1001</id>
      <name>Standart</name>
      <roomreservation_id>50001</roomreservation_id>
      <totalprice>1200000</totalprice>
      <currencycode>UZS</currencycode>
    </room>
    <room>
      <arrival_date>2026-09-01</arrival_date>
      <departure_date>2026-09-04</departure_date>
      <guest_name>Vali Aliyev</guest_name>
      <id>1002</id>
      <name>Lyuks</name>
      <roomreservation_id>50002</roomreservation_id>
      <totalprice>1800000</totalprice>
      <currencycode>UZS</currencycode>
    </room>
    <status>new</status>
    <totalprice>3000000</totalprice>
  </reservation>
</reservations>`;

test("Booking B.XML response is normalized into safe reservation units", () => {
  const [reservation] = parseReservationsXml(sampleXml);
  assert.equal(reservation.reservationId, "991122");
  assert.equal(reservation.hotelId, "777");
  assert.equal(reservation.status, "new");
  assert.equal(reservation.rooms.length, 2);
  assert.equal(reservation.rooms[0].unitId, "991122:50001");
  assert.equal(reservation.rooms[1].roomTypeId, "1002");
  assert.equal(reservation.rooms[1].totalAmount, 1800000);
  assert.equal(reservation.customer.countryCode, "UZ");
  assert.equal(reservation.customer.cc_number, undefined);
  assert.equal(reservation.customer.cc_cvc, undefined);
  assert.match(reservation.fingerprint, /^[a-f0-9]{64}$/);
});

test("same Booking message gets the same idempotency fingerprint", () => {
  const first = parseReservationsXml(sampleXml)[0];
  const second = parseReservationsXml(sampleXml)[0];
  assert.equal(first.fingerprint, second.fingerprint);

  const modified = parseReservationsXml(
    sampleXml.replace("<status>new</status>", "<status>modified</status>"),
  )[0];
  assert.notEqual(first.fingerprint, modified.fingerprint);
});

test("empty Booking reservation queue is a successful empty result", () => {
  assert.deepEqual(parseReservationsXml("<reservations/>"), []);
  assert.deepEqual(parseReservationsXml("<reservations></reservations>"), []);
});

test("Booking configuration enforces the official 20 second polling floor", () => {
  const config = getBookingConfig({
    BOOKING_SYNC_ENABLED: "true",
    BOOKING_CLIENT_ID: "client",
    BOOKING_CLIENT_SECRET: "secret",
    BOOKING_HOTEL_ID: "777",
    BOOKING_ROOM_TYPE_MAP: '{"1001":"standart"}',
    BOOKING_POLL_INTERVAL_MS: "1000",
  });
  assert.equal(config.pollIntervalMs, 20_000);
  assert.deepEqual(config.roomTypeMap, { 1001: "standart" });
});

test("room type ID mapping wins and exact name fallback is optional", () => {
  const explicitConfig = {
    roomTypeMap: { 1001: "standart" },
    allowNameFallback: false,
  };
  assert.equal(
    resolveRoomCategory(
      { roomTypeId: "1001", roomName: "Other name" },
      explicitConfig,
      ["standart", "lyuks"],
    ),
    "standart",
  );
  assert.equal(
    resolveRoomCategory(
      { roomTypeId: "unknown", roomName: "Lyuks" },
      { roomTypeMap: {}, allowNameFallback: true },
      ["standart", "lyuks"],
    ),
    "lyuks",
  );
});

test("hotel stay duration uses calendar nights and guest names stay valid", () => {
  assert.equal(calendarStayDays("2026-09-01", "2026-09-04"), 3);
  assert.deepEqual(splitFullName("Madina"), {
    firstname: "Madina",
    lastname: "-",
  });
});

test("newer modification or cancellation supersedes a retrying old event", () => {
  const events = [
    {
      reservationStatus: "new",
      externalModifiedAt: new Date("2026-08-20T10:00:00Z"),
      createdAt: new Date("2026-08-20T10:00:01Z"),
    },
    {
      reservationStatus: "modified",
      externalModifiedAt: new Date("2026-08-20T11:00:00Z"),
      createdAt: new Date("2026-08-20T11:00:01Z"),
    },
    {
      reservationStatus: "cancelled",
      externalModifiedAt: new Date("2026-08-20T11:00:00Z"),
      createdAt: new Date("2026-08-20T11:00:02Z"),
    },
  ];
  events.sort(compareEventOrder);
  assert.equal(events[0].reservationStatus, "cancelled");
  assert.equal(events[2].reservationStatus, "new");
});
