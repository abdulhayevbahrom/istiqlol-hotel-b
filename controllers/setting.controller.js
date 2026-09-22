const Setting = require("../model/Setting");
const Room = require("../model/Room");
const response = require("../utils/response");
const {
  DEFAULT_HOTEL_SETTINGS,
  getHotelSettings,
  parseTime,
} = require("../utils/hotelSettings");
const { writeAuditLog } = require("../utils/auditLog");
const {
  removeStoredRoomImages,
  removeUploadedFiles,
} = require("../middleware/roomImageUpload.middleware");

const roomImagePaths = (files = []) => files.map((file) => `/uploads/rooms/${file.filename}`);

const normalizeCategoryImageItems = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map((item) => ({
      category: String(item?.category || "").trim(),
      images: (Array.isArray(item?.images) ? item.images : [])
        .map((image) => String(image || "").trim())
        .filter(Boolean)
        .slice(0, 8),
    }))
    .filter((item) => item.category);

const getSettings = async (_, res) => {
  try {
    const settings = await getHotelSettings();
    return response.success(res, "Sozlamalar", settings);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const updateSettings = async (req, res) => {
  try {
    const updates = { ...req.body };
    if (typeof updates.hotelName === "string") {
      updates.hotelName = updates.hotelName.trim();
    }
    if (typeof updates.receiptThankYouText === "string") {
      updates.receiptThankYouText = updates.receiptThankYouText.trim();
    }
    if (typeof updates.logo === "string") {
      updates.logo = updates.logo.trim();
    }
    if (Array.isArray(updates.roomCategories)) {
      updates.roomCategories = [
        ...new Set(
          updates.roomCategories
            .map((item) => String(item || "").trim())
            .filter(Boolean),
        ),
      ];
      if (!updates.roomCategories.length) {
        return response.error(res, "Xona kategoriyalari bo'sh bo'lishi mumkin emas");
      }
    }
    if (Array.isArray(updates.roomCategoryImages)) {
      updates.roomCategoryImages = normalizeCategoryImageItems(updates.roomCategoryImages);
    }

    const current = await getHotelSettings();
    let removedCategoryImages = [];
    if (Array.isArray(updates.roomCategories)) {
      const activeCategories = new Set(updates.roomCategories);
      removedCategoryImages = normalizeCategoryImageItems(current.roomCategoryImages)
        .filter((item) => !activeCategories.has(item.category))
        .flatMap((item) => item.images);
      const categoryImages = Array.isArray(updates.roomCategoryImages)
        ? updates.roomCategoryImages
        : normalizeCategoryImageItems(current.roomCategoryImages);
      updates.roomCategoryImages = categoryImages
        .filter((item) => activeCategories.has(item.category));
    }
    const checkout = parseTime(updates.checkoutTime || current.checkoutTime);
    const reminder = parseTime(updates.reminderTime || current.reminderTime);
    const checkoutMinutes = checkout.hour * 60 + checkout.minute;
    const reminderMinutes = reminder.hour * 60 + reminder.minute;
    if (reminderMinutes >= checkoutMinutes) {
      return response.error(
        res,
        "Ogohlantirish vaqti chiqish vaqtidan oldin bo'lishi kerak",
      );
    }

    const settings = await Setting.findOneAndUpdate(
      {},
      { $set: updates },
      {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
      },
    ).lean();
    const nextSettings = { ...DEFAULT_HOTEL_SETTINGS, ...settings };

    await removeStoredRoomImages(removedCategoryImages);

    await writeAuditLog(req, {
      action: "SETTINGS_UPDATED",
      entity: "Setting",
      description: "Hotel sozlamalari o'zgartirildi",
      before: current,
      after: nextSettings,
      changes: Object.keys(updates).reduce((acc, key) => {
        acc[key] = { from: current?.[key], to: nextSettings?.[key] };
        return acc;
      }, {}),
    });

    return response.success(
      res,
      "Sozlamalar yangilandi",
      nextSettings,
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const updateRoomCategoryImages = async (req, res) => {
  try {
    const category = String(req.body.category || "").trim();
    if (!category) {
      removeUploadedFiles(req.files);
      return response.error(res, "Kategoriya nomi majburiy");
    }

    let existingImages = [];
    if (typeof req.body.existingImages === "string") {
      existingImages = JSON.parse(req.body.existingImages);
    } else if (Array.isArray(req.body.existingImages)) {
      existingImages = req.body.existingImages;
    }
    existingImages = existingImages
      .map((image) => String(image || "").trim())
      .filter(Boolean);

    const nextImages = [...existingImages, ...roomImagePaths(req.files)];
    if (nextImages.length > 8) {
      removeUploadedFiles(req.files);
      return response.error(res, "Har bir kategoriya uchun ko'pi bilan 8 ta rasm yuklash mumkin");
    }

    const current = await getHotelSettings();
    if (!current.roomCategories.includes(category)) {
      removeUploadedFiles(req.files);
      return response.error(res, "Kategoriya sozlamalarda mavjud emas");
    }

    const nextCategoryImages = normalizeCategoryImageItems(current.roomCategoryImages)
      .filter((item) => item.category !== category);
    const previousImages = normalizeCategoryImageItems(current.roomCategoryImages)
      .find((item) => item.category === category)?.images || [];
    const retainedImageSet = new Set(existingImages);
    const removedImages = previousImages.filter((image) => !retainedImageSet.has(image));
    nextCategoryImages.push({ category, images: nextImages });

    const settings = await Setting.findOneAndUpdate(
      {},
      { $set: { roomCategoryImages: nextCategoryImages } },
      {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
      },
    ).lean();

    await removeStoredRoomImages(removedImages);

    return response.success(res, "Kategoriya rasmlari saqlandi", {
      ...DEFAULT_HOTEL_SETTINGS,
      ...settings,
      roomCategoryImages: normalizeCategoryImageItems(settings.roomCategoryImages),
    });
  } catch (error) {
    removeUploadedFiles(req.files);
    return response.serverError(res, error.message);
  }
};

const getPublicRoomCategories = async (_, res) => {
  try {
    const settings = await getHotelSettings();
    const imageMap = new Map(
      normalizeCategoryImageItems(settings.roomCategoryImages)
        .map((item) => [item.category, item.images]),
    );
    const rooms = await Room.find({ status: { $ne: "remont" } })
      .select("category capacity prices images")
      .lean();
    const groups = new Map();

    rooms.forEach((room) => {
      const category = String(room?.category || "").trim();
      if (!category) return;
      const current = groups.get(category) || {
        category,
        minLocalPrice: 0,
        minForeignPrice: 0,
        capacity: 0,
        count: 0,
        images: imageMap.get(category) || [],
      };
      const localPrice = Number(room?.prices?.oddiy || 0);
      const foreignPrice = Number(room?.prices?.chetEllik || 0);
      groups.set(category, {
        ...current,
        minLocalPrice:
          !current.minLocalPrice || (localPrice && localPrice < current.minLocalPrice)
            ? localPrice
            : current.minLocalPrice,
        minForeignPrice:
          !current.minForeignPrice || (foreignPrice && foreignPrice < current.minForeignPrice)
            ? foreignPrice
            : current.minForeignPrice,
        capacity: Math.max(current.capacity, Number(room?.capacity || 0)),
        count: current.count + 1,
        images: current.images.length ? current.images : (room?.images || []).slice(0, 8),
      });
    });

    const categoryOrder = new Map(
      settings.roomCategories.map((category, index) => [category, index]),
    );
    const categories = [...groups.values()].sort((a, b) => {
      const aIndex = categoryOrder.get(a.category) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = categoryOrder.get(b.category) ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex || a.category.localeCompare(b.category);
    });

    return response.success(res, "Xona kategoriyalari", categories);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

module.exports = {
  getSettings,
  updateSettings,
  updateRoomCategoryImages,
  getPublicRoomCategories,
};
