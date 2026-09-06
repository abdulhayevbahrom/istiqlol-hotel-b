const Receipt = require("../model/Receipt");
const response = require("../utils/response");

const normalizeService = (service) => {
  const quantity = Number(service?.quantity || 0);
  const price = Number(service?.price || 0);
  const total = Number(service?.total ?? quantity * price);
  return {
    name: String(service?.name || "").trim(),
    quantity,
    price,
    total,
  };
};

const createReceipt = async (req, res) => {
  try {
    const services = (req.body.services || [])
      .map(normalizeService)
      .filter((service) => service.name);
    const totalAmount = services.reduce(
      (sum, service) => sum + Number(service.total || 0),
      0,
    );

    const receipt = await Receipt.create({
      hotelName: String(req.body.hotelName || "").trim(),
      receiptNumber: String(req.body.receiptNumber || "").trim(),
      receiptDate: req.body.receiptDate,
      guestName: String(req.body.guestName || "").trim(),
      room: String(req.body.room || "").trim(),
      checkInAt: req.body.checkInAt || null,
      checkOutAt: req.body.checkOutAt || null,
      services,
      totalAmount,
      totalWords: String(req.body.totalWords || "").trim(),
      administrator: String(req.body.administrator || "").trim(),
      printedAt: req.body.printedAt || new Date(),
      createdBy: req.admin?.id,
    });

    return response.created(res, "Kvitansiya saqlandi", receipt);
  } catch (error) {
    if (error?.code === 11000) {
      return response.error(res, "Bu kvitansiya raqami allaqachon mavjud");
    }
    return response.serverError(res, error.message);
  }
};

const buildReceiptPayload = (body) => {
  const services = (body.services || [])
    .map(normalizeService)
    .filter((service) => service.name);
  const totalAmount = services.reduce(
    (sum, service) => sum + Number(service.total || 0),
    0,
  );

  return {
    hotelName: String(body.hotelName || "").trim(),
    receiptNumber: String(body.receiptNumber || "").trim(),
    receiptDate: body.receiptDate,
    guestName: String(body.guestName || "").trim(),
    room: String(body.room || "").trim(),
    checkInAt: body.checkInAt || null,
    checkOutAt: body.checkOutAt || null,
    services,
    totalAmount,
    totalWords: String(body.totalWords || "").trim(),
    administrator: String(body.administrator || "").trim(),
    printedAt: body.printedAt || new Date(),
  };
};

const getReceipts = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const query = String(req.query.query || "").trim();
    const filter = {};

    if (query) {
      const regex = { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
      filter.$or = [
        { receiptNumber: regex },
        { guestName: regex },
        { room: regex },
        { hotelName: regex },
      ];
    }

    const [items, total] = await Promise.all([
      Receipt.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Receipt.countDocuments(filter),
    ]);

    return response.success(res, "Kvitansiyalar tarixi", {
      items,
      page,
      limit,
      total,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const updateReceipt = async (req, res) => {
  try {
    const receipt = await Receipt.findByIdAndUpdate(
      req.params.id,
      buildReceiptPayload(req.body),
      { returnDocument: "after", runValidators: true },
    );
    if (!receipt) return response.notFound(res, "Kvitansiya topilmadi");
    return response.success(res, "Kvitansiya yangilandi", receipt);
  } catch (error) {
    if (error?.code === 11000) {
      return response.error(res, "Bu kvitansiya raqami allaqachon mavjud");
    }
    return response.serverError(res, error.message);
  }
};

const deleteReceipt = async (req, res) => {
  try {
    const receipt = await Receipt.findByIdAndDelete(req.params.id);
    if (!receipt) return response.notFound(res, "Kvitansiya topilmadi");
    return response.success(res, "Kvitansiya o'chirildi");
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

module.exports = {
  createReceipt,
  getReceipts,
  updateReceipt,
  deleteReceipt,
};
