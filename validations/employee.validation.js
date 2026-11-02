const createEmployeeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["firstname", "lastname", "position", "salary"],
  properties: {
    firstname: { type: "string", minLength: 1 },
    lastname: { type: "string", minLength: 1 },
    position: { type: "string", minLength: 1 },
    role: { type: "string", minLength: 1, maxLength: 40 },
    salary: { type: "number", minimum: 0 },
    salaryType: { type: "string", enum: ["fixed", "hourly"], default: "fixed" },
    canLogin: { type: "boolean", default: false },
    login: { type: "string", minLength: 3 },
    password: { type: "string", minLength: 4 },
    sections: {
      type: "array",
      default: [],
      items: { type: "string", minLength: 1 },
    },
    telegramChatId: { type: "string", maxLength: 40 },
    assignedAreas: { type: "array", items: { type: "object", additionalProperties: false, required: ["korpus", "floor"], properties: { korpus: { type: "string", enum: ["A", "B"] }, floor: { type: "number", minimum: 1 } } } },
    telegramAccountId: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
  },
  allOf: [
    {
      if: {
        properties: { canLogin: { const: true } },
      },
      then: {
        required: ["login", "password"],
      },
    },
  ],
};

const updateEmployeeSchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    firstname: { type: "string", minLength: 1 },
    lastname: { type: "string", minLength: 1 },
    position: { type: "string", minLength: 1 },
    role: { type: "string", minLength: 1, maxLength: 40 },
    salary: { type: "number", minimum: 0 },
    salaryType: { type: "string", enum: ["fixed", "hourly"] },
    canLogin: { type: "boolean" },
    login: { type: "string", minLength: 3 },
    password: { type: "string", minLength: 4 },
    sections: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    isActive: { type: "boolean" },
    telegramChatId: { type: "string", maxLength: 40 },
    assignedAreas: { type: "array", items: { type: "object", additionalProperties: false, required: ["korpus", "floor"], properties: { korpus: { type: "string", enum: ["A", "B"] }, floor: { type: "number", minimum: 1 } } } },
    telegramAccountId: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
  },
};

const employeeIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: {
      type: "string",
      pattern: "^[0-9a-fA-F]{24}$",
    },
  },
};

const loginEmployeeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["login", "password"],
  properties: {
    login: { type: "string", minLength: 3 },
    password: { type: "string", minLength: 4 },
  },
};

const refreshTokenSchema = {
  type: "object",
  additionalProperties: false,
  required: ["refreshToken"],
  properties: {
    refreshToken: { type: "string", minLength: 10 },
  },
};

module.exports = {
  createEmployeeSchema,
  updateEmployeeSchema,
  employeeIdParamsSchema,
  loginEmployeeSchema,
  refreshTokenSchema,
};
