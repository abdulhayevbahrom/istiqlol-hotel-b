const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getAutomaticCheckoutWindow,
} = require("../jobs/guestBilling.cron");

test("automatic checkout opens one minute before configured checkout time", () => {
  const window = getAutomaticCheckoutWindow(
    new Date("2026-08-26T11:59:20+05:00"),
    "12:00",
  );

  assert.equal(window.isEarlyMinute, true);
  assert.equal(window.isExactMinute, false);
  assert.equal(window.cutoffAt.toISOString(), "2026-08-26T07:00:00.000Z");
  assert.equal(window.key, "2026-08-26-12:00");
});

test("automatic checkout keeps an exact-time fallback", () => {
  const window = getAutomaticCheckoutWindow(
    new Date("2026-08-26T12:00:20+05:00"),
    "12:00",
  );

  assert.equal(window.isEarlyMinute, false);
  assert.equal(window.isExactMinute, true);
  assert.equal(window.key, "2026-08-26-12:00");
});

test("automatic checkout does not run two minutes early", () => {
  const window = getAutomaticCheckoutWindow(
    new Date("2026-08-26T11:58:59+05:00"),
    "12:00",
  );

  assert.equal(window.isEarlyMinute, false);
  assert.equal(window.isExactMinute, false);
});
