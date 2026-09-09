const HallBooking = require("../model/HallBooking");
const Employee = require("../model/Employee");
const response = require("../utils/response");
const { writeAuditLog } = require("../utils/auditLog");

const buildCreatedBy = async (user) => {
  const actor = {
    userId: String(user?.id || ""),
    role: String(user?.role || ""),
    login: String(user?.login || ""),
    firstname: "",
    lastname: "",
  };

  if (!actor.userId) return actor;
  const employee = await Employee.findById(actor.userId)
    .select("firstname lastname")
    .lean();
  actor.firstname = String(employee?.firstname || "");
  actor.lastname = String(employee?.lastname || "");
  return actor;
};

const toStartOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const toEndOfDay = (value) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

const normalizeBookingInput = (body = {}) => {
  const hallName = String(body.hallName || "").trim();
  const startDate = toStartOfDay(body.startDate);
  const endDate = toEndOfDay(body.endDate);
  const totalAmount = Number(body.totalAmount || 0);
  const paidAmount = Number(body.paidAmount || 0);

  return {
    hallName,
    eventName: String(body.eventName || "").trim(),
    customerFirstname: String(body.customerFirstname || "").trim(),
    customerLastname: String(body.customerLastname || "").trim(),
    phone: String(body.phone || "").trim(),
    startDate,
    endDate,
    totalAmount,
    paidAmount,
    debtAmount: Math.max(totalAmount - paidAmount, 0),
    note: String(body.note || "").trim(),
  };
};

const validateDates = (startDate, endDate) =>
  !Number.isNaN(startDate.getTime()) &&
  !Number.isNaN(endDate.getTime()) &&
  startDate.getTime() <= endDate.getTime();

const parsePaymentDate = (value) => {
  if (!value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const hasOverlap = async ({ hallName, startDate, endDate, excludeId = null }) => {
  const filter = {
    hallName,
    status: { $ne: "canceled" },
    startDate: { $lte: endDate },
    endDate: { $gte: startDate },
  };
  if (excludeId) filter._id = { $ne: excludeId };
  const exists = await HallBooking.findOne(filter).select("_id").lean();
  return Boolean(exists);
};

const attachRuntimeState = (booking) => {
  const now = Date.now();
  const start = new Date(booking.startDate).getTime();
  const end = new Date(booking.endDate).getTime();
  const customerFull = String(booking.customerName || "").trim();
  const [fallbackFirstname = "", ...rest] = customerFull.split(" ");
  const fallbackLastname = rest.join(" ").trim();
  const normalized = {
    ...booking,
    customerFirstname:
      booking.customerFirstname || fallbackFirstname || "",
    customerLastname:
      booking.customerLastname || fallbackLastname || "",
  };
  if (normalized.status === "canceled") {
    return { ...normalized, eventState: "canceled" };
  }
  if (now < start) return { ...normalized, eventState: "upcoming" };
  if (now > end) return { ...normalized, eventState: "past" };
  return { ...normalized, eventState: "ongoing" };
};

const hallBookingSnapshot = (booking) => {
  if (!booking) return null;
  const item =
    typeof booking.toObject === "function"
      ? booking.toObject({ versionKey: false })
      : booking;
  return {
    id: String(item._id || ""),
    hallName: item.hallName,
    eventName: item.eventName,
    customerFirstname: item.customerFirstname,
    customerLastname: item.customerLastname,
    phone: item.phone,
    startDate: item.startDate,
    endDate: item.endDate,
    totalAmount: item.totalAmount,
    paidAmount: item.paidAmount,
    debtAmount: item.debtAmount,
    status: item.status,
    payments: item.payments || [],
  };
};

const createHallBooking = async (req, res) => {
  try {
    const payload = normalizeBookingInput(req.body);

    if (
      !payload.hallName ||
      !payload.eventName ||
      !payload.customerFirstname ||
      !payload.customerLastname
    ) {
      return response.error(res, "Majburiy maydonlar to'ldirilmagan");
    }

    if (!validateDates(payload.startDate, payload.endDate)) {
      return response.error(res, "Sana oralig'i noto'g'ri");
    }
    if (payload.paidAmount > payload.totalAmount) {
      return response.error(res, "Boshlang'ich to'lov jami summadan oshmasin");
    }
    const initialPaymentDate = parsePaymentDate(req.body.initialPaymentDate);
    if (!initialPaymentDate) return response.error(res, "To'lov sanasi noto'g'ri");

    if (await hasOverlap(payload)) {
      return response.error(
        res,
        "Ushbu zal ushbu sana oralig'ida allaqachon bron qilingan",
      );
    }

    const booking = await HallBooking.create({
      ...payload,
      payments:
        payload.paidAmount > 0
          ? [{
              amount: payload.paidAmount,
              type: "naqd",
              note: "Oldindan to'lov (zakalad)",
              createdAt: initialPaymentDate,
            }]
          : [],
      createdBy: await buildCreatedBy(req.admin),
    });

    await writeAuditLog(req, {
      action: "HALL_BOOKING_CREATED",
      entity: "HallBooking",
      entityId: booking._id,
      description: `${booking.hallName} zali uchun bron qo'shildi`,
      after: hallBookingSnapshot(booking),
    });

    return response.created(res, "Zal ijarasi qo'shildi", attachRuntimeState(booking.toObject()));
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const getHallBookings = async (req, res) => {
  try {
    const tab = String(req.query.tab || "all").toLowerCase();
    const filter = {};
    if (tab === "debtors") filter.debtAmount = { $gt: 0 };
    const items = await HallBooking.find(filter).sort({ createdAt: -1 }).lean();
    return response.success(
      res,
      "Zal ijaralari ro'yxati",
      items.map(attachRuntimeState),
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const updateHallBooking = async (req, res) => {
  try {
    const current = await HallBooking.findById(req.params.id);
    if (!current) return response.notFound(res, "Zal ijarasi topilmadi");
    const before = hallBookingSnapshot(current);

    const payload = normalizeBookingInput({
      ...current.toObject(),
      ...req.body,
    });

    if (!validateDates(payload.startDate, payload.endDate)) {
      return response.error(res, "Sana oralig'i noto'g'ri");
    }
    if (Number(current.paidAmount || 0) > payload.totalAmount) {
      return response.error(
        res,
        "Jami summa mavjud to'lovdan kam bo'lishi mumkin emas",
      );
    }

    if (await hasOverlap({ ...payload, excludeId: current._id })) {
      return response.error(
        res,
        "Ushbu zal ushbu sana oralig'ida allaqachon bron qilingan",
      );
    }

    current.hallName = payload.hallName;
    current.eventName = payload.eventName;
    current.customerFirstname = payload.customerFirstname;
    current.customerLastname = payload.customerLastname;
    current.phone = payload.phone;
    current.startDate = payload.startDate;
    current.endDate = payload.endDate;
    current.totalAmount = payload.totalAmount;
    current.note = payload.note;
    current.debtAmount = Math.max(current.totalAmount - Number(current.paidAmount || 0), 0);
    await current.save();

    await writeAuditLog(req, {
      action: "HALL_BOOKING_UPDATED",
      entity: "HallBooking",
      entityId: current._id,
      description: `${current.hallName} zali broni yangilandi`,
      before,
      after: hallBookingSnapshot(current),
      changes: {
        totalAmount: { from: before?.totalAmount, to: current.totalAmount },
        debtAmount: { from: before?.debtAmount, to: current.debtAmount },
        startDate: { from: before?.startDate, to: current.startDate },
        endDate: { from: before?.endDate, to: current.endDate },
      },
    });

    return response.success(
      res,
      "Zal ijarasi yangilandi",
      attachRuntimeState(current.toObject()),
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const addHallBookingPayment = async (req, res) => {
  try {
    const booking = await HallBooking.findById(req.params.id);
    if (!booking) return response.notFound(res, "Zal ijarasi topilmadi");
    const before = hallBookingSnapshot(booking);

    const amount = Number(req.body.amount || 0);
    const paymentDate = parsePaymentDate(req.body.paymentDate);
    if (!paymentDate) return response.error(res, "To'lov sanasi noto'g'ri");
    if (amount <= 0) return response.error(res, "To'lov summasi noto'g'ri");
    if (amount > Number(booking.debtAmount || 0)) {
      return response.error(res, "To'lov qarzdan oshmasin");
    }

    booking.payments.push({
      amount,
      type: String(req.body.type || "naqd"),
      note: String(req.body.note || "").trim(),
      createdAt: paymentDate,
    });
    booking.paidAmount = Number(booking.paidAmount || 0) + amount;
    booking.debtAmount = Math.max(Number(booking.totalAmount || 0) - booking.paidAmount, 0);
    await booking.save();

    await writeAuditLog(req, {
      action: "HALL_PAYMENT_ADDED",
      entity: "HallBooking",
      entityId: booking._id,
      description: `${booking.hallName} zali uchun to'lov qo'shildi`,
      before,
      after: hallBookingSnapshot(booking),
      meta: { amount, type: req.body.type || "naqd" },
    });

    return response.success(
      res,
      "To'lov qo'shildi",
      attachRuntimeState(booking.toObject()),
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const cancelHallBooking = async (req, res) => {
  try {
    const booking = await HallBooking.findById(req.params.id);
    if (!booking) return response.notFound(res, "Zal ijarasi topilmadi");
    const before = hallBookingSnapshot(booking);
    if (booking.status === "canceled") {
      return response.error(res, "Buyurtma allaqachon bekor qilingan");
    }

    booking.status = "canceled";
    await booking.save();

    await writeAuditLog(req, {
      action: "HALL_BOOKING_CANCELLED",
      entity: "HallBooking",
      entityId: booking._id,
      description: `${booking.hallName} zali broni bekor qilindi`,
      before,
      after: hallBookingSnapshot(booking),
      changes: {
        status: { from: before?.status, to: booking.status },
      },
    });

    return response.success(
      res,
      "Buyurtma bekor qilindi",
      attachRuntimeState(booking.toObject()),
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const deleteHallBooking = async (req, res) => {
  try {
    const booking = await HallBooking.findByIdAndDelete(req.params.id);
    if (!booking) return response.notFound(res, "Zal ijarasi topilmadi");
    await writeAuditLog(req, {
      action: "HALL_BOOKING_DELETED",
      entity: "HallBooking",
      entityId: booking._id,
      description: `${booking.hallName} zali broni o'chirildi`,
      before: hallBookingSnapshot(booking),
    });
    return response.success(res, "Buyurtma o'chirildi");
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

module.exports = {
  createHallBooking,
  getHallBookings,
  updateHallBooking,
  addHallBookingPayment,
  cancelHallBooking,
  deleteHallBooking,
};
