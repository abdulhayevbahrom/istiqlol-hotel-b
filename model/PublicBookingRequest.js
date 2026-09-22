const mongoose = require("mongoose");

const publicBookingRequestSchema = new mongoose.Schema(
  {
    requestId: { type: String, required: true, unique: true, trim: true },
    fingerprint: { type: String, required: true, unique: true, sparse: true, trim: true },
  },
  { timestamps: true },
);

publicBookingRequestSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model("PublicBookingRequest", publicBookingRequestSchema);
