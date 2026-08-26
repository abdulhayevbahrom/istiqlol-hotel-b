const crypto = require("node:crypto");
const moment = require("moment-timezone");
const BookingSyncEvent = require("../../model/BookingSyncEvent");
const Guest = require("../../model/Guest");
const IntegrationLock = require("../../model/IntegrationLock");
const Room = require("../../model/Room");
const { getHotelSettings, parseTime } = require("../../utils/hotelSettings");
const { syncRoomsOccupancyByIds } = require("../../utils/roomOccupancy");
const { BookingClient } = require("./booking.client");
const { getBookingConfig } = require("./booking.config");

const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Tashkent";
const LOCK_ID = "booking-com-reservations";
const LOCK_OWNER = `${process.pid}-${crypto.randomUUID()}`;
const SYSTEM_ACTION = {
  userId: "booking-com",
  role: "system",
  login: "booking.com",
  firstname: "Booking.com",
  lastname: "Integration",
};

const runtimeState = {
  enabled: false,
  configured: false,
  running: false,
  lastStartedAt: null,
  lastSucceededAt: null,
  lastErrorAt: null,
  lastError: "",
  lastFetchedCount: 0,
  lastProcessedCount: 0,
  interval: null,
  client: null,
  clientKey: "",
};

const normalizeCategory = (value) =>
  String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();

const resolveRoomCategory = (roomUnit, config, localCategories = []) => {
  const mapped = config.roomTypeMap[String(roomUnit.roomTypeId || "").trim()];
  if (mapped) return mapped;
  if (!config.allowNameFallback) return "";

  const roomName = normalizeCategory(roomUnit.roomName);
  return (
    localCategories.find((category) => normalizeCategory(category) === roomName) ||
    ""
  );
};

const parseExternalDate = (value) => {
  if (!value) return null;
  const parsed = moment(value);
  return parsed.isValid() ? parsed.toDate() : null;
};

const dateAtHotelTime = (dateText, time = "12:00") => {
  const parsed = moment.tz(dateText, "YYYY-MM-DD", true, APP_TIMEZONE);
  if (!parsed.isValid()) return null;
  const { hour, minute } = parseTime(time);
  return parsed.hour(hour).minute(minute).second(0).millisecond(0).toDate();
};

const calendarStayDays = (arrivalDate, departureDate) => {
  const arrival = moment.tz(arrivalDate, "YYYY-MM-DD", true, APP_TIMEZONE);
  const departure = moment.tz(departureDate, "YYYY-MM-DD", true, APP_TIMEZONE);
  if (!arrival.isValid() || !departure.isValid()) return 0;
  return Math.max(departure.startOf("day").diff(arrival.startOf("day"), "days"), 0);
};

const splitFullName = (fullName, fallback = {}) => {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return {
      firstname: String(fallback.firstname || "Booking.com").trim() || "Booking.com",
      lastname: String(fallback.lastname || "Guest").trim() || "Guest",
    };
  }
  if (parts.length === 1) return { firstname: parts[0], lastname: "-" };
  return { firstname: parts[0], lastname: parts.slice(1).join(" ") };
};

const hasStayConflict = async ({ roomId, stayStart, stayEnd, excludeGuestId }) => {
  const query = {
    room: roomId,
    status: { $in: ["booked", "active"] },
    checkInAt: { $lt: stayEnd },
    checkoutDueAt: { $gt: stayStart },
  };
  if (excludeGuestId) query._id = { $ne: excludeGuestId };
  return Boolean(await Guest.exists(query));
};

const findAvailablePhysicalRoom = async ({
  category,
  stayStart,
  stayEnd,
  existingGuest,
}) => {
  if (existingGuest?.room) {
    const currentRoom = await Room.findOne({
      _id: existingGuest.room,
      category,
      status: { $ne: "remont" },
    }).lean();
    if (
      currentRoom &&
      !(await hasStayConflict({
        roomId: currentRoom._id,
        stayStart,
        stayEnd,
        excludeGuestId: existingGuest._id,
      }))
    ) {
      return currentRoom;
    }
  }

  const rooms = await Room.find({ category, status: { $ne: "remont" } })
    .sort({ korpus: 1, floor: 1, roomNumber: 1 })
    .lean();
  for (const room of rooms) {
    // Har bir Booking.com room unit butun fizik xonani band qiladi.
    // eslint-disable-next-line no-await-in-loop
    const conflict = await hasStayConflict({
      roomId: room._id,
      stayStart,
      stayEnd,
      excludeGuestId: existingGuest?._id,
    });
    if (!conflict) return room;
  }
  return null;
};

const deriveGuestStatus = ({ existingGuest, checkInAt, checkoutDueAt }) => {
  if (["active", "checked_out"].includes(existingGuest?.status)) {
    return existingGuest.status;
  }
  const now = Date.now();
  if (now >= checkoutDueAt.getTime()) return "checked_out";
  if (now >= checkInAt.getTime()) return "active";
  return "booked";
};

const buildBookingNote = (reservation, roomUnit) =>
  [
    `Booking.com #${reservation.reservationId}`,
    roomUnit.roomName ? `Xona turi: ${roomUnit.roomName}` : "",
    reservation.customer?.remarks || "",
    roomUnit.remarks || "",
  ]
    .filter(Boolean)
    .join(" | ");

const upsertReservationUnit = async ({
  reservation,
  roomUnit,
  config,
  hotelSettings,
  localCategories,
}) => {
  const existingGuest = await Guest.findOne({
    source: "booking_com",
    externalReservationUnitId: roomUnit.unitId,
  });
  const category = resolveRoomCategory(roomUnit, config, localCategories);
  if (!category) {
    throw new Error(
      `Booking room type ${roomUnit.roomTypeId || "(ID yo'q)"} lokal kategoriyaga moslanmagan`,
    );
  }
  if (!localCategories.includes(category)) {
    throw new Error(`Moslangan lokal kategoriya topilmadi: ${category}`);
  }

  const stayDays = calendarStayDays(roomUnit.arrivalDate, roomUnit.departureDate);
  const checkInAt = dateAtHotelTime(roomUnit.arrivalDate, "12:00");
  const checkoutDueAt = dateAtHotelTime(
    roomUnit.departureDate,
    hotelSettings.checkoutTime || "12:00",
  );
  const checkoutReminderAt = dateAtHotelTime(
    roomUnit.departureDate,
    hotelSettings.reminderTime || "12:00",
  );
  if (!stayDays || !checkInAt || !checkoutDueAt || !checkoutReminderAt) {
    throw new Error(
      `Booking #${reservation.reservationId} kelish/ketish sanasi noto'g'ri`,
    );
  }

  const physicalRoom = await findAvailablePhysicalRoom({
    category,
    stayStart: checkInAt,
    stayEnd: checkoutDueAt,
    existingGuest,
  });
  if (!physicalRoom) {
    throw new Error(
      `${category} kategoriyasida ${roomUnit.arrivalDate}–${roomUnit.departureDate} uchun bo'sh xona yo'q`,
    );
  }

  const externalTotalAmount = Math.max(Number(roomUnit.totalAmount || 0), 0);
  const canImportPrice =
    config.importPrices &&
    roomUnit.currency &&
    roomUnit.currency === config.localCurrency;
  const dailyRate = canImportPrice
    ? Math.round((externalTotalAmount / stayDays) * 100) / 100
    : 0;
  const totalAmount = canImportPrice ? externalTotalAmount : 0;
  const guestStatus = deriveGuestStatus({
    existingGuest,
    checkInAt,
    checkoutDueAt,
  });
  const name = splitFullName(roomUnit.guestName, reservation.customer);
  const externalModifiedAt = parseExternalDate(reservation.modifiedAt);
  const externalBookedAt = parseExternalDate(reservation.bookedAt);
  const nextRoomId = physicalRoom._id;
  const previousRoomId = existingGuest?.room ? String(existingGuest.room) : "";

  const sharedUpdates = {
    firstname: name.firstname,
    lastname: name.lastname,
    phone: String(reservation.customer?.phone || "").trim(),
    email: String(reservation.customer?.email || "").trim(),
    organization: String(reservation.customer?.organization || "").trim(),
    guestType:
      reservation.customer?.countryCode && reservation.customer.countryCode !== "UZ"
        ? "chetellik"
        : "uzb",
    room: nextRoomId,
    bookedForAt: checkInAt,
    checkInAt,
    stayDays,
    billableDays: stayDays,
    checkoutDueAt,
    checkoutReminderAt,
    note: buildBookingNote(reservation, roomUnit),
    source: "booking_com",
    externalHotelId: reservation.hotelId,
    externalReservationId: reservation.reservationId,
    externalReservationUnitId: roomUnit.unitId,
    externalRoomTypeId: roomUnit.roomTypeId,
    externalReservationStatus: reservation.status,
    externalBookedAt,
    externalModifiedAt,
    externalCurrency: roomUnit.currency,
    externalTotalAmount,
    blocksWholeRoom: true,
    cancelledAt: null,
  };

  if (existingGuest) {
    Object.assign(existingGuest, sharedUpdates);
    if (["booked", "cancelled"].includes(existingGuest.status)) {
      existingGuest.status = guestStatus;
      existingGuest.dailyRate = dailyRate;
      existingGuest.totalAmount = totalAmount;
      existingGuest.debtAmount = guestStatus === "active" ? totalAmount : 0;
      existingGuest.checkOutAt =
        guestStatus === "checked_out" ? checkoutDueAt : null;
    }
    await existingGuest.save();
    return {
      guestId: String(existingGuest._id),
      previousRoomId,
      roomId: String(nextRoomId),
      created: false,
    };
  }

  const guest = await Guest.create({
    ...sharedUpdates,
    passport: "",
    birthDate: null,
    vip: false,
    vipRequestStatus: "none",
    dailyRate,
    mainPaymentType: "bank",
    totalAmount,
    paidAmount: 0,
    debtAmount: guestStatus === "active" ? totalAmount : 0,
    payments: [],
    services: [],
    status: guestStatus,
    acceptedBy: SYSTEM_ACTION,
    checkoutBy: guestStatus === "checked_out" ? SYSTEM_ACTION : null,
    checkOutAt: guestStatus === "checked_out" ? checkoutDueAt : null,
  });
  return {
    guestId: String(guest._id),
    previousRoomId: "",
    roomId: String(nextRoomId),
    created: true,
  };
};

const processCancellation = async (reservation) => {
  const guests = await Guest.find({
    source: "booking_com",
    externalReservationId: reservation.reservationId,
  }).select("_id room status");
  const affectedRoomIds = guests.map((guest) => String(guest.room || "")).filter(Boolean);

  for (const guest of guests) {
    guest.externalReservationStatus = "cancelled";
    guest.externalModifiedAt = parseExternalDate(reservation.modifiedAt);
    guest.cancelledAt = new Date();
    // Mehmon allaqachon yashayotgan bo'lsa, tashqi bekor qilish uni
    // resepsiya tasdig'isiz xonadan avtomatik chiqarmaydi.
    if (guest.status === "booked") guest.status = "cancelled";
    // eslint-disable-next-line no-await-in-loop
    await guest.save();
  }
  await syncRoomsOccupancyByIds(affectedRoomIds);
  return { changed: guests.length, roomIds: affectedRoomIds };
};

const processReservation = async (reservation, config) => {
  if (reservation.status === "cancelled") {
    return processCancellation(reservation);
  }
  if (!reservation.rooms?.length) {
    throw new Error(`Booking #${reservation.reservationId} ichida xona yo'q`);
  }

  const [hotelSettings, localCategories] = await Promise.all([
    getHotelSettings(),
    Room.distinct("category"),
  ]);
  const results = [];
  for (const roomUnit of reservation.rooms) {
    // Bitta API javobidagi xonalarni ketma-ket ajratish bir fizik xonani
    // ikki unitga berib yubormaslik uchun ataylab qilinadi.
    // eslint-disable-next-line no-await-in-loop
    results.push(
      await upsertReservationUnit({
        reservation,
        roomUnit,
        config,
        hotelSettings,
        localCategories,
      }),
    );
  }

  const incomingUnitIds = reservation.rooms.map((room) => room.unitId);
  const removedUnits = await Guest.find({
    source: "booking_com",
    externalReservationId: reservation.reservationId,
    externalReservationUnitId: { $nin: incomingUnitIds },
    status: "booked",
  }).select("_id room");
  for (const guest of removedUnits) {
    guest.status = "cancelled";
    guest.externalReservationStatus = "cancelled";
    guest.cancelledAt = new Date();
    // eslint-disable-next-line no-await-in-loop
    await guest.save();
  }

  const roomIds = [
    ...results.flatMap((item) => [item.previousRoomId, item.roomId]),
    ...removedUnits.map((guest) => String(guest.room || "")),
  ].filter(Boolean);
  await syncRoomsOccupancyByIds(roomIds);
  return { changed: results.length + removedUnits.length, roomIds };
};

const saveIncomingReservations = async (reservations, config) => {
  let inserted = 0;
  for (const reservation of reservations) {
    if (reservation.hotelId && reservation.hotelId !== config.hotelId) continue;
    const result = await BookingSyncEvent.updateOne(
      { fingerprint: reservation.fingerprint },
      {
        $setOnInsert: {
          fingerprint: reservation.fingerprint,
          reservationId: reservation.reservationId,
          hotelId: reservation.hotelId || config.hotelId,
          reservationStatus: reservation.status,
          externalModifiedAt: parseExternalDate(reservation.modifiedAt),
          payload: reservation,
          processingStatus: "pending",
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount) inserted += 1;
  }
  return inserted;
};

const EVENT_STATUS_PRIORITY = { new: 1, modified: 2, cancelled: 3 };

const eventOrder = (event) => [
  new Date(event.externalModifiedAt || 0).getTime(),
  Number(EVENT_STATUS_PRIORITY[event.reservationStatus] || 0),
  new Date(event.createdAt || 0).getTime(),
];

const compareEventOrder = (left, right) => {
  const leftOrder = eventOrder(left);
  const rightOrder = eventOrder(right);
  for (let index = 0; index < leftOrder.length; index += 1) {
    if (leftOrder[index] !== rightOrder[index]) {
      return rightOrder[index] - leftOrder[index];
    }
  }
  return 0;
};

const isEventSuperseded = async (event) => {
  const siblings = await BookingSyncEvent.find({
    reservationId: event.reservationId,
  })
    .select("_id reservationStatus externalModifiedAt createdAt")
    .lean();
  if (siblings.length < 2) return false;
  siblings.sort(compareEventOrder);
  return String(siblings[0]._id) !== String(event._id);
};

const processPendingEvents = async (config, io, limit = 100) => {
  const candidates = await BookingSyncEvent.find({
    processingStatus: { $in: ["pending", "failed"] },
  })
    .sort({ createdAt: 1 })
    .limit(limit)
    .select("_id processingStatus")
    .lean();
  let processed = 0;

  for (const candidate of candidates) {
    const event = await BookingSyncEvent.findOneAndUpdate(
      { _id: candidate._id, processingStatus: candidate.processingStatus },
      {
        $set: { processingStatus: "processing", lastError: "" },
        $inc: { attempts: 1 },
      },
      { returnDocument: "after" },
    );
    if (!event) continue;

    try {
      // Eski xabar xato sabab navbatda qolganidan keyin modification yoki
      // cancellation kelgan bo'lsa, eski holat bronni qayta tiriltirmasligi kerak.
      // eslint-disable-next-line no-await-in-loop
      if (await isEventSuperseded(event)) {
        event.processingStatus = "processed";
        event.processedAt = new Date();
        event.lastError = "Yangi Booking.com xabari bilan almashtirildi";
        // eslint-disable-next-line no-await-in-loop
        await event.save();
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const result = await processReservation(event.payload, config);
      event.processingStatus = "processed";
      event.processedAt = new Date();
      event.lastError = "";
      // eslint-disable-next-line no-await-in-loop
      await event.save();
      processed += 1;
      io?.emit("guest_updated", {
        reason: "booking_com_synced",
        reservationId: event.reservationId,
        roomIds: result.roomIds || [],
        emittedAt: new Date(),
      });
    } catch (error) {
      event.processingStatus = "failed";
      event.lastError = String(error.message || error).slice(0, 1000);
      // eslint-disable-next-line no-await-in-loop
      await event.save();
    }
  }
  return processed;
};

const acquireLock = async (durationMs) => {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + durationMs);
  try {
    const lock = await IntegrationLock.findOneAndUpdate(
      {
        _id: LOCK_ID,
        $or: [
          { lockedUntil: { $lte: now } },
          { owner: LOCK_OWNER },
          { lockedUntil: { $exists: false } },
        ],
      },
      { $set: { owner: LOCK_OWNER, lockedUntil } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    ).lean();
    return lock?.owner === LOCK_OWNER;
  } catch (error) {
    if (error?.code === 11000) return false;
    throw error;
  }
};

const releaseLock = async () => {
  await IntegrationLock.updateOne(
    { _id: LOCK_ID, owner: LOCK_OWNER },
    { $set: { lockedUntil: new Date(0) } },
  );
};

const getReusableClient = (config) => {
  const clientKey = [
    config.clientId,
    config.hotelId,
    config.authUrl,
    config.reservationsUrl,
  ].join("|");
  if (!runtimeState.client || runtimeState.clientKey !== clientKey) {
    runtimeState.client = new BookingClient(config);
    runtimeState.clientKey = clientKey;
  }
  return runtimeState.client;
};

const runBookingSyncOnce = async (io, providedConfig = null) => {
  const config = providedConfig || getBookingConfig();
  runtimeState.enabled = config.enabled;
  runtimeState.configured = Boolean(
    config.clientId && config.clientSecret && config.hotelId,
  );
  if (!config.enabled) return { skipped: true, reason: "disabled" };
  if (runtimeState.running) return { skipped: true, reason: "already_running" };

  const locked = await acquireLock(Math.max(config.pollIntervalMs * 3, 60_000));
  if (!locked) return { skipped: true, reason: "another_instance" };

  runtimeState.running = true;
  runtimeState.lastStartedAt = new Date();
  let lockReleased = false;
  try {
    const client = getReusableClient(config);
    const reservations = await client.fetchReservations();
    await saveIncomingReservations(reservations, config);
    // API chaqiruvi va xavfsiz lokal navbatga yozish tugadi. Lockni shu yerda
    // bo'shatamiz; eventlarni ishlash alohida atomik claim bilan himoyalangan.
    await releaseLock();
    lockReleased = true;
    const processed = await processPendingEvents(config, io);
    runtimeState.lastFetchedCount = reservations.length;
    runtimeState.lastProcessedCount = processed;
    runtimeState.lastSucceededAt = new Date();
    runtimeState.lastError = "";
    return { skipped: false, fetched: reservations.length, processed };
  } catch (error) {
    runtimeState.lastErrorAt = new Date();
    runtimeState.lastError = String(error.message || error).slice(0, 1000);
    throw error;
  } finally {
    runtimeState.running = false;
    if (!lockReleased) await releaseLock().catch(() => {});
  }
};

const startBookingSync = (io) => {
  let config;
  try {
    config = getBookingConfig();
    runtimeState.enabled = config.enabled;
    runtimeState.configured = Boolean(
      config.clientId && config.clientSecret && config.hotelId,
    );
  } catch (error) {
    runtimeState.enabled = true;
    runtimeState.configured = false;
    runtimeState.lastError = error.message;
    runtimeState.lastErrorAt = new Date();
    console.error("Booking.com sync sozlama xatosi:", error.message);
    return null;
  }

  if (!config.enabled) return null;
  const tick = () => {
    runBookingSyncOnce(io, config).catch((error) => {
      console.error("Booking.com sync xatosi:", error.message);
    });
  };
  tick();
  runtimeState.interval = setInterval(tick, config.pollIntervalMs);
  return runtimeState.interval;
};

const getBookingSyncStatus = async () => {
  let config;
  try {
    config = getBookingConfig();
  } catch (_error) {
    config = { enabled: true, hotelId: "", roomTypeMap: {} };
  }
  const [pending, failed, processed, recentFailures] = await Promise.all([
    BookingSyncEvent.countDocuments({ processingStatus: "pending" }),
    BookingSyncEvent.countDocuments({ processingStatus: "failed" }),
    BookingSyncEvent.countDocuments({ processingStatus: "processed" }),
    BookingSyncEvent.find({ processingStatus: "failed" })
      .sort({ updatedAt: -1 })
      .limit(10)
      .select("reservationId lastError attempts updatedAt")
      .lean(),
  ]);
  return {
    enabled: Boolean(config.enabled),
    configured: runtimeState.configured,
    hotelId: config.hotelId || "",
    mappedRoomTypeIds: Object.keys(config.roomTypeMap || {}),
    running: runtimeState.running,
    lastStartedAt: runtimeState.lastStartedAt,
    lastSucceededAt: runtimeState.lastSucceededAt,
    lastErrorAt: runtimeState.lastErrorAt,
    lastError: runtimeState.lastError,
    lastFetchedCount: runtimeState.lastFetchedCount,
    lastProcessedCount: runtimeState.lastProcessedCount,
    queue: { pending, failed, processed },
    recentFailures,
  };
};

module.exports = {
  calendarStayDays,
  dateAtHotelTime,
  findAvailablePhysicalRoom,
  getBookingSyncStatus,
  normalizeCategory,
  processPendingEvents,
  processReservation,
  resolveRoomCategory,
  compareEventOrder,
  runBookingSyncOnce,
  saveIncomingReservations,
  splitFullName,
  startBookingSync,
};
