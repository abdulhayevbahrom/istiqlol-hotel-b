const receiptServiceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
    quantity: { type: "number", minimum: 0 },
    price: { type: "number", minimum: 0 },
    total: { type: "number", minimum: 0 },
  },
};

const createReceiptSchema = {
  type: "object",
  additionalProperties: false,
  required: ["hotelName", "receiptNumber", "receiptDate", "guestName"],
  properties: {
    hotelName: {
      type: "string",
      enum: ["Istiqlol", "Das", "Versal", "Golder Art"],
    },
    receiptNumber: { type: "string", minLength: 1 },
    receiptDate: { type: "string" },
    guestName: { type: "string", minLength: 1 },
    room: { type: "string" },
    checkInAt: { type: ["string", "null"] },
    checkOutAt: { type: ["string", "null"] },
    services: { type: "array", items: receiptServiceSchema, default: [] },
    totalAmount: { type: "number", minimum: 0 },
    totalWords: { type: "string" },
    administrator: { type: "string" },
    printedAt: { type: "string" },
  },
};

const updateReceiptSchema = {
  ...createReceiptSchema,
  required: ["hotelName", "receiptNumber", "receiptDate", "guestName"],
};

const receiptIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
  },
};

module.exports = {
  createReceiptSchema,
  updateReceiptSchema,
  receiptIdParamsSchema,
};
