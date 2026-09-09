const AuditLog = require("../model/AuditLog");

const buildActor = (user = {}) => ({
  userId: String(user.id || user.userId || ""),
  role: String(user.role || ""),
  login: String(user.login || ""),
  firstname: String(user.firstname || ""),
  lastname: String(user.lastname || ""),
});

const getRequestIp = (req) =>
  String(
    req.headers["x-forwarded-for"] ||
      req.headers["x-real-ip"] ||
      req.ip ||
      req.socket?.remoteAddress ||
      "",
  )
    .split(",")[0]
    .trim();

const serializeDoc = (value) => {
  if (!value) return value;
  if (typeof value.toObject === "function") {
    return value.toObject({ depopulate: true, versionKey: false });
  }
  return value;
};

const pickGuestSnapshot = (guest) => {
  const item = serializeDoc(guest);
  if (!item) return null;
  return {
    id: String(item._id || ""),
    firstname: item.firstname,
    lastname: item.lastname,
    passport: item.passport,
    phone: item.phone,
    room: item.room ? String(item.room) : "",
    status: item.status,
    bookedForAt: item.bookedForAt,
    checkInAt: item.checkInAt,
    checkOutAt: item.checkOutAt,
    checkoutDueAt: item.checkoutDueAt,
    stayDays: item.stayDays,
    billableDays: item.billableDays,
    dailyRate: item.dailyRate,
    totalAmount: item.totalAmount,
    paidAmount: item.paidAmount,
    debtAmount: item.debtAmount,
    source: item.source,
    group: item.group ? String(item.group) : "",
  };
};

const writeAuditLog = async (req, payload = {}) => {
  try {
    await AuditLog.create({
      actor: payload.actor || buildActor(req.admin),
      action: payload.action,
      entity: payload.entity,
      entityId: String(payload.entityId || ""),
      description: payload.description || "",
      before: payload.before ?? null,
      after: payload.after ?? null,
      changes: payload.changes ?? null,
      meta: payload.meta ?? null,
      ip: getRequestIp(req),
      userAgent: String(req.headers["user-agent"] || ""),
    });
  } catch (error) {
    console.error("Audit log yozilmadi:", error.message);
  }
};

module.exports = {
  pickGuestSnapshot,
  writeAuditLog,
};
