const Room = require("../model/Room");
const response = require("../utils/response");
const { getHotelSettings } = require("../utils/hotelSettings");
const { syncRoomsOccupancyByIds } = require("../utils/roomOccupancy");

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
const normalizeCategory = (value) => String(value || "").trim();

const createRoom = async (req, res) => {
  try {
    const payload = { ...req.body };
    const hotelSettings = await getHotelSettings();
    const legacy = parseLegacyRoomNumber(payload.roomNumber);
    payload.roomNumber = legacy.roomNumber;
    payload.korpus = normalizeKorpus(payload.korpus || legacy.korpus);
    if (!payload.korpus) {
      return response.error(res, "Korpus A yoki B bo'lishi kerak");
    }
    payload.category = normalizeCategory(payload.category);
    if (!hotelSettings.roomCategories.includes(payload.category)) {
      return response.error(res, "Kategoriya sozlamalarda mavjud emas");
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
    const hotelSettings = await getHotelSettings();

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
    if (Object.prototype.hasOwnProperty.call(updates, "category")) {
      const normalizedCategory = normalizeCategory(updates.category);
      if (!hotelSettings.roomCategories.includes(normalizedCategory)) {
        return response.error(res, "Kategoriya sozlamalarda mavjud emas");
      }
      updates.category = normalizedCategory;
    }

    const room = await Room.findByIdAndUpdate(id, updates, {
      returnDocument: "after",
      runValidators: true,
    });

    if (
      Object.prototype.hasOwnProperty.call(updates, "capacity") ||
      Object.prototype.hasOwnProperty.call(updates, "status")
    ) {
      await syncRoomsOccupancyByIds([room._id]);
    }

    const nextRoom = await Room.findById(room._id);
    return response.success(res, "Xona yangilandi", nextRoom);
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
