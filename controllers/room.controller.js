const Room = require("../model/Room");
const response = require("../utils/response");
const { getHotelSettings } = require("../utils/hotelSettings");
const { syncRoomsOccupancyByIds } = require("../utils/roomOccupancy");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  MAX_ROOM_IMAGES,
  ROOM_IMAGES_DIR,
  removeUploadedFiles,
} = require("../middleware/roomImageUpload.middleware");
const { writeAuditLog } = require("../utils/auditLog");

const parseMultipartPayload = (payload) => {
  const parsed = { ...payload };
  ["floor", "capacity"].forEach((key) => {
    if (typeof parsed[key] === "string") parsed[key] = Number(parsed[key]);
  });
  if (typeof parsed.prices === "string") parsed.prices = JSON.parse(parsed.prices);
  return parsed;
};

const roomImagePaths = (files = []) => files.map((file) => `/uploads/rooms/${file.filename}`);

const deleteRoomImageFiles = async (images = []) => {
  await Promise.all(
    images.map(async (image) => {
      const fileName = path.basename(String(image || ""));
      if (!fileName || fileName !== image.split("/").pop()) return;
      try {
        await fs.unlink(path.join(ROOM_IMAGES_DIR, fileName));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }),
  );
};

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

const roomSnapshot = (room) => {
  if (!room) return null;
  const item =
    typeof room.toObject === "function"
      ? room.toObject({ versionKey: false })
      : room;
  return {
    id: String(item._id || ""),
    roomNumber: item.roomNumber,
    korpus: item.korpus,
    floor: item.floor,
    category: item.category,
    capacity: item.capacity,
    prices: item.prices,
    status: item.status,
    activeGuestsCount: item.activeGuestsCount,
  };
};

const createRoom = async (req, res) => {
  try {
    const payload = parseMultipartPayload(req.body);
    const hotelSettings = await getHotelSettings();
    const legacy = parseLegacyRoomNumber(payload.roomNumber);
    payload.roomNumber = legacy.roomNumber;
    payload.korpus = normalizeKorpus(payload.korpus || legacy.korpus);
    if (!payload.korpus) {
      removeUploadedFiles(req.files);
      return response.error(res, "Korpus A yoki B bo'lishi kerak");
    }
    payload.category = normalizeCategory(payload.category);
    if (!hotelSettings.roomCategories.includes(payload.category)) {
      removeUploadedFiles(req.files);
      return response.error(res, "Kategoriya sozlamalarda mavjud emas");
    }

    const exists = await Room.findOne({
      roomNumber: payload.roomNumber,
      korpus: payload.korpus,
    });
    if (exists) {
      removeUploadedFiles(req.files);
      return response.error(res, "Bu xona raqami allaqachon mavjud");
    }

    const room = await Room.create({
      ...payload,
      images: roomImagePaths(req.files),
      activeGuestsCount: 0,
      status: "bosh",
    });

    await writeAuditLog(req, {
      action: "ROOM_CREATED",
      entity: "Room",
      entityId: room._id,
      description: `${room.korpus}-${room.roomNumber} xona qo'shildi`,
      after: roomSnapshot(room),
    });

    return response.created(res, "Xona muvaffaqiyatli qo'shildi", room);
  } catch (error) {
    removeUploadedFiles(req.files);
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
    const updates = parseMultipartPayload(req.body);
    const current = await Room.findById(id);
    const hotelSettings = await getHotelSettings();

    if (!current) {
      removeUploadedFiles(req.files);
      return response.notFound(res, "Xona topilmadi");
    }
    const before = roomSnapshot(current);

    if (updates.roomNumber) {
      const legacy = parseLegacyRoomNumber(updates.roomNumber);
      const normalized = legacy.roomNumber;
      const korpusToCheck = normalizeKorpus(updates.korpus || current.korpus);
      const exists = await Room.findOne({
        roomNumber: normalized,
        korpus: korpusToCheck,
        _id: { $ne: id },
      });
      if (exists) {
        removeUploadedFiles(req.files);
        return response.error(res, "Bu xona raqami allaqachon mavjud");
      }
      updates.roomNumber = normalized;
      if (!updates.korpus && legacy.korpus) {
        updates.korpus = legacy.korpus;
      }
    }
    if (updates.korpus) {
      const normalizedKorpus = normalizeKorpus(updates.korpus);
      if (!normalizedKorpus) {
        removeUploadedFiles(req.files);
        return response.error(res, "Korpus A yoki B bo'lishi kerak");
      }
      updates.korpus = normalizedKorpus;
      if (current.roomNumber) {
        const exists = await Room.findOne({
          roomNumber: updates.roomNumber || current.roomNumber,
          korpus: normalizedKorpus,
          _id: { $ne: id },
        });
        if (exists) {
          removeUploadedFiles(req.files);
          return response.error(res, "Bu xona raqami allaqachon mavjud");
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(updates, "category")) {
      const normalizedCategory = normalizeCategory(updates.category);
      if (!hotelSettings.roomCategories.includes(normalizedCategory)) {
        removeUploadedFiles(req.files);
        return response.error(res, "Kategoriya sozlamalarda mavjud emas");
      }
      updates.category = normalizedCategory;
    }

    const uploadedImages = roomImagePaths(req.files);
    if (current.images.length + uploadedImages.length > MAX_ROOM_IMAGES) {
      removeUploadedFiles(req.files);
      return response.error(res, "Xonada ko'pi bilan 8 ta rasm bo'lishi mumkin");
    }
    if (uploadedImages.length) updates.images = [...current.images, ...uploadedImages];

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
    const after = roomSnapshot(nextRoom);
    const priceChanged =
      JSON.stringify(before?.prices || null) !== JSON.stringify(after?.prices || null);

    await writeAuditLog(req, {
      action: priceChanged ? "ROOM_PRICE_UPDATED" : "ROOM_UPDATED",
      entity: "Room",
      entityId: nextRoom._id,
      description: priceChanged
        ? `${nextRoom.korpus}-${nextRoom.roomNumber} xona narxi o'zgartirildi`
        : `${nextRoom.korpus}-${nextRoom.roomNumber} xona yangilandi`,
      before,
      after,
      changes: {
        prices: { from: before?.prices, to: after?.prices },
        status: { from: before?.status, to: after?.status },
        capacity: { from: before?.capacity, to: after?.capacity },
        category: { from: before?.category, to: after?.category },
      },
    });

    return response.success(res, "Xona yangilandi", nextRoom);
  } catch (error) {
    removeUploadedFiles(req.files);
    return response.serverError(res, error.message);
  }
};

const deleteRoom = async (req, res) => {
  try {
    const room = await Room.findByIdAndDelete(req.params.id);
    if (!room) return response.notFound(res, "Xona topilmadi");
    await deleteRoomImageFiles(room.images);
    await writeAuditLog(req, {
      action: "ROOM_DELETED",
      entity: "Room",
      entityId: room._id,
      description: `${room.korpus}-${room.roomNumber} xona o'chirildi`,
      before: roomSnapshot(room),
    });
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
