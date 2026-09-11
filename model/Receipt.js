const mongoose = require("mongoose");

const receiptServiceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, min: 0, default: 0 },
    price: { type: Number, min: 0, default: 0 },
    total: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

const receiptSchema = new mongoose.Schema(
  {
    hotelName: {
      type: String,
      required: true,
      trim: true,
      enum: [
        "DIAMOND AZIYA SERVIS MCHJ",
        "VERSAL-N PLAZA MCHJ",
        "COMFORT HOSTEL MCHJ",
      ],
    },
    receiptNumber: { type: String, required: true, trim: true, unique: true },
    receiptDate: { type: Date, required: true },
    guestName: { type: String, required: true, trim: true },
    room: { type: String, required: true, trim: true },
    checkInAt: { type: Date, required: true },
    checkOutAt: { type: Date, required: true },
    remainingDays: { type: Number, min: 0, default: 0 },
    services: { type: [receiptServiceSchema], default: [] },
    totalAmount: { type: Number, min: 0, default: 0 },
    totalWords: { type: String, required: true, trim: true },
    administrator: { type: String, required: true, trim: true },
    printedAt: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  },
  { timestamps: true },
);

receiptSchema.index({ receiptNumber: "text", guestName: "text", room: "text" });
receiptSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Receipt", receiptSchema);
