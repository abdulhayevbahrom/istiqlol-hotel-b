const response = require("../utils/response");
const { hasFullAccess } = require("../utils/roleAccess");
const {
  getBookingSyncStatus,
  runBookingSyncOnce,
} = require("../integrations/booking/booking.service");

const getStatus = async (_req, res) => {
  try {
    return response.success(
      res,
      "Booking.com integratsiya holati",
      await getBookingSyncStatus(),
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const syncNow = async (req, res) => {
  try {
    if (!hasFullAccess(req.admin?.role)) {
      return response.forbidden(
        res,
        "Booking.com sinxronizatsiyasini faqat administrator ishga tushira oladi",
      );
    }
    const result = await runBookingSyncOnce(req.app.get("socket"));
    return response.success(res, "Booking.com sinxronizatsiyasi yakunlandi", result);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

module.exports = {
  getStatus,
  syncNow,
};
