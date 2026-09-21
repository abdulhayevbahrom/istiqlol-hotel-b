const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  status: { type: String, enum: ["present", "absent"], default: undefined },
  hours: { type: Number, min: 0, max: 24, default: undefined },
}, { timestamps: true });
schema.index({ employee: 1, date: 1 }, { unique: true });
module.exports = mongoose.model("StaffAttendance", schema);
