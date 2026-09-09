const receiptServiceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "quantity", "price", "total"],
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
  required: [
    "hotelName",
    "receiptNumber",
    "receiptDate",
    "guestName",
    "room",
    "checkInAt",
    "checkOutAt",
    "services",
    "totalAmount",
    "totalWords",
    "administrator",
  ],
  properties: {
    hotelName: {
      type: "string",
      enum: [
        "DIAMOND AZIYA SERVIS MCHJ",
        "VERSAL-N PLAZA MCHJ",
        "COMFORT HOSTEL MCHJ",
      ],
    },
    receiptNumber: { type: "string", minLength: 1 },
    receiptDate: { type: "string" },
    guestName: { type: "string", minLength: 1 },
    room: { type: "string", minLength: 1 },
    checkInAt: { type: "string", minLength: 1 },
    checkOutAt: { type: "string", minLength: 1 },
    services: { type: "array", minItems: 1, items: receiptServiceSchema },
    totalAmount: { type: "number", minimum: 0 },
    totalWords: { type: "string", minLength: 1 },
    administrator: { type: "string", minLength: 1 },
    printedAt: { type: "string" },
  },
};

const updateReceiptSchema = {
  ...createReceiptSchema,
  required: [
    "hotelName",
    "receiptNumber",
    "receiptDate",
    "guestName",
    "room",
    "checkInAt",
    "checkOutAt",
    "services",
    "totalAmount",
    "totalWords",
    "administrator",
  ],
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
