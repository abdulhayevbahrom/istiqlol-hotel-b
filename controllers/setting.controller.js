const Setting = require("../model/Setting");
const response = require("../utils/response");
const {
  DEFAULT_HOTEL_SETTINGS,
  getHotelSettings,
  parseTime,
} = require("../utils/hotelSettings");
const { writeAuditLog } = require("../utils/auditLog");

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

    const current = await getHotelSettings();
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

module.exports = {
  getSettings,
  updateSettings,
};
