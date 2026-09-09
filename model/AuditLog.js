const mongoose = require("mongoose");

const actorSchema = new mongoose.Schema(
  {
    userId: { type: String, default: "" },
    role: { type: String, default: "" },
    login: { type: String, default: "" },
    firstname: { type: String, default: "" },
    lastname: { type: String, default: "" },
  },
  { _id: false },
);

const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: actorSchema, default: null },
    action: { type: String, required: true, trim: true },
    entity: { type: String, required: true, trim: true },
    entityId: { type: String, default: "", index: true },
    description: { type: String, default: "", trim: true },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    changes: { type: mongoose.Schema.Types.Mixed, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ entity: 1, createdAt: -1 });
auditLogSchema.index({ "actor.userId": 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
