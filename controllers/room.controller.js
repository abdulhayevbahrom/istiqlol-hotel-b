const Room = require("../model/Room");
const Guest = require("../model/Guest");
const response = require("../utils/response");

const parseLegacyRoomNumber = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  const match = raw.match(/^(\d+)([AB])$/);
  if (!match) return { roomNumber: raw, korpus: "" };
  return { roomNumber: match[1], korpus: match[2] };
};

const normalizeRoomNumber = (value) => parseLegacyRoomNumber(value).roomNumber;
const normalizeKorpus = (value) => {
  const text = String(value || "").trim().toUpperCase();
  return ["A", "B"].includes(text) ? text : "";
};
const getOccupancyStatus = (activeCount, capacity) =>
  activeCount >= capacity ? "band" : "bosh";

const createRoom = async (req, res) => {
  try {
    const payload = { ...req.body };
    const legacy = parseLegacyRoomNumber(payload.roomNumber);
    payload.roomNumber = legacy.roomNumber;
    payload.korpus = normalizeKorpus(payload.korpus || legacy.korpus);
    if (!payload.korpus) {
      return response.error(res, "Korpus A yoki B bo'lishi kerak");
    }

    const exists = await Room.findOne({
      roomNumber: payload.roomNumber,
      korpus: payload.korpus,
    });
    if (exists) return response.error(res, "Bu xona raqami allaqachon mavjud");

    const room = await Room.create({
      ...payload,
      activeGuestsCount: 0,
      status: "bosh",
    });
    return response.created(res, "Xona muvaffaqiyatli qo'shildi", room);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const getRooms = async (_, res) => {
  try {
    const rooms = await Room.find().sort({ korpus: 1, floor: 1, roomNumber: 1 });
    return response.success(res, "Xonalar ro'yxati", rooms);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const getRoomById = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return response.notFound(res, "Xona topilmadi");
    return response.success(res, "Xona ma'lumotlari", room);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const updateRoom = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };
    const current = await Room.findById(id);

    if (!current) return response.notFound(res, "Xona topilmadi");

    if (updates.roomNumber) {
      const legacy = parseLegacyRoomNumber(updates.roomNumber);
      const normalized = legacy.roomNumber;
      const korpusToCheck = normalizeKorpus(updates.korpus || current.korpus);
      const exists = await Room.findOne({
        roomNumber: normalized,
        korpus: korpusToCheck,
        _id: { $ne: id },
      });
      if (exists) return response.error(res, "Bu xona raqami allaqachon mavjud");
      updates.roomNumber = normalized;
      if (!updates.korpus && legacy.korpus) {
        updates.korpus = legacy.korpus;
      }
    }
    if (updates.korpus) {
      const normalizedKorpus = normalizeKorpus(updates.korpus);
      if (!normalizedKorpus) return response.error(res, "Korpus A yoki B bo'lishi kerak");
      updates.korpus = normalizedKorpus;
      if (current.roomNumber) {
        const exists = await Room.findOne({
          roomNumber: updates.roomNumber || current.roomNumber,
          korpus: normalizedKorpus,
          _id: { $ne: id },
        });
        if (exists) return response.error(res, "Bu xona raqami allaqachon mavjud");
      }
    }

    const room = await Room.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    if (
      Object.prototype.hasOwnProperty.call(updates, "capacity") ||
      Object.prototype.hasOwnProperty.call(updates, "status")
    ) {
      const activeCount = await Guest.countDocuments({
        room: room._id,
        status: "active",
      });
      room.activeGuestsCount = activeCount;
      if (room.status !== "remont") {
        room.status = getOccupancyStatus(activeCount, room.capacity);
      }
      await room.save();
    }

    return response.success(res, "Xona yangilandi", room);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const deleteRoom = async (req, res) => {
  try {
    const room = await Room.findByIdAndDelete(req.params.id);
    if (!room) return response.notFound(res, "Xona topilmadi");
    return response.success(res, "Xona o'chirildi");
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

module.exports = {
  createRoom,
  getRooms,
  getRoomById,
  updateRoom,
  deleteRoom,
};
