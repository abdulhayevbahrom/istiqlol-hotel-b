const normalizeDailyRates = (dailyRates = [], stayDays = 1, fallbackRate = 0) => {
  const expectedDays = Math.max(Number(stayDays || 1), 1);
  const saved = new Map(
    (Array.isArray(dailyRates) ? dailyRates : [])
      .filter((item) => Number(item?.day) >= 1)
      .map((item) => [Number(item.day), Math.max(Number(item.amount || 0), 0)]),
  );

  return Array.from({ length: expectedDays }, (_, index) => ({
    day: index + 1,
    amount: saved.has(index + 1)
      ? saved.get(index + 1)
      : Math.max(Number(fallbackRate || 0), 0),
  }));
};

// Persist explicit per-day prices as history. If a later day gets a different
// rate, previous days must keep their own amounts instead of inheriting it.
const compactDailyRates = (dailyRates = [], stayDays = 1, fallbackRate = 0) => {
  const expectedDays = Math.max(Number(stayDays || 1), 1);
  const values = new Map(
    (Array.isArray(dailyRates) ? dailyRates : [])
      .filter((item) => Number(item?.day) >= 1 && Number(item.day) <= expectedDays)
      .map((item) => [Number(item.day), Math.max(Number(item.amount || 0), 0)]),
  );

  return [...values.entries()]
    .sort(([firstDay], [secondDay]) => firstDay - secondDay)
    .map(([day, amount]) => ({ day, amount }));
};

const getDailyRateForDay = (guest, day) => {
  const rate = normalizeDailyRates(
    guest?.dailyRates,
    Math.max(Number(guest?.stayDays || 1), Number(day || 1)),
    guest?.dailyRate,
  ).find((item) => item.day === Number(day));
  return Number(rate?.amount || guest?.dailyRate || 0);
};

const getLodgingTotal = (guest, billableDays = guest?.billableDays) => {
  const days = Math.max(Number(billableDays || 1), 1);
  return Array.from({ length: days }, (_, index) =>
    getDailyRateForDay(guest, index + 1),
  ).reduce((sum, amount) => sum + amount, 0);
};

module.exports = {
  normalizeDailyRates,
  compactDailyRates,
  getDailyRateForDay,
  getLodgingTotal,
};
