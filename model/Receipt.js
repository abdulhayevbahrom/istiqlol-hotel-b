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
        '"Diamond Aziya Servis" MCHJga qarshli Istiqlol mehmonxonasi',
        '"Diamond Aziya Servis" MCHJga qarshli DAS mehmonxonasi',
        '"Diamond Aziya Servis" MCHJga qarshli Versal mehmonxonasi',
        '"Comfort Hostel" MCHJga qarashli Golden Art yotoqxonasi',
      ],
    },
    receiptNumber: { type: String, required: true, trim: true, unique: true },
    receiptDate: { type: Date, required: true },
    guestName: { type: String, required: true, trim: true },
    room: { type: String, required: true, trim: true },
    checkInAt: { type: Date, required: true },
    checkOutAt: { type: Date, required: true },
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
