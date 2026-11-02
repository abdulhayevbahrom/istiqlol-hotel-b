const Employee = require("../model/Employee");

const apiCall = async (method, body) => {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) return { ok: false, skipped: true };
  const result = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!result.ok) throw new Error(`Telegram API: ${result.status}`);
  return result.json();
};

const notifyRoomTask = async (room) => {
  const query = room.task?.type === "cleaning"
    ? { isActive: true, telegramChatId: { $ne: "" }, assignedAreas: { $elemMatch: { korpus: room.korpus, floor: room.floor } } }
    : { isActive: true, telegramChatId: { $ne: "" }, $or: [{ role: { $in: ["zavxoz", "zaphos", "zavhos"] } }, { position: /zav\s*x?o?z|zaphos/i }] };
  const employees = await Employee.find(query).select("telegramChatId").lean();
  const title = room.task?.type === "cleaning" ? "🧹 Xonani tozalash kerak" : "🛠 Xonada ta'mirlash kerak";
  const reason = room.task?.reason ? `\nSabab: ${room.task.reason}` : "";
  await Promise.allSettled(employees.map((employee) => apiCall("sendMessage", {
    chat_id: employee.telegramChatId,
    text: `${title}\nXona: ${room.korpus}-${room.roomNumber}\nQavat: ${room.floor}${reason}`,
    reply_markup: { inline_keyboard: [[{ text: room.task?.type === "cleaning" ? "✅ Tayyor" : "✅ Tuzatildi", callback_data: `room_done:${room._id}` }]] },
  })));
  return employees.length;
};

module.exports = { apiCall, notifyRoomTask };
