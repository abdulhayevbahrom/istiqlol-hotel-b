const crypto = require("node:crypto");
const Room = require("../model/Room");
const Employee = require("../model/Employee");
const TelegramAccount = require("../model/TelegramAccount");
const response = require("../utils/response");
const { apiCall } = require("../utils/telegramBot");

const CLEANING_MENU = "🧹 Tozalanishi kerak bo'lgan xonalar";
const menuMarkup = { keyboard: [[{ text: CLEANING_MENU }]], resize_keyboard: true, is_persistent: true };
const sendText = (chatId, text, extra = {}) => apiCall("sendMessage", { chat_id: chatId, text, ...extra });

const getTelegramAccounts = async (_, res) => {
  try {
    const accounts = await TelegramAccount.find({ status: { $in: ["pending", "verified"] } })
      .populate("employee", "firstname lastname").sort({ createdAt: -1 }).lean();
    return response.success(res, "Telegram so'rovlari", accounts);
  } catch (error) { return response.serverError(res, error.message); }
};

const startVerification = async (message) => {
  const from = message.from || {};
  const existing = await TelegramAccount.findOne({ telegramUserId: String(from.id) });
  if (existing?.status === "verified") {
    await sendText(message.chat.id, "Profilingiz tasdiqlangan.", { reply_markup: menuMarkup });
    return;
  }
  await TelegramAccount.findOneAndUpdate(
    { telegramUserId: String(from.id) },
    { $set: {
      chatId: String(message.chat.id), username: String(from.username || ""),
      firstname: String(from.first_name || ""), lastname: String(from.last_name || ""),
      verificationCode: String(crypto.randomInt(100000, 1000000)),
      codeExpiresAt: new Date(Date.now() + 10 * 60 * 1000), attempts: 0,
      employee: null, status: "pending", verifiedAt: null,
    } },
    { upsert: true, returnDocument: "after", runValidators: true },
  );
  await sendText(message.chat.id, "Tasdiqlash so'rovi yaratildi. Admin bergan kodni kiriting.", { reply_markup: { remove_keyboard: true } });
};

const verifyCode = async (message, account, text) => {
  if (!/^\d{6}$/.test(text)) return false;
  if (!account || account.status !== "pending") {
    await sendText(message.chat.id, "Tasdiqlash so'rovi topilmadi. /start buyrug'ini yuboring."); return true;
  }
  if (account.attempts >= 5) {
    account.status = "blocked"; await account.save();
    await sendText(message.chat.id, "Urinishlar soni tugadi. /start orqali yangi so'rov yarating."); return true;
  }
  if (!account.codeExpiresAt || account.codeExpiresAt.getTime() < Date.now()) {
    await sendText(message.chat.id, "Tasdiqlash kodi muddati tugagan. /start orqali yangi kod yarating."); return true;
  }
  if (!account.employee) {
    await sendText(message.chat.id, "Admin hali profilingizni xodimga biriktirmagan."); return true;
  }
  if (account.verificationCode !== text) {
    account.attempts += 1; if (account.attempts >= 5) account.status = "blocked"; await account.save();
    await sendText(message.chat.id, "Tasdiqlash kodi noto'g'ri."); return true;
  }
  await Employee.findByIdAndUpdate(account.employee, { telegramChatId: account.chatId });
  account.status = "verified"; account.verificationCode = ""; account.codeExpiresAt = null;
  account.attempts = 0; account.verifiedAt = new Date(); await account.save();
  await sendText(message.chat.id, "✅ Profilingiz tasdiqlandi.", { reply_markup: menuMarkup });
  return true;
};

const showCleaningRooms = async (message, account) => {
  const employee = account?.status === "verified"
    ? await Employee.findById(account.employee).select("assignedAreas isActive").lean() : null;
  if (!employee?.isActive) {
    await sendText(message.chat.id, "Profil tasdiqlanmagan. /start buyrug'ini yuboring."); return;
  }
  const areas = employee.assignedAreas || [];
  const rooms = areas.length ? await Room.find({
    status: "tozalash", $or: areas.map((area) => ({ korpus: area.korpus, floor: area.floor })),
  }).sort({ korpus: 1, floor: 1, roomNumber: 1 }).lean() : [];
  if (!rooms.length) {
    await sendText(message.chat.id, "✅ Hozir tozalanishi kerak bo'lgan xonalar yo'q.", { reply_markup: menuMarkup }); return;
  }
  for (const room of rooms) {
    // eslint-disable-next-line no-await-in-loop
    await sendText(message.chat.id, `🧹 ${room.korpus}-${room.roomNumber} xona\n${room.floor}-qavat`, {
      reply_markup: { inline_keyboard: [[{ text: "✅ Tayyor", callback_data: `room_done:${room._id}` }]] },
    });
  }
};

const completeRoomFromBot = async (req, callback, roomId) => {
  const account = await TelegramAccount.findOne({ telegramUserId: String(callback.from?.id || ""), status: "verified" }).lean();
  const employee = account ? await Employee.findById(account.employee).lean() : null;
  const room = await Room.findById(roomId);
  const assigned = employee && room && (employee.assignedAreas || []).some(
    (area) => area.korpus === room.korpus && Number(area.floor) === Number(room.floor),
  );
  const isMaintenance = employee && ["zavxoz", "zaphos", "zavhos"].includes(String(employee.role || "").toLowerCase());
  if (!room || !employee || (!assigned && !isMaintenance)) {
    await apiCall("answerCallbackQuery", { callback_query_id: callback.id, text: "Bu xona sizga biriktirilmagan", show_alert: true }); return;
  }
  const completed = await Room.findOneAndUpdate(
    { _id: roomId, status: { $in: ["tozalash", "remont"] }, activeGuestsCount: 0 },
    { $set: { status: "bosh" }, $unset: { task: 1 } }, { returnDocument: "after" },
  );
  await apiCall("answerCallbackQuery", { callback_query_id: callback.id, text: completed ? "Xona aktiv holatga o'tdi" : "Bu xona allaqachon tayyor", show_alert: false });
  if (completed && callback.message) {
    await apiCall("editMessageReplyMarkup", { chat_id: callback.message.chat.id, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } });
    req.app.get("socket")?.emit("room_updated", { roomId: String(completed._id), status: "bosh", reason: "telegram_room_task_completed" });
  }
};

const telegramWebhook = async (req, res) => {
  try {
    const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "");
    if (secret && req.get("x-telegram-bot-api-secret-token") !== secret) return res.sendStatus(403);
    const callback = req.body?.callback_query;
    const callbackMatch = String(callback?.data || "").match(/^room_done:([0-9a-f]{24})$/i);
    if (callbackMatch) await completeRoomFromBot(req, callback, callbackMatch[1]);
    const message = req.body?.message;
    if (message?.text) {
      const text = String(message.text).trim();
      if (text === "/start") await startVerification(message);
      else {
        const account = await TelegramAccount.findOne({ telegramUserId: String(message.from?.id || "") });
        if (text === CLEANING_MENU) await showCleaningRooms(message, account);
        else if (!(await verifyCode(message, account, text))) {
          await sendText(message.chat.id, account?.status === "verified" ? "Menyudagi tugmalardan foydalaning." : "6 xonali tasdiqlash kodini kiriting.", account?.status === "verified" ? { reply_markup: menuMarkup } : {});
        }
      }
    }
    return res.sendStatus(200);
  } catch (error) {
    console.error("Telegram webhook xatosi:", error.message); return res.sendStatus(200);
  }
};

module.exports = { telegramWebhook, getTelegramAccounts };
