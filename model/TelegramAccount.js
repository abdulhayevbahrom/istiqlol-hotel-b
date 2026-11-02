const mongoose = require("mongoose");

const telegramAccountSchema = new mongoose.Schema(
  {
    telegramUserId: { type: String, required: true, unique: true, trim: true },
    chatId: { type: String, required: true, trim: true },
    username: { type: String, trim: true, default: "" },
    firstname: { type: String, trim: true, default: "" },
    lastname: { type: String, trim: true, default: "" },
    verificationCode: { type: String, trim: true, default: "" },
    codeExpiresAt: { type: Date, default: null },
    attempts: { type: Number, default: 0, min: 0 },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    status: { type: String, enum: ["pending", "verified", "blocked"], default: "pending" },
    verifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

telegramAccountSchema.index(
  { employee: 1 },
  { unique: true, partialFilterExpression: { employee: { $type: "objectId" } } },
);
telegramAccountSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("TelegramAccount", telegramAccountSchema);
