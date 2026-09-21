const recordRoomTransfer = (guest, previousRoomId, nextRoomId, changedAt = new Date()) => {
  if (String(previousRoomId) === String(nextRoomId) || guest.status !== "active") return false;

  const start = new Date(guest.checkInAt || changedAt);
  const transferAt = new Date(Math.max(changedAt.getTime(), start.getTime()));
  const stays = Array.from(guest.roomStays || []);

  if (!stays.length) {
    stays.push({ room: previousRoomId, from: start, to: transferAt });
  } else {
    const last = stays[stays.length - 1];
    const lastStart = new Date(last.from);
    if (lastStart.getTime() >= transferAt.getTime()) {
      stays.pop();
      if (stays.length) stays[stays.length - 1].to = transferAt;
    } else {
      last.to = transferAt;
    }
  }

  stays.push({ room: nextRoomId, from: transferAt, to: null });
  guest.roomStays = stays;
  return true;
};

const getRoomAt = (guest, at) => {
  const time = new Date(at).getTime();
  const stay = (guest.roomStays || []).find((item) => {
    const from = new Date(item.from).getTime();
    const to = item.to ? new Date(item.to).getTime() : Infinity;
    return from <= time && time < to;
  });
  return stay?.room || guest.room;
};

module.exports = { recordRoomTransfer, getRoomAt };
