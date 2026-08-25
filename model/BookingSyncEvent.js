const mongoose = require("mongoose");

const bookingSyncEventSchema = new mongoose.Schema(
  {
    fingerprint: { type: String, required: true, unique: true, index: true },
    reservationId: { type: String, required: true, trim: true, index: true },
    hotelId: { type: String, required: true, trim: true },
    reservationStatus: {
      type: String,
      enum: ["new", "modified", "cancelled"],
      required: true,
    },
    externalModifiedAt: { type: Date, default: null },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    processingStatus: {
      type: String,
      enum: ["pending", "processing", "processed", "failed"],
      default: "pending",
      index: true,
    },
    attempts: { type: Number, default: 0, min: 0 },
    lastError: { type: String, default: "", trim: true },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

bookingSyncEventSchema.index({ processingStatus: 1, createdAt: 1 });

module.exports = mongoose.model("BookingSyncEvent", bookingSyncEventSchema);
