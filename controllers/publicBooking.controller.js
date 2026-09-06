const Guest = require("../model/Guest");
const Room = require("../model/Room");
const response = require("../utils/response");
const {
  getHotelSettings,
  applyTimeToDate,
  calculateCheckoutDueAt,
} = require("../utils/hotelSettings");

const normalizeText = (value) => String(value || "").trim();

const escapeRegex = (value) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseBookingDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const intervalsOverlap = (startA, endA, startB, endB) => {
  const aStart = new Date(startA).getTime();
  const aEnd = new Date(endA).getTime();
  const bStart = new Date(startB).getTime();
  const bEnd = new Date(endB).getTime();
  if ([aStart, aEnd, bStart, bEnd].some((value) => Number.isNaN(value))) {
    return false;
  }
  return aStart < bEnd && bStart < aEnd;
};

const hasRoomStayConflict = async ({ roomId, stayStart, stayEnd }) => {
  const guests = await Guest.find({
    room: roomId,
    status: { $in: ["active", "booked"] },
  })
    .select("status bookedForAt checkInAt checkoutDueAt")
    .lean();

  return guests.some((guest) => {
    const guestStart = guest.status === "booked" ? guest.bookedForAt : guest.checkInAt;
    const guestEnd = guest.checkoutDueAt || guest.checkInAt;
    return intervalsOverlap(stayStart, stayEnd, guestStart, guestEnd);
  });
};

const buildRoomTypeRegex = (roomType) => {
  const cleaned = normalizeText(roomType)
    .replace(/\bxona\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? new RegExp(escapeRegex(cleaned), "i") : null;
};

const createPublicBooking = async (req, res) => {
  try {
    const firstname = normalizeText(req.body.firstname);
    const lastname = normalizeText(req.body.lastname);
    const phone = normalizeText(req.body.phone);
    const roomType = normalizeText(req.body.roomType);
    const checkIn = parseBookingDate(req.body.checkIn);
    const checkOut = parseBookingDate(req.body.checkOut);
    const guestsCount = Math.max(Number(req.body.guests || 1), 1);
    const note = normalizeText(req.body.note);

    if (!firstname || !lastname || !phone || !roomType || !checkIn || !checkOut) {
      return response.error(res, "Bron uchun kerakli ma'lumotlarni to'ldiring");
    }

    if (checkIn.getTime() < Date.now()) {
      return response.error(res, "Kelish sanasi hozirgi vaqtdan oldin bo'lishi mumkin emas");
    }

    if (checkOut.getTime() <= checkIn.getTime()) {
      return response.error(res, "Ketish sanasi kelish sanasidan keyin bo'lishi kerak");
    }

    const stayDays = Math.max(
      Math.ceil((checkOut.getTime() - checkIn.getTime()) / (24 * 60 * 60 * 1000)),
      1,
    );
    const hotelSettings = await getHotelSettings();
    const checkoutDueAt = calculateCheckoutDueAt(
      checkIn,
      stayDays,
      hotelSettings.checkoutTime || "12:00",
    );
    const checkoutReminderAt = applyTimeToDate(
      checkoutDueAt,
      hotelSettings.reminderTime || "12:00",
    );
    const roomTypeRegex = buildRoomTypeRegex(roomType);
    const roomFilter = {
      status: { $ne: "remont" },
      capacity: { $gte: guestsCount },
    };
    if (roomTypeRegex) roomFilter.category = roomTypeRegex;

    const rooms = await Room.find(roomFilter)
      .sort({ floor: 1, roomNumber: 1 })
      .lean();

    let selectedRoom = null;
    for (const room of rooms) {
      // eslint-disable-next-line no-await-in-loop
      const conflict = await hasRoomStayConflict({
        roomId: room._id,
        stayStart: checkIn,
        stayEnd: checkoutDueAt,
      });
      if (!conflict) {
        selectedRoom = room;
        break;
      }
    }

    if (!selectedRoom) {
      return response.error(res, "Tanlangan muddat uchun mos bo'sh xona topilmadi");
    }

    const dailyRate = Number(selectedRoom.prices?.oddiy || 0);
    const guest = await Guest.create({
      firstname,
      lastname,
      passport: "",
      birthDate: null,
      phone,
      email: normalizeText(req.body.email),
      organization: "",
      guestType: "uzb",
      vip: false,
      vipRequestStatus: "none",
      room: selectedRoom._id,
      stayDays,
      billableDays: stayDays,
      checkoutReminderAt,
      checkoutDueAt,
      bookedForAt: checkIn,
      dailyRate,
      dailyRates: [],
      mainPaymentType: "naqd",
      totalAmount: dailyRate * stayDays,
      paidAmount: 0,
      debtAmount: 0,
      payments: [],
      status: "booked",
      acceptedBy: null,
      checkInAt: checkIn,
      note: [
        "Website orqali bron",
        `Xona turi: ${roomType}`,
        `Mehmonlar soni: ${guestsCount}`,
        note,
      ].filter(Boolean).join("\n"),
    });

    req.app.get("socket")?.emit("guest_updated", {
      guestId: String(guest._id),
      roomId: String(guest.room || ""),
      status: guest.status,
      reason: "website_booking_created",
      emittedAt: new Date(),
    });

    const populated = await Guest.findById(guest._id).populate("room").lean();
    return response.created(res, "Bron qabul qilindi", populated);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

module.exports = {
  createPublicBooking,
};
