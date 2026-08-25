const mongoose = require("mongoose");

const integrationLockSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    owner: { type: String, required: true, trim: true },
    lockedUntil: { type: Date, required: true, index: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("IntegrationLock", integrationLockSchema);
