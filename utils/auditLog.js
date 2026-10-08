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

const normalizeForComparison = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toHexString === "function") {
    return value.toHexString();
  }
  if (Array.isArray(value)) return value.map(normalizeForComparison);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = normalizeForComparison(value[key]);
        return result;
      }, {});
  }
  return value;
};

const valuesAreEqual = (left, right) =>
  JSON.stringify(normalizeForComparison(left)) ===
  JSON.stringify(normalizeForComparison(right));

const buildChanges = (before, after, suppliedChanges, inferChanges = true) => {
  const serializedBefore = serializeDoc(before);
  const serializedAfter = serializeDoc(after);
  const canCompareSnapshots =
    serializedBefore &&
    serializedAfter &&
    typeof serializedBefore === "object" &&
    typeof serializedAfter === "object" &&
    !Array.isArray(serializedBefore) &&
    !Array.isArray(serializedAfter);
  const candidates = inferChanges && canCompareSnapshots
    ? [...new Set([...Object.keys(serializedBefore), ...Object.keys(serializedAfter)])].reduce(
        (result, key) => {
          if (!["_id", "id", "__v", "createdAt", "updatedAt"].includes(key)) {
            result[key] = {
              from: serializedBefore[key],
              to: serializedAfter[key],
            };
          }
          return result;
        },
        {},
      )
    : {};

  if (suppliedChanges && typeof suppliedChanges === "object") {
    Object.assign(candidates, suppliedChanges);
  }

  if (!Object.keys(candidates).length) return null;

  const changes = Object.entries(candidates).reduce((result, [key, change]) => {
    const from = change?.from;
    const to = change?.to;
    if (!valuesAreEqual(from, to)) result[key] = { from, to };
    return result;
  }, {});

  return Object.keys(changes).length ? changes : null;
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
    email: item.email,
    organization: item.organization,
    room: item.room ? String(item.room) : "",
    guestType: item.guestType,
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
    note: item.note,
    isBlacklisted: item.isBlacklisted,
    group: item.group ? String(item.group) : "",
  };
};

const writeAuditLog = async (req, payload = {}) => {
  try {
    const before = serializeDoc(payload.before ?? null);
    const after = serializeDoc(payload.after ?? null);
    await AuditLog.create({
      actor: payload.actor || buildActor(req.admin),
      action: payload.action,
      entity: payload.entity,
      entityId: String(payload.entityId || ""),
      description: payload.description || "",
      before,
      after,
      changes: buildChanges(
        before,
        after,
        payload.changes,
        payload.inferChanges !== false,
      ),
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
