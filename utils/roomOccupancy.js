const mongoose = require("mongoose");
const Guest = require("../model/Guest");
const Room = require("../model/Room");

const normalizeRoomIds = (roomIds = []) => [
  ...new Set(
    roomIds
      .map((id) => String(id || "").trim())
      .filter((id) => mongoose.Types.ObjectId.isValid(id)),
  ),
];

const syncRoomsOccupancyByIds = async (roomIds = []) => {
  const normalizedIds = normalizeRoomIds(roomIds);
  if (!normalizedIds.length) return;
  const objectRoomIds = normalizedIds.map((id) => new mongoose.Types.ObjectId(id));

  const [rooms, activeStates] = await Promise.all([
    Room.find({ _id: { $in: objectRoomIds } })
      .select("_id capacity status activeGuestsCount")
      .lean(),
    Guest.aggregate([
      { $match: { status: "active", room: { $in: objectRoomIds } } },
      {
        $group: {
          _id: "$room",
          count: { $sum: 1 },
          blocksWholeRoom: {
            $max: { $cond: [{ $eq: ["$blocksWholeRoom", true] }, 1, 0] },
          },
        },
      },
    ]),
  ]);

  const activeMap = new Map(
    activeStates.map((item) => [
      String(item?._id || ""),
      {
        count: Number(item?.count || 0),
        blocksWholeRoom: Boolean(item?.blocksWholeRoom),
      },
    ]),
  );

  const ops = [];
  for (const room of rooms) {
    const state = activeMap.get(String(room._id)) || {
      count: 0,
      blocksWholeRoom: false,
    };
    const nextStatus =
      room.status === "remont"
        ? "remont"
        : state.blocksWholeRoom || state.count >= Number(room.capacity || 0)
          ? "band"
          : "bosh";

    if (
      Number(room.activeGuestsCount || 0) === state.count &&
      String(room.status || "") === nextStatus
    ) {
      continue;
    }

    ops.push({
      updateOne: {
        filter: { _id: room._id },
        update: {
          $set: { activeGuestsCount: state.count, status: nextStatus },
        },
      },
    });
  }

  if (ops.length) await Room.bulkWrite(ops, { ordered: false });
};

module.exports = {
  normalizeRoomIds,
  syncRoomsOccupancyByIds,
};
