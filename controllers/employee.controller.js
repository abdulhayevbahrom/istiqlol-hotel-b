const Employee = require("../model/Employee");
const StaffAttendance = require("../model/StaffAttendance");
const StaffPayrollEntry = require("../model/StaffPayrollEntry");
const response = require("../utils/response");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { writeAuditLog } = require("../utils/auditLog");

const ACCESS_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "30d";
const REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET_KEY || process.env.JWT_SECRET_KEY;
const EMPLOYEE_LIST_FIELDS =
  "firstname lastname position role salary salaryType canLogin login sections isActive createdAt";

const buildTokenPayload = (employee) => ({
  id: employee._id,
  role: String(employee.role || employee.position || "").toLowerCase().trim(),
  login: employee.login,
  sections: employee.sections || [],
  tv: Number(employee.tokenVersion || 1),
});

const signAccessToken = (employee) =>
  jwt.sign(buildTokenPayload(employee), process.env.JWT_SECRET_KEY, {
    expiresIn: ACCESS_EXPIRES_IN,
  });

const signRefreshToken = (employee) =>
  jwt.sign({ id: employee._id, login: employee.login }, REFRESH_SECRET, {
    expiresIn: REFRESH_EXPIRES_IN,
  });

const employeeSnapshot = (employee) => {
  if (!employee) return null;
  const item =
    typeof employee.toObject === "function"
      ? employee.toObject({ versionKey: false })
      : employee;
  return {
    id: String(item._id || ""),
    firstname: item.firstname,
    lastname: item.lastname,
    position: item.position,
    role: item.role,
    salary: item.salary,
    salaryType: item.salaryType || "fixed",
    canLogin: item.canLogin,
    login: item.login,
    sections: item.sections || [],
    isActive: item.isActive,
  };
};

const actorFromEmployee = (employee) => ({
  userId: String(employee?._id || ""),
  role: String(employee?.role || employee?.position || "").toLowerCase().trim(),
  login: String(employee?.login || ""),
  firstname: String(employee?.firstname || ""),
  lastname: String(employee?.lastname || ""),
});

// Avval rol maydoni bo'lmagan hisoblarda Owner lavozimi ishlatilgan.
// Faqat bitta shunday hisob bo'lsa, uning rolini bir marta tiklaymiz.
const restoreLegacyOwnerRole = async (employee) => {
  const role = String(employee.role || "").toLowerCase().trim();
  if (!/^owner$/i.test(String(employee.position || "").trim()) ||
      !["", "staff"].includes(role)) return employee;

  const [existingOwner, legacyOwnerCount] = await Promise.all([
    Employee.exists({ role: "owner" }),
    Employee.countDocuments({ position: /^owner$/i }),
  ]);
  if (existingOwner || legacyOwnerCount !== 1) return employee;

  employee.role = "owner";
  try {
    await employee.save();
  } catch (error) {
    if (error.code !== 11000) throw error;
    employee.role = role;
  }
  return employee;
};

const createEmployee = async (req, res) => {
  try {
    const {
      firstname,
      lastname,
      position,
      role = "staff",
      salary,
      salaryType = "fixed",
      canLogin,
      login,
      sections,
      password,
    } = req.body;
    const normalizedRole = String(role || "staff").trim().toLowerCase();
    if (!normalizedRole) return response.error(res, "Rol nomi majburiy");

    if (normalizedRole === "owner") {
      const existingOwner = await Employee.exists({ $or: [{ role: "owner" }, { role: { $exists: false }, position: /^owner$/i }] });
      if (existingOwner) return response.error(res, "Owner allaqachon mavjud");
      if (!["owner", "admin"].includes(req.admin?.role)) return response.forbidden(res, "Owner rolini faqat owner yoki admin yaratadi");
      if (!canLogin) return response.error(res, "Owner uchun tizimga kirish majburiy");
    }
    if (normalizedRole === "admin" && req.admin?.role !== "owner") return response.forbidden(res, "Admin rolini faqat owner beradi");

    let normalizedUsername;
    if (canLogin) {
      normalizedUsername = String(login).toLowerCase().trim();
      const exists = await Employee.findOne({
        login: normalizedUsername,
      });
      if (exists) {
        return response.error(res, "Bu login allaqachon band");
      }
    }

    let hashedPassword;
    if (canLogin) hashedPassword = await bcrypt.hash(String(password), 10);

    const employee = await Employee.create({
      firstname,
      lastname,
      position,
      role: normalizedRole,
      salary,
      salaryType,
      salaryHistory: [{ fromMonth: new Date().toISOString().slice(0, 7), salary, salaryType }],
      canLogin,
      login: canLogin ? normalizedUsername : undefined,
      sections,
      password: canLogin ? hashedPassword : undefined,
    });

    await writeAuditLog(req, {
      action: "EMPLOYEE_CREATED",
      entity: "Employee",
      entityId: employee._id,
      description: `${employee.firstname} ${employee.lastname} hodimi qo'shildi`,
      after: employeeSnapshot(employee),
      meta: { passwordSet: Boolean(canLogin && password) },
    });

    return response.created(res, "Hodim muvaffaqiyatli qo'shildi", employee);
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.role) return response.error(res, "Owner allaqachon mavjud");
    return response.serverError(res, error.message);
  }
};

const getEmployees = async (_, res) => {
  try {
    const employees = await Employee.find()
      .select(EMPLOYEE_LIST_FIELDS)
      .sort({ createdAt: -1 })
      .lean();
    return response.success(res, "Hodimlar ro'yxati", employees);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const getEmployeeById = async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return response.notFound(res, "Hodim topilmadi");

    return response.success(res, "Hodim ma'lumotlari", employee);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };
    if (Object.prototype.hasOwnProperty.call(updates, "role")) {
      updates.role = String(updates.role).trim().toLowerCase();
      if (!updates.role) return response.error(res, "Rol nomi majburiy");
    }
    const currentEmployee = await Employee.findById(id);

    if (!currentEmployee) return response.notFound(res, "Hodim topilmadi");
    const currentRole = String(currentEmployee.role || currentEmployee.position || "").toLowerCase().trim();
    if (currentRole === "owner" && updates.role && updates.role !== "owner") return response.forbidden(res, "Yagona owner rolini o'zgartirib bo'lmaydi");
    if (currentRole === "owner" && req.admin?.role !== "owner") return response.forbidden(res, "Owner ma'lumotlarini faqat owner o'zgartiradi");
    if (currentRole === "owner" && updates.isActive === false) return response.forbidden(res, "Ownerni faoliyatsiz qilib bo'lmaydi");
    if (updates.role && updates.role !== currentRole && updates.role !== "owner" && req.admin?.role !== "owner") return response.forbidden(res, "Rollarni faqat owner o'zgartiradi");
    if (updates.role === "owner" && currentRole !== "owner") {
      const existingOwner = await Employee.exists({ $or: [{ role: "owner" }, { role: { $exists: false }, position: /^owner$/i }] });
      if (existingOwner) return response.error(res, "Owner allaqachon mavjud");
      if (!["owner", "admin"].includes(req.admin?.role)) return response.forbidden(res, "Owner rolini faqat owner yoki admin beradi");
    }
    const before = employeeSnapshot(currentEmployee);
    const nextSalary = Object.prototype.hasOwnProperty.call(updates, "salary") ? updates.salary : currentEmployee.salary;
    const nextSalaryType = updates.salaryType || currentEmployee.salaryType || "fixed";
    if (nextSalary !== currentEmployee.salary || nextSalaryType !== (currentEmployee.salaryType || "fixed")) {
      const month = new Date().toISOString().slice(0, 7);
      const history = currentEmployee.salaryHistory?.length
        ? currentEmployee.salaryHistory.map((item) => ({ fromMonth: item.fromMonth, salary: item.salary, salaryType: item.salaryType }))
        : [{ fromMonth: currentEmployee.createdAt?.toISOString().slice(0, 7) || month, salary: currentEmployee.salary, salaryType: currentEmployee.salaryType || "fixed" }];
      const existing = history.findIndex((item) => item.fromMonth === month);
      if (existing >= 0) history[existing] = { fromMonth: month, salary: nextSalary, salaryType: nextSalaryType };
      else history.push({ fromMonth: month, salary: nextSalary, salaryType: nextSalaryType });
      updates.salaryHistory = history;
    }
    const passwordChanged = Boolean(updates.password);

    const nextCanLogin = Object.prototype.hasOwnProperty.call(
      updates,
      "canLogin",
    )
      ? Boolean(updates.canLogin)
      : currentEmployee.canLogin;

    if ((updates.role === "owner" || currentRole === "owner") && !nextCanLogin) return response.error(res, "Owner tizimga kira olishi kerak");

    if (nextCanLogin === true) {
      const nextLogin = updates.login
        ? String(updates.login).toLowerCase().trim()
        : currentEmployee.login;

      if (!nextLogin) {
        return response.error(res, "canLogin true bo'lsa login majburiy");
      }

      const exists = await Employee.findOne({
        login: nextLogin,
        _id: { $ne: id },
      });
      if (exists) return response.error(res, "Bu login allaqachon band");
      updates.login = nextLogin;
      updates.canLogin = true;

      if (updates.password) {
        updates.password = await bcrypt.hash(String(updates.password), 10);
      }
    }

    let updateQuery = updates;
    if (nextCanLogin === false) {
      updateQuery = {
        ...updates,
        canLogin: false,
        $unset: { login: 1, password: 1 },
      };
      delete updateQuery.login;
      delete updateQuery.password;
    }

    const shouldInvalidateSession =
      (Object.prototype.hasOwnProperty.call(updates, "isActive") && updates.isActive === false) ||
      (updates.role && updates.role !== currentRole);

    if (shouldInvalidateSession) {
      updateQuery.tokenVersion = Number(currentEmployee.tokenVersion || 1) + 1;
      updateQuery.refreshToken = "";
    }

    const employee = await Employee.findByIdAndUpdate(id, updateQuery, {
      returnDocument: "after",
      runValidators: true,
    });

    await writeAuditLog(req, {
      action: "EMPLOYEE_UPDATED",
      entity: "Employee",
      entityId: employee._id,
      description: `${employee.firstname} ${employee.lastname} hodimi yangilandi`,
      before,
      after: employeeSnapshot(employee),
      changes: {
        position: { from: before?.position, to: employee.position },
        role: { from: before?.role, to: employee.role },
        canLogin: { from: before?.canLogin, to: employee.canLogin },
        login: { from: before?.login, to: employee.login },
        sections: { from: before?.sections, to: employee.sections || [] },
        isActive: { from: before?.isActive, to: employee.isActive },
        passwordChanged,
      },
    });

    if (shouldInvalidateSession) {
      const io = req.app.get("socket");
      if (io) {
        io.to(`user:${id}`).emit("force_logout", {
          reason: updates.isActive === false ? "employee_deactivated" : "role_changed",
        });
      }
    }
    return response.success(res, "Hodim yangilandi", employee);
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.role) return response.error(res, "Owner allaqachon mavjud");
    return response.serverError(res, error.message);
  }
};

const deleteEmployee = async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return response.notFound(res, "Hodim topilmadi");
    if (String(employee.role || employee.position || "").toLowerCase().trim() === "owner") return response.forbidden(res, "Ownerni o'chirib bo'lmaydi");
    const hasPayrollHistory = await Promise.all([
      StaffAttendance.exists({ employee: employee._id }),
      StaffPayrollEntry.exists({ employee: employee._id }),
    ]);
    if (hasPayrollHistory.some(Boolean)) return response.error(res, "Hodimning davomat yoki oylik tarixi bor. Hisobotni saqlash uchun uni faoliyatsiz qiling");
    const before = employeeSnapshot(employee);

    const io = req.app.get("socket");
    if (io) {
      io.to(`user:${employee._id}`).emit("force_logout", {
        reason: "employee_deleted",
      });
    }

    await Employee.findByIdAndDelete(req.params.id);

    await writeAuditLog(req, {
      action: "EMPLOYEE_DELETED",
      entity: "Employee",
      entityId: employee._id,
      description: `${employee.firstname} ${employee.lastname} hodimi o'chirildi`,
      before,
    });

    return response.success(res, "Hodim o'chirildi");
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const loginEmployee = async (req, res) => {
  try {
    const login = String(req.body.login || "")
      .toLowerCase()
      .trim();
    const password = String(req.body.password || "");

    const employee = await Employee.findOne({
      login,
      canLogin: true,
      isActive: true,
    }).select("+password");

    if (!employee)
      return response.unauthorized(res, "Login yoki parol noto'g'ri");

    const passwordMatch = await bcrypt.compare(
      password,
      employee.password || "",
    );

    if (!passwordMatch)
      return response.unauthorized(res, "Login yoki parol noto'g'ri");

    await restoreLegacyOwnerRole(employee);
    const normalizedRole = String(employee.role || employee.position || "").toLowerCase().trim();
    const token = signAccessToken(employee);
    const refreshToken = signRefreshToken(employee);
    employee.refreshToken = refreshToken;
    await employee.save();

    await writeAuditLog(req, {
      actor: actorFromEmployee(employee),
      action: "USER_LOGIN",
      entity: "Employee",
      entityId: employee._id,
      description: `${employee.firstname} ${employee.lastname} tizimga kirdi`,
    });

    return response.success(res, "Muvaffaqiyatli kirildi", {
      token,
      refreshToken,
      user: {
        id: employee._id,
        firstname: employee.firstname,
        lastname: employee.lastname,
        position: employee.position,
        role: normalizedRole,
        sections: employee.sections || [],
      },
    });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const logoutEmployee = async (req, res) => {
  try {
    await writeAuditLog(req, {
      action: "USER_LOGOUT",
      entity: "Employee",
      entityId: req.admin?.id,
      description: `${req.admin?.firstname || ""} ${req.admin?.lastname || ""}`.trim()
        ? `${req.admin.firstname} ${req.admin.lastname} tizimdan chiqdi`
        : `${req.admin?.login || "Foydalanuvchi"} tizimdan chiqdi`,
    });
    return response.success(res, "Tizimdan chiqildi");
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const refreshEmployeeToken = async (req, res) => {
  try {
    const refreshToken = String(req.body.refreshToken || "").trim();
    let payload;
    try {
      payload = jwt.verify(refreshToken, REFRESH_SECRET);
    } catch (error) {
      return response.unauthorized(res, "Refresh token yaroqsiz");
    }

    const employee = await Employee.findOne({
      _id: payload?.id,
      canLogin: true,
      isActive: true,
    }).select("+refreshToken");

    if (!employee || employee.refreshToken !== refreshToken) {
      return response.unauthorized(res, "Refresh token yaroqsiz");
    }

    await restoreLegacyOwnerRole(employee);

    const nextAccessToken = signAccessToken(employee);
    const nextRefreshToken = signRefreshToken(employee);
    employee.refreshToken = nextRefreshToken;
    await employee.save();

    return response.success(res, "Token yangilandi", {
      token: nextAccessToken,
      refreshToken: nextRefreshToken,
      user: {
        id: employee._id,
        firstname: employee.firstname,
        lastname: employee.lastname,
        position: employee.position,
        role: String(employee.role || employee.position || "").toLowerCase().trim(),
        sections: employee.sections || [],
      },
    });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

module.exports = {
  createEmployee,
  getEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
  loginEmployee,
  logoutEmployee,
  refreshEmployeeToken,
};
