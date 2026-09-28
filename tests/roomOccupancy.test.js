const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveRoomStatus } = require("../utils/roomOccupancy");

test("xona kamida bitta faol mijoz bo'lsa band bo'ladi", () => {
  assert.equal(
    resolveRoomStatus({ currentStatus: "bosh", activeGuestsCount: 1 }),
    "band",
  );
});

test("faol mijoz bo'lmasa xona bo'sh bo'ladi", () => {
  assert.equal(
    resolveRoomStatus({ currentStatus: "band", activeGuestsCount: 0 }),
    "bosh",
  );
});

test("remont holati faol mijoz sonidan qat'i nazar saqlanadi", () => {
  assert.equal(
    resolveRoomStatus({ currentStatus: "remont", activeGuestsCount: 1 }),
    "remont",
  );
});
