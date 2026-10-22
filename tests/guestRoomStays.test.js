const test = require("node:test");
const assert = require("node:assert/strict");
const {
  recordRoomTransfer,
  recordRoomChangeOnResume,
  getRoomAt,
} = require("../utils/guestRoomStays");
const { getRatesAfterRoomTransfer, getLodgingTotal } = require("../utils/guestDailyRates");

test("room transfer keeps the first three days in the old room", () => {
  const guest = {
    status: "active",
    checkInAt: new Date("2026-09-01T09:00:00+05:00"),
    roomStays: [],
  };

  recordRoomTransfer(
    guest,
    "room-200",
    "room-201",
    new Date("2026-09-04T09:00:00+05:00"),
  );

  assert.deepEqual(guest.roomStays.map((stay) => ({
    room: stay.room,
    from: stay.from.toISOString(),
    to: stay.to?.toISOString() || null,
  })), [
    { room: "room-200", from: "2026-09-01T04:00:00.000Z", to: "2026-09-04T04:00:00.000Z" },
    { room: "room-201", from: "2026-09-04T04:00:00.000Z", to: null },
  ]);
});

test("another transfer closes only the current room segment", () => {
  const guest = {
    status: "active",
    checkInAt: new Date("2026-09-01T09:00:00+05:00"),
    roomStays: [
      { room: "room-200", from: new Date("2026-09-01T09:00:00+05:00"), to: new Date("2026-09-04T09:00:00+05:00") },
      { room: "room-201", from: new Date("2026-09-04T09:00:00+05:00"), to: null },
    ],
  };

  recordRoomTransfer(guest, "room-201", "room-202", new Date("2026-09-05T09:00:00+05:00"));

  assert.equal(guest.roomStays.length, 3);
  assert.equal(guest.roomStays[0].room, "room-200");
  assert.equal(guest.roomStays[1].to.toISOString(), "2026-09-05T04:00:00.000Z");
  assert.equal(guest.roomStays[2].room, "room-202");
  assert.equal(guest.roomStays[2].to, null);
});

test("daily report attributes a guest to exactly one room at the report time", () => {
  const guest = {
    room: "room-201",
    roomStays: [
      { room: "room-200", from: "2026-09-01T09:00:00+05:00", to: "2026-09-04T09:00:00+05:00" },
      { room: "room-201", from: "2026-09-04T09:00:00+05:00", to: null },
    ],
  };
  assert.equal(getRoomAt(guest, "2026-09-03T23:59:00+05:00"), "room-200");
  assert.equal(getRoomAt(guest, "2026-09-04T09:00:00+05:00"), "room-201");
});

test("resuming in a room selected after checkout updates room history", () => {
  const guest = {
    room: "room-212",
    checkInAt: new Date("2026-09-23T13:53:00+05:00"),
    checkOutAt: new Date("2026-10-18T12:00:00+05:00"),
    roomStays: [
      {
        room: "room-206",
        from: new Date("2026-09-23T13:53:00+05:00"),
        to: new Date("2026-10-13T19:03:00+05:00"),
      },
      {
        room: "room-304",
        from: new Date("2026-10-13T19:03:00+05:00"),
        to: null,
      },
    ],
  };

  const changed = recordRoomChangeOnResume(
    guest,
    new Date("2026-10-19T07:41:00+05:00"),
  );

  assert.equal(changed, true);
  assert.deepEqual(guest.roomStays.map((stay) => ({
    room: stay.room,
    from: stay.from.toISOString(),
    to: stay.to?.toISOString() || null,
  })), [
    {
      room: "room-206",
      from: "2026-09-23T08:53:00.000Z",
      to: "2026-10-13T14:03:00.000Z",
    },
    {
      room: "room-304",
      from: "2026-10-13T14:03:00.000Z",
      to: "2026-10-18T07:00:00.000Z",
    },
    {
      room: "room-212",
      from: "2026-10-19T02:41:00.000Z",
      to: null,
    },
  ]);
});

test("resuming in the same room does not duplicate room history", () => {
  const guest = {
    room: "room-304",
    checkOutAt: new Date("2026-10-18T12:00:00+05:00"),
    roomStays: [
      {
        room: "room-304",
        from: new Date("2026-10-13T19:03:00+05:00"),
        to: null,
      },
    ],
  };

  assert.equal(
    recordRoomChangeOnResume(guest, new Date("2026-10-19T07:41:00+05:00")),
    false,
  );
  assert.equal(guest.roomStays.length, 1);
  assert.equal(guest.roomStays[0].to, null);
});

test("room transfer preserves old room prices and applies new price to remaining days", () => {
  const guest = { stayDays: 5, dailyRate: 300000, dailyRates: [] };
  const dailyRates = getRatesAfterRoomTransfer(guest, 4, 200000);
  assert.deepEqual(dailyRates.map((item) => item.amount), [300000, 300000, 300000, 200000, 200000]);
  assert.equal(getLodgingTotal({ ...guest, dailyRate: 200000, dailyRates }, 5), 1300000);
});
