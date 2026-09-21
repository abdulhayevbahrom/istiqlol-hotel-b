const mongoose = require("mongoose");
const Employee = require("../model/Employee");
const Attendance = require("../model/StaffAttendance");
const Entry = require("../model/StaffPayrollEntry");
const response = require("../utils/response");

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const validMonth = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const validId = (value) => mongoose.isValidObjectId(value);
const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const fail = (res, error) => response.serverError(res, error.message);
const employeeFor = async (id) => validId(id) ? Employee.findById(id) : null;

const listAttendance = async (req, res) => {
  try {
    const month = String(req.query.month || "");
    if (!validMonth(month)) return response.error(res, "Oy YYYY-MM shaklida bo'lishi kerak");
    const rows = await Attendance.find({ date: { $gte: `${month}-01`, $lte: `${month}-31` } }).sort({ date: -1 }).lean();
    return response.success(res, "Davomat", rows);
  } catch (error) { return fail(res, error); }
};

const saveAttendance = async (req, res) => {
  try {
    const { employeeId, date, status, hours } = req.body;
    const employee = await employeeFor(employeeId);
    if (!employee) return response.notFound(res, "Hodim topilmadi");
    if (!validDate(date)) return response.error(res, "Sana noto'g'ri");
    const hourly = employee.salaryType === "hourly";
    if (hourly ? (!Number.isFinite(hours) || hours < 0 || hours > 24 || status !== undefined) : (!['present', 'absent'].includes(status) || hours !== undefined)) {
      return response.error(res, hourly ? "Soatlik hodimga 0–24 soat kiriting" : "Oylik hodim uchun keldi yoki kelmadi tanlang");
    }
    const data = hourly ? { $set: { hours }, $unset: { status: 1 } } : { $set: { status }, $unset: { hours: 1 } };
    const row = await Attendance.findOneAndUpdate({ employee: employeeId, date }, data, { upsert: true, new: true, runValidators: true });
    return response.success(res, "Davomat saqlandi", row);
  } catch (error) { if (error.code === 11000) return response.error(res, "Bu sana uchun davomat mavjud"); return fail(res, error); }
};

const updateAttendance = async (req, res) => {
  try {
    if (!validId(req.params.id)) return response.error(res, "ID noto'g'ri");
    const existing = await Attendance.findById(req.params.id);
    if (!existing) return response.notFound(res, "Davomat topilmadi");
    const employeeId = String(req.body.employeeId || existing.employee);
    const date = req.body.date || existing.date;
    const employee = await employeeFor(employeeId);
    if (!employee) return response.notFound(res, "Hodim topilmadi");
    if (!validDate(date)) return response.error(res, "Sana noto'g'ri");
    const hourly = employee.salaryType === "hourly";
    const hours = req.body.hours ?? existing.hours;
    const status = req.body.status ?? existing.status;
    if (hourly ? (!Number.isFinite(hours) || hours < 0 || hours > 24) : !['present', 'absent'].includes(status)) return response.error(res, "Davomat qiymati noto'g'ri");
    existing.employee = employeeId;
    existing.date = date;
    existing.status = hourly ? undefined : status;
    existing.hours = hourly ? hours : undefined;
    await existing.save();
    return response.success(res, "Davomat yangilandi", existing);
  } catch (error) { if (error.code === 11000) return response.error(res, "Bu sana uchun davomat mavjud"); return fail(res, error); }
};

const deleteAttendance = async (req, res) => {
  try {
    if (!validId(req.params.id)) return response.error(res, "ID noto'g'ri");
    const row = await Attendance.findByIdAndDelete(req.params.id);
    return row ? response.success(res, "Davomat o'chirildi") : response.notFound(res, "Davomat topilmadi");
  } catch (error) { return fail(res, error); }
};

const listEntries = async (req, res) => {
  try {
    const month = String(req.query.month || "");
    if (!validMonth(month)) return response.error(res, "Oy YYYY-MM shaklida bo'lishi kerak");
    const rows = await Entry.find({ date: { $gte: `${month}-01`, $lte: `${month}-31` } }).sort({ date: -1, createdAt: -1 }).lean();
    return response.success(res, "Oylik amallari", rows);
  } catch (error) { return fail(res, error); }
};

const employeeEntryHistory = async (req, res) => {
  try {
    const employeeId = String(req.query.employeeId || "");
    if (!validId(employeeId)) return response.error(res, "Hodimni tanlang");
    if (!await Employee.exists({ _id: employeeId })) return response.notFound(res, "Hodim topilmadi");
    const rows = await Entry.find({ employee: employeeId, type: { $in: ["bonus", "fine"] } })
      .sort({ date: -1, createdAt: -1 })
      .lean();
    return response.success(res, "Bonus va jarimalar tarixi", rows);
  } catch (error) { return fail(res, error); }
};

const paymentHistory = async (req, res) => {
  try {
    const employeeId = String(req.query.employeeId || "");
    const from = String(req.query.from || "");
    const to = String(req.query.to || "");
    const targetMonth = String(req.query.targetMonth || "");
    if (employeeId && !validId(employeeId)) return response.error(res, "Hodim noto'g'ri");
    if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) return response.error(res, "Sana oralig'i noto'g'ri");
    if (targetMonth && !validMonth(targetMonth)) return response.error(res, "Oy noto'g'ri");
    const filter = { type: "payment" };
    if (employeeId) filter.employee = employeeId;
    if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    if (targetMonth) filter.targetMonth = targetMonth;
    const rows = await Entry.find(filter).sort({ date: -1, createdAt: -1 }).lean();
    return response.success(res, "Oylik to'lovlari tarixi", rows);
  } catch (error) { return fail(res, error); }
};

const validateEntry = async (body, res) => {
  if (!await employeeFor(body.employeeId)) { response.notFound(res, "Hodim topilmadi"); return false; }
  if (!validDate(body.date) || !['payment', 'bonus', 'fine'].includes(body.type) || !Number.isFinite(body.amount) || body.amount <= 0 || String(body.note || "").length > 300 || (body.type === "payment" && !validMonth(body.targetMonth))) {
    response.error(res, "Oylik amali noto'g'ri"); return false;
  }
  return true;
};
const saveEntry = async (req, res) => {
  try {
    if (!await validateEntry(req.body, res)) return;
    const { employeeId, date, targetMonth, type, amount, note } = req.body;
    const row = await Entry.create({ employee: employeeId, date, targetMonth: type === "payment" ? targetMonth : undefined, type, amount, note });
    return response.created(res, "Oylik amali saqlandi", row);
  } catch (error) { return fail(res, error); }
};
const updateEntry = async (req, res) => {
  try {
    if (!validId(req.params.id)) return response.error(res, "ID noto'g'ri");
    const row = await Entry.findById(req.params.id);
    if (!row) return response.notFound(res, "Oylik amali topilmadi");
    const next = { employeeId: String(req.body.employeeId || row.employee), date: req.body.date || row.date, targetMonth: req.body.targetMonth || row.targetMonth || row.date.slice(0, 7), type: req.body.type || row.type, amount: req.body.amount ?? row.amount, note: req.body.note ?? row.note };
    if (!await validateEntry(next, res)) return;
    Object.assign(row, { employee: next.employeeId, date: next.date, targetMonth: next.type === "payment" ? next.targetMonth : undefined, type: next.type, amount: next.amount, note: next.note });
    await row.save();
    return response.success(res, "Oylik amali yangilandi", row);
  } catch (error) { return fail(res, error); }
};
const deleteEntry = async (req, res) => {
  try {
    if (!validId(req.params.id)) return response.error(res, "ID noto'g'ri");
    const row = await Entry.findByIdAndDelete(req.params.id);
    return row ? response.success(res, "Oylik amali o'chirildi") : response.notFound(res, "Oylik amali topilmadi");
  } catch (error) { return fail(res, error); }
};

const calculateReport = async (month, employeeId) => {
  const employeeFilter = employeeId ? { _id: employeeId } : {};
  const [employees, attendances, entries] = await Promise.all([
    Employee.find(employeeFilter).select("firstname lastname position salary salaryType salaryHistory createdAt").lean(),
    Attendance.find({ ...(employeeId ? { employee: employeeId } : {}), date: { $lt: `${month}-32` } }).lean(),
    Entry.find(employeeId ? { employee: employeeId } : {}).lean(),
  ]);
  return employees.map((employee) => {
    const id = String(employee._id);
    const ownAttendance = attendances.filter((a) => String(a.employee) === id);
    const ownEntries = entries.filter((e) => String(e.employee) === id);
    const monthAttendance = ownAttendance.filter((a) => a.date.startsWith(month));
    const hours = money(monthAttendance.reduce((sum, a) => sum + Number(a.hours || 0), 0));
    const rateAt = (target) => {
      const history = [...(employee.salaryHistory || [])].sort((a, b) => a.fromMonth.localeCompare(b.fromMonth));
      const rate = history.filter((item) => item.fromMonth <= target).at(-1) || history[0];
      return { salaryType: rate?.salaryType || employee.salaryType || "fixed", salary: Number(rate?.salary ?? employee.salary ?? 0) };
    };
    const { salaryType, salary } = rateAt(month);
    const createdMonth = employee.createdAt ? new Date(employee.createdAt).toISOString().slice(0, 7) : month;
    const currentMonth = new Date().toISOString().slice(0, 7);
    const earned = (target) => {
      const rate = rateAt(target);
      return rate.salaryType === "fixed"
        ? (target >= createdMonth && target <= currentMonth ? rate.salary : 0)
        : money(ownAttendance.filter((a) => a.date.startsWith(target)).reduce((sum, a) => sum + Number(a.hours || 0), 0) * rate.salary);
    };
    const entryMonth = (entry) => entry.type === "payment" && entry.targetMonth ? entry.targetMonth : entry.date.slice(0, 7);
    const monthEntries = ownEntries.filter((e) => entryMonth(e) === month);
    const sumType = (list, type) => money(list.filter((e) => e.type === type).reduce((sum, e) => sum + Number(e.amount || 0), 0));
    const previousMonths = new Set();
    for (let cursor = createdMonth; cursor < month; ) {
      previousMonths.add(cursor);
      const [year, m] = cursor.split('-').map(Number);
      cursor = `${year + (m === 12 ? 1 : 0)}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
    }
    const previousEarned = [...previousMonths].reduce((sum, m) => sum + earned(m), 0);
    const previousEntries = ownEntries.filter((e) => entryMonth(e) < month);
    const previousBalance = money(previousEarned + sumType(previousEntries, 'bonus') - sumType(previousEntries, 'fine') - sumType(previousEntries, 'payment'));
    const thisEarned = earned(month);
    const bonus = sumType(monthEntries, 'bonus');
    const fine = sumType(monthEntries, 'fine');
    const paid = sumType(monthEntries, 'payment');
    const monthBalance = money(thisEarned + bonus - fine - paid);
    const totalBalance = money(previousBalance + monthBalance);
    return { employeeId: id, fullName: `${employee.firstname} ${employee.lastname}`, position: employee.position, salaryType, rate: salary, hours, presentDays: monthAttendance.filter((a) => a.status === 'present').length, absentDays: monthAttendance.filter((a) => a.status === 'absent').length, earned: thisEarned, bonus, fine, paid, monthBalance, previousBalance, totalBalance, previousDebt: Math.max(0, previousBalance), previousCredit: Math.max(0, -previousBalance), totalDebt: Math.max(0, totalBalance), totalCredit: Math.max(0, -totalBalance) };
  });
};

const report = async (req, res) => {
  try {
    const month = String(req.query.month || "");
    if (!validMonth(month)) return response.error(res, "Oy YYYY-MM shaklida bo'lishi kerak");
    const rows = await calculateReport(month);
    return response.success(res, "Oyma-oy oylik hisoboti", rows);
  } catch (error) { return fail(res, error); }
};

const history = async (req, res) => {
  try {
    const employeeId = String(req.query.employeeId || "");
    if (!validId(employeeId)) return response.error(res, "Hodimni tanlang");
    const employee = await Employee.findById(employeeId).select("createdAt").lean();
    if (!employee) return response.notFound(res, "Hodim topilmadi");
    const firstMonth = employee.createdAt ? new Date(employee.createdAt).toISOString().slice(0, 7) : new Date().toISOString().slice(0, 7);
    const lastMonth = new Date().toISOString().slice(0, 7);
    const months = [];
    for (let cursor = firstMonth; cursor <= lastMonth; ) {
      months.push(cursor);
      const [year, m] = cursor.split("-").map(Number);
      cursor = `${year + (m === 12 ? 1 : 0)}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
    }
    const rows = [];
    for (const targetMonth of months) {
      const [row] = await calculateReport(targetMonth, employeeId);
      if (row) rows.push({ month: targetMonth, ...row });
    }
    return response.success(res, "Oylik tarixi", rows.reverse());
  } catch (error) { return fail(res, error); }
};

const outstandingMonths = async (req, res) => {
  try {
    const employeeId = String(req.query.employeeId || "");
    if (!validId(employeeId)) return response.error(res, "Hodimni tanlang");
    const employee = await Employee.findById(employeeId).select("createdAt").lean();
    if (!employee) return response.notFound(res, "Hodim topilmadi");
    const firstMonth = employee.createdAt ? new Date(employee.createdAt).toISOString().slice(0, 7) : new Date().toISOString().slice(0, 7);
    const lastMonth = new Date().toISOString().slice(0, 7);
    const rows = [];
    for (let cursor = firstMonth; cursor <= lastMonth; ) {
      const [row] = await calculateReport(cursor, employeeId);
      if (row && row.monthBalance > 0) rows.push({ month: cursor, debt: row.monthBalance, earned: row.earned, paid: row.paid });
      const [year, m] = cursor.split("-").map(Number);
      cursor = `${year + (m === 12 ? 1 : 0)}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
    }
    return response.success(res, "To'lanmagan oylar", rows.reverse());
  } catch (error) { return fail(res, error); }
};

module.exports = { listAttendance, saveAttendance, updateAttendance, deleteAttendance, listEntries, employeeEntryHistory, paymentHistory, saveEntry, updateEntry, deleteEntry, report, history, outstandingMonths };
