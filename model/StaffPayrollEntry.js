const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  targetMonth: { type: String, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  type: { type: String, required: true, enum: ["payment", "bonus", "fine"] },
  amount: { type: Number, required: true, min: 0.01 },
  note: { type: String, trim: true, maxlength: 300, default: "" },
}, { timestamps: true });
schema.index({ employee: 1, date: 1 });
module.exports = mongoose.model("StaffPayrollEntry", schema);
