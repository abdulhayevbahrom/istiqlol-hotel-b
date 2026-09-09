const AuditLog = require("../model/AuditLog");
const response = require("../utils/response");

const getAuditLogs = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
    const filter = {};
    const query = String(req.query.query || "").trim();

    if (req.query.action) filter.action = String(req.query.action);
    if (req.query.entity) filter.entity = String(req.query.entity);
    if (req.query.actor) {
      filter.$or = [
        { "actor.login": { $regex: req.query.actor, $options: "i" } },
        { "actor.firstname": { $regex: req.query.actor, $options: "i" } },
        { "actor.lastname": { $regex: req.query.actor, $options: "i" } },
      ];
    }
    if (query) {
      filter.$or = [
        ...(filter.$or || []),
        { description: { $regex: query, $options: "i" } },
        { action: { $regex: query, $options: "i" } },
        { entity: { $regex: query, $options: "i" } },
        { entityId: { $regex: query, $options: "i" } },
        { "actor.login": { $regex: query, $options: "i" } },
      ];
    }
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
    }

    const [items, total, actions, entities] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter),
      AuditLog.distinct("action"),
      AuditLog.distinct("entity"),
    ]);

    return response.success(res, "Audit loglar", {
      items,
      actions: actions.sort(),
      entities: entities.sort(),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

module.exports = { getAuditLogs };
