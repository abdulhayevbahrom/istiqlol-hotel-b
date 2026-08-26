const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getAccruedStayDays,
  getAccruedGuestAmounts,
  getGuestPayableAmount,
} = require("../controllers/guest.controller");

const guest = {
  status: "active",
  checkInAt: "2026-08-17T17:17:00+05:00",
  checkoutDueAt: "2026-08-29T12:00:00+05:00",
  stayDays: 12,
  dailyRate: 260000,
  paidAmount: 0,
  vip: false,
  services: [],
};

test("active guest total uses elapsed stay days instead of planned stay days", () => {
  const now = new Date("2026-08-25T13:00:00+05:00");

  assert.equal(getAccruedStayDays(guest, now), 9);
  assert.deepEqual(getAccruedGuestAmounts(guest, now), {
    accruedStayDays: 9,
    totalAmount: 2340000,
    debtAmount: 2340000,
  });
});

test("payments reduce accrued debt and services remain included", () => {
  const now = new Date("2026-08-25T13:00:00+05:00");
  const result = getAccruedGuestAmounts(
    {
      ...guest,
      paidAmount: 1000000,
      services: [{ totalAmount: 150000 }],
    },
    now,
  );

  assert.deepEqual(result, {
    accruedStayDays: 9,
    totalAmount: 2490000,
    debtAmount: 1490000,
  });
});

test("accrued days do not exceed the planned stay before checkout", () => {
  const now = new Date("2026-08-29T12:00:00+05:00");

  assert.equal(getAccruedStayDays(guest, now), 12);
});

test("guest can prepay the full planned stay while current debt stays accrued", () => {
  const sixDayGuest = {
    ...guest,
    stayDays: 6,
    dailyRate: 260000,
    totalAmount: 1560000,
    paidAmount: 0,
    checkoutDueAt: "2026-08-23T12:00:00+05:00",
  };

  assert.equal(getGuestPayableAmount(sixDayGuest), 1560000);
});
