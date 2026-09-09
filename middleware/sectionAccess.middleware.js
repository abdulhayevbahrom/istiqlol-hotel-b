const response = require("../utils/response");

const guestSections = new Set([
  "guests",
  "guests-active",
  "guests-history",
  "guests-debtors",
  "receipts",
  "groups",
]);

const hasSectionAccess = (sections = [], requiredSection = "") => {
  const current = Array.isArray(sections)
    ? sections.map((section) => String(section).toLowerCase().trim())
    : [];
  const required = String(requiredSection).toLowerCase().trim();

  if (!required) return false;
  if (current.includes(required)) return true;

  if (required.startsWith("guests-") && current.includes("guests")) {
    return true;
  }

  if (required === "groups" && current.includes("guests")) {
    return true;
  }

  if (required === "guests") {
    return current.some((section) => guestSections.has(section));
  }

  return false;
};

const requireSectionAccess = (section) => (req, res, next) => {
  const user = req.admin;

  if (!user) return response.unauthorized(res, "Avval tizimga kiring");
  if (hasSectionAccess(user.sections || [], section)) return next();

  return response.forbidden(res, "Bu bo'limga ruxsat yo'q");
};

module.exports = { hasSectionAccess, requireSectionAccess };
