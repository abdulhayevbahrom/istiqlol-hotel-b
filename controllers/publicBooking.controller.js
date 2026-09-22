const Guest = require("../model/Guest");
const Room = require("../model/Room");
const PublicBookingRequest = require("../model/PublicBookingRequest");
const moment = require("moment-timezone");
const crypto = require("node:crypto");
const response = require("../utils/response");
const {
  getHotelSettings,
  applyTimeToDate,
  calculateCheckoutDueAt,
} = require("../utils/hotelSettings");
const {
  createPublicToken,
  hashPublicToken,
  createBookingReference,
  sendBookingConfirmationEmail,
  writeBookingPdf,
} = require("../utils/publicBookingConfirmation");

const normalizeText = (value) => String(value || "").trim();

const escapeRegex = (value) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseBookingDate = (value) => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const localDate = moment.tz(`${String(value)} 12:00`, "YYYY-MM-DD HH:mm", true, "Asia/Tashkent");
    return localDate.isValid() ? localDate.toDate() : null;
  }
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

const serializePublicBooking = (guests) => {
  const [primary] = guests;
  if (!primary) return null;
  const publicCheckIn = new Date(primary.bookedForAt || primary.checkInAt);
  const publicCheckOut = new Date(publicCheckIn);
  publicCheckOut.setUTCDate(publicCheckOut.getUTCDate() + Math.max(Number(primary.stayDays || 1), 1));
  return {
    reference: primary.bookingReference,
    guestName: `${primary.firstname || ""} ${primary.lastname || ""}`.trim(),
    phone: primary.phone,
    email: primary.email,
    guestType: primary.guestType,
    checkIn: publicCheckIn,
    checkOut: publicCheckOut,
    status: primary.status,
    rooms: guests.map((guest) => ({
      category: guest.room?.category || "",
      capacity: guest.room?.capacity || 0,
      roomNumber: guest.room ? `${guest.room.korpus ? `${guest.room.korpus}-` : ""}${guest.room.roomNumber || ""}` : "",
      dailyRate: guest.dailyRate || 0,
      stayDays: guest.stayDays || 1,
    })),
    totalAmount: guests.reduce((sum, guest) => sum + Number(guest.totalAmount || 0), 0),
  };
};

const findPublicBooking = async (token) => {
  const tokenHash = hashPublicToken(token);
  if (!token || !tokenHash) return null;
  const guests = await Guest.find({ bookingPublicTokenHash: tokenHash })
    .populate("room")
    .sort({ createdAt: 1 })
    .lean();
  return serializePublicBooking(guests);
};

const getPublicBookingConfirmation = async (req, res) => {
  try {
    const booking = await findPublicBooking(req.params.token);
    if (!booking) return response.notFound(res, "Bron topilmadi yoki havola yaroqsiz");
    return response.success(res, "Bron ma'lumotlari", booking);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const downloadPublicBookingPdf = async (req, res) => {
  try {
    const booking = await findPublicBooking(req.params.token);
    if (!booking) return response.notFound(res, "Bron topilmadi yoki havola yaroqsiz");
    return writeBookingPdf({ res, booking });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const getPublicRoomAvailability = async (req, res) => {
  try {
    const checkIn = parseBookingDate(req.query.checkIn);
    const checkOut = parseBookingDate(req.query.checkOut);
    if (!checkIn || !checkOut || checkOut.getTime() <= checkIn.getTime()) {
      return response.error(res, "To'g'ri kelish va ketish sanalarini kiriting");
    }

    const stayDays = Math.max(
      Math.ceil((checkOut.getTime() - checkIn.getTime()) / (24 * 60 * 60 * 1000)),
      1,
    );
    const hotelSettings = await getHotelSettings();
    const stayEnd = calculateCheckoutDueAt(
      checkIn,
      stayDays,
      hotelSettings.checkoutTime || "12:00",
    );
    const rooms = await Room.find({ status: { $ne: "remont" } }).select("_id").lean();
    const roomIds = rooms.map((room) => room._id);
    const guests = await Guest.find({
      room: { $in: roomIds },
      status: { $in: ["active", "booked"] },
    }).select("room status bookedForAt checkInAt checkoutDueAt").lean();
    const occupiedRoomIds = new Set(
      guests
        .filter((guest) => {
          const guestStart = guest.status === "booked" ? guest.bookedForAt : guest.checkInAt;
          const guestEnd = guest.checkoutDueAt || guest.checkInAt;
          return intervalsOverlap(checkIn, stayEnd, guestStart, guestEnd);
        })
        .map((guest) => String(guest.room)),
    );

    return response.success(res, "Bo'sh xonalar", {
      availableRoomIds: roomIds
        .map((roomId) => String(roomId))
        .filter((roomId) => !occupiedRoomIds.has(roomId)),
    });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const createPublicBooking = async (req, res) => {
  try {
    const firstname = normalizeText(req.body.firstname);
    const lastname = normalizeText(req.body.lastname);
    const phone = normalizeText(req.body.phone);
    const email = normalizeText(req.body.email);
    const roomType = normalizeText(req.body.roomType);
    const checkIn = parseBookingDate(req.body.checkIn);
    const checkOut = parseBookingDate(req.body.checkOut);
    const guestsCount = Math.max(Number(req.body.guests || 1), 1);
    const requestedSelections = Array.isArray(req.body.roomSelections)
      ? req.body.roomSelections
        .map((item) => ({
          category: normalizeText(item.category),
          capacity: Math.max(Number(item.capacity || 0), 0),
          rate: Math.max(Number(item.rate || 0), 0),
          count: Math.max(Math.trunc(Number(item.count || 0)), 0),
        }))
        .filter((item) => item.category && item.count > 0)
      : [];
    const roomCount = requestedSelections.length
      ? requestedSelections.reduce((sum, item) => sum + item.count, 0)
      : Math.max(Math.trunc(Number(req.body.roomCount || 1)), 1);
    const guestType = req.body.guestType === "chetellik" ? "chetellik" : "uzb";
    const requestedCapacity = Math.max(Number(req.body.roomCapacity || 0), 0);
    const requestedRate = Math.max(Number(req.body.roomRate || 0), 0);
    const note = normalizeText(req.body.note);
    const bookingRequestId = normalizeText(req.body.bookingRequestId);
    const publicToken = createPublicToken();
    const publicTokenHash = hashPublicToken(publicToken);
    const bookingReference = createBookingReference();

    if (!firstname || !lastname || !phone || !email || !roomType || !checkIn || !checkOut) {
      return response.error(res, "Bron uchun kerakli ma'lumotlarni to'ldiring");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return response.error(res, "To'g'ri email manzilini kiriting");
    }

    const todayStart = moment.tz("Asia/Tashkent").startOf("day").toDate();
    if (checkIn.getTime() < todayStart.getTime()) {
      return response.error(res, "Kelish sanasi hozirgi vaqtdan oldin bo'lishi mumkin emas");
    }

    if (checkOut.getTime() <= checkIn.getTime()) {
      return response.error(res, "Ketish sanasi kelish sanasidan keyin bo'lishi kerak");
    }

    if (bookingRequestId) {
      const fingerprintPayload = JSON.stringify({
        email: email.toLowerCase(),
        phone,
        checkIn: req.body.checkIn,
        checkOut: req.body.checkOut,
        selections: requestedSelections
          .map(({ category, capacity, rate, count }) => ({ category, capacity, rate, count }))
          .sort((a, b) => `${a.category}-${a.capacity}-${a.rate}`.localeCompare(`${b.category}-${b.capacity}-${b.rate}`)),
        minute: Math.floor(Date.now() / 60000),
      });
      const fingerprint = crypto.createHash("sha256").update(fingerprintPayload).digest("hex");
      try {
        await PublicBookingRequest.create({ requestId: bookingRequestId, fingerprint });
      } catch (error) {
        if (error?.code === 11000) {
          return response.error(res, "Bu bron so'rovi allaqachon qabul qilingan");
        }
        throw error;
      }
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
    const selectedRooms = [];
    const selections = requestedSelections.length
      ? requestedSelections
      : [{ category: roomType, capacity: requestedCapacity, rate: requestedRate, count: roomCount }];
    for (const selection of selections) {
      const roomFilter = { status: { $ne: "remont" } };
      const categoryRegex = buildRoomTypeRegex(selection.category);
      if (categoryRegex) roomFilter.category = categoryRegex;
      if (selection.capacity > 0) roomFilter.capacity = selection.capacity;
      else if (selection.count === 1) roomFilter.capacity = { $gte: guestsCount };
      if (selection.rate > 0) {
        roomFilter[`prices.${guestType === "chetellik" ? "chetEllik" : "oddiy"}`] = selection.rate;
      }
      // eslint-disable-next-line no-await-in-loop
      const rooms = await Room.find(roomFilter).sort({ floor: 1, roomNumber: 1 }).lean();
      let found = 0;
      for (const room of rooms) {
        // eslint-disable-next-line no-await-in-loop
        const conflict = await hasRoomStayConflict({ roomId: room._id, stayStart: checkIn, stayEnd: checkoutDueAt });
        if (!conflict) {
          selectedRooms.push(room);
          found += 1;
          if (found >= selection.count) break;
        }
      }
      if (found < selection.count) {
        return response.error(res, `${selection.category} uchun yetarli bo'sh xona topilmadi`);
      }
    }

    const totalCapacity = selectedRooms.reduce(
      (sum, room) => sum + Math.max(Number(room.capacity || 0), 0),
      0,
    );
    if (selectedRooms.length < roomCount || totalCapacity < guestsCount) {
      return response.error(res, "Tanlangan muddat uchun mos bo'sh xona topilmadi");
    }

    const guestDocuments = selectedRooms.map((selectedRoom, index) => {
      const dailyRate = Number(
        guestType === "chetellik"
          ? selectedRoom.prices?.chetEllik
          : selectedRoom.prices?.oddiy,
      ) || 0;
      return {
      firstname,
      lastname,
      passport: "",
      birthDate: null,
      phone,
      email,
      bookingReference,
      bookingPublicTokenHash: publicTokenHash,
      organization: "",
      guestType,
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
      source: "website",
      acceptedBy: null,
      checkInAt: checkIn,
      note: [
        "Website orqali bron",
        `Xona turi: ${roomType}`,
        `Mehmonlar soni: ${guestsCount}`,
        `Rezidentlik: ${guestType === "chetellik" ? "Norezident" : "O'zbekiston rezidenti"}`,
        `Xonalar soni: ${roomCount}`,
        roomCount > 1 ? `Bron xonasi: ${index + 1}/${roomCount}` : "",
        note,
      ].filter(Boolean).join("\n"),
      };
    });
    const createdGuests = await Guest.insertMany(guestDocuments);

    createdGuests.forEach((guest) => {
      req.app.get("socket")?.emit("guest_updated", {
        guestId: String(guest._id),
        roomId: String(guest.room || ""),
        status: guest.status,
        reason: "website_booking_created",
        emittedAt: new Date(),
      });
    });

    const populatedGuests = await Guest.find({
      _id: { $in: createdGuests.map((guest) => guest._id) },
    }).populate("room").lean();
    const [primaryBooking] = populatedGuests;
    let emailResult = { sent: false };
    try {
      emailResult = await sendBookingConfirmationEmail({
        email,
        guestName: `${firstname} ${lastname}`.trim(),
        reference: bookingReference,
        token: publicToken,
      });
    } catch (emailError) {
      console.error("Bron tasdiq emailini yuborib bo'lmadi:", emailError.message);
    }
    return response.created(res, "Bron qabul qilindi", {
      ...primaryBooking,
      rooms: populatedGuests.map((booking) => booking.room).filter(Boolean),
      roomCount: populatedGuests.length,
      bookingReference,
      confirmationToken: publicToken,
      confirmationUrl: `${String(process.env.PUBLIC_WEBSITE_URL || "https://istiqlolhotel.uz").replace(/\/+$/, "")}/booking-confirmation/${publicToken}`,
      emailSent: emailResult.sent,
    });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

module.exports = {
  createPublicBooking,
  getPublicRoomAvailability,
  getPublicBookingConfirmation,
  downloadPublicBookingPdf,
};
