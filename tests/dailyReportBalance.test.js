const test = require("node:test");
const assert = require("node:assert/strict");
const moment = require("moment-timezone");
const {
  calculateDailyGuestBalance,
  getDailyActiveGuestFilter,
} = require("../controllers/reports.controller");

const timezone = process.env.APP_TIMEZONE || "Asia/Tashkent";
const reportDay = moment.tz("2026-08-24", "YYYY-MM-DD", timezone);
const dayStart = reportDay.clone().hour(12).toDate();
const nextDayStart = reportDay.clone().add(1, "day").hour(12).toDate();

const calculate = (checkInAt, payments = []) => calculateDailyGuestBalance({
  guest: { checkInAt, payments, dailyRate: 300000 },
  reportDay,
  dayStart,
  nextDayStart,
});

test("new guest starts with zero and carries today's unpaid rate as debt", () => {
  const result = calculate("2026-08-24T13:00:00+05:00");

  assert.deepEqual(result.opening, { prepayment: 0, debt: 0 });
  assert.deepEqual(result.closing, { prepayment: 0, debt: 300000 });
});

test("only payments made during the report day appear in payment columns", () => {
  const result = calculate("2026-08-24T13:00:00+05:00", [
    { amount: 500000, type: "naqd", createdAt: "2026-08-24T14:00:00+05:00" },
  ]);

  assert.equal(result.payments.cash, 500000);
  assert.deepEqual(result.closing, { prepayment: 200000, debt: 0 });
});

test("returning guest opening and closing balances include prior days", () => {
  const result = calculate("2026-08-22T13:00:00+05:00", [
    { amount: 400000, type: "naqd", createdAt: "2026-08-22T13:30:00+05:00" },
    { amount: 250000, type: "karta", createdAt: "2026-08-24T16:00:00+05:00" },
  ]);

  assert.deepEqual(result.opening, { prepayment: 0, debt: 200000 });
  assert.equal(result.payments.card, 250000);
  assert.deepEqual(result.closing, { prepayment: 0, debt: 250000 });
});

test("unused old payment is carried as opening and closing prepayment", () => {
  const result = calculate("2026-08-23T13:00:00+05:00", [
    { amount: 700000, type: "naqd", createdAt: "2026-08-23T14:00:00+05:00" },
  ]);

  assert.deepEqual(result.opening, { prepayment: 400000, debt: 0 });
  assert.deepEqual(result.closing, { prepayment: 100000, debt: 0 });
});

test("payments after the report cutoff are excluded", () => {
  const result = calculate("2026-08-24T13:00:00+05:00", [
    { amount: 300000, type: "bank", createdAt: "2026-08-25T12:00:00+05:00" },
  ]);

  assert.equal(result.payments.transfer, 0);
  assert.deepEqual(result.closing, { prepayment: 0, debt: 300000 });
});

test("checkout exactly at operational day start belongs to the previous day", () => {
  const filter = getDailyActiveGuestFilter({ dayStart, nextDayStart });

  assert.deepEqual(filter, {
    checkInAt: { $lt: nextDayStart },
    $or: [
      { status: "active" },
      { status: "checked_out", checkOutAt: { $gt: dayStart } },
    ],
  });
});

test("daily balance preserves previous per-day rates when current day is higher", () => {
  const result = calculateDailyGuestBalance({
    guest: {
      checkInAt: "2026-08-19T13:00:00+05:00",
      dailyRate: 1950000,
      dailyRates: [
        { day: 1, amount: 360000 },
        { day: 2, amount: 360000 },
        { day: 3, amount: 360000 },
        { day: 4, amount: 360000 },
        { day: 5, amount: 360000 },
        { day: 6, amount: 1950000 },
      ],
      payments: [],
    },
    reportDay,
    dayStart,
    nextDayStart,
  });

  assert.deepEqual(result.opening, { prepayment: 0, debt: 1800000 });
  assert.deepEqual(result.closing, { prepayment: 0, debt: 3750000 });
});
