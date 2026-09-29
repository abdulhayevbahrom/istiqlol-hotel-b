const moment = require("moment-timezone");
const Guest = require("../model/Guest");
const Expense = require("../model/Expense");
const Room = require("../model/Room");
const response = require("../utils/response");

const TIMEZONE = process.env.APP_TIMEZONE || "Asia/Tashkent";
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const WEEKDAY_LABELS = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Ju", "Shan"];
const PAYMENT_TYPES = [
  { type: "naqd", label: "Naqd pul" },
  { type: "karta", label: "Plastik karta" },
  { type: "bank", label: "Bank o'tkazma" },
];
const ROOM_CATEGORY_ORDER = [
  "Single Standart",
  "Superior Single Standart",
  "Twin Standart",
  "Triple Standart",
  "Quadruple Standart",
  "Junior Suite",
  "Deluxe Suite",
  "Luxury Suite",
];
const ROOM_CATEGORY_ORDER_INDEX = new Map(
  ROOM_CATEGORY_ORDER.map((category, index) => [category, index]),
);

const formatChange = (current, previous) => {
  const curr = Number(current || 0);
  const prev = Number(previous || 0);

  if (prev <= 0 && curr <= 0) return { percent: 0, up: true };
  if (prev <= 0 && curr > 0) return { percent: 100, up: true };

  const percent = Math.abs(((curr - prev) / prev) * 100);
  return {
    percent: Number(percent.toFixed(1)),
    up: curr >= prev,
  };
};

const getMonthBase = (monthQuery) => {
  if (MONTH_PATTERN.test(String(monthQuery || ""))) {
    return moment.tz(`${monthQuery}-01`, "YYYY-MM-DD", TIMEZONE).startOf("month");
  }
  return moment.tz(TIMEZONE).startOf("month");
};

const getRoomDateBase = (dateQuery) => {
  if (DATE_PATTERN.test(String(dateQuery || ""))) {
    const parsed = moment.tz(dateQuery, "YYYY-MM-DD", true, TIMEZONE);
    if (parsed.isValid()) return parsed.startOf("day");
  }
  return moment.tz(TIMEZONE).startOf("day");
};

const rangeContains = (from, to, at) => {
  const fromTime = from ? new Date(from).getTime() : Number.NaN;
  const toTime = to ? new Date(to).getTime() : Number.POSITIVE_INFINITY;
  const atTime = at.getTime();
  return Number.isFinite(fromTime) && fromTime <= atTime && atTime < toTime;
};

const getGuestRoomIdsAt = (guest, at) => {
  const fallbackEnd = guest.checkOutAt || guest.checkoutDueAt || null;
  const stays = Array.isArray(guest.roomStays) ? guest.roomStays : [];
  const matchingStayIds = stays
    .filter((stay) => rangeContains(stay.from, stay.to || fallbackEnd, at))
    .map((stay) => String(stay.room || ""))
    .filter(Boolean);

  if (stays.length) return [...new Set(matchingStayIds)];

  const startsAt = guest.status === "booked" ? guest.bookedForAt : guest.checkInAt;
  return rangeContains(startsAt, fallbackEnd, at) && guest.room
    ? [String(guest.room)]
    : [];
};

const getRoomOverviewForDate = async (roomDate) => {
  const now = moment.tz(TIMEZONE);
  const isToday = roomDate.isSame(now, "day");
  const referenceAt = isToday
    ? now.toDate()
    : roomDate.clone().endOf("day").toDate();
  const guestFilter = isToday
    ? { status: "active" }
    : {
        status: { $in: ["active", "booked", "checked_out"] },
        $or: [
          { checkInAt: { $lte: referenceAt } },
          { bookedForAt: { $lte: referenceAt } },
          { "roomStays.from": { $lte: referenceAt } },
        ],
      };
  const [rooms, guests] = await Promise.all([
    Room.find({}).select("_id category capacity status").lean(),
    Guest.find(guestFilter)
      .select("room roomStays status bookedForAt checkInAt checkOutAt checkoutDueAt")
      .lean(),
  ]);

  const occupiedRoomIds = new Set();
  const guestsByRoom = new Map();
  for (const guest of guests) {
    const roomIds = isToday
      ? guest.room
        ? [String(guest.room)]
        : []
      : getGuestRoomIdsAt(guest, referenceAt);
    for (const roomId of roomIds) {
      occupiedRoomIds.add(roomId);
      guestsByRoom.set(roomId, Number(guestsByRoom.get(roomId) || 0) + 1);
    }
  }

  const categoryMap = new Map();
  let occupied = 0;
  let free = 0;
  let repair = 0;
  let totalCapacity = 0;
  let guestsCount = 0;
  let availablePlaces = 0;

  for (const room of rooms) {
    const category = String(room.category || "Noma'lum");
    const capacity = Number(room.capacity || 0);
    const isRepair = room.status === "remont";
    const isOccupied = !isRepair && occupiedRoomIds.has(String(room._id));
    const roomGuests = isOccupied ? Number(guestsByRoom.get(String(room._id)) || 0) : 0;
    const row = categoryMap.get(category) || {
      category,
      total: 0,
      occupied: 0,
      free: 0,
      repair: 0,
      guests: 0,
      capacity: 0,
      availablePlaces: 0,
    };

    row.total += 1;
    row.capacity += capacity;
    row.guests += roomGuests;
    // "Bo'sh o'rin" faqat butunlay bo'sh xonalarning sig'imini ko'rsatadi.
    // Ichida kamida bitta mehmon bor xona (sig'imi to'lmagan bo'lsa ham) hisoblanmaydi.
    const roomAvailablePlaces = !isRepair && !isOccupied ? capacity : 0;
    row.availablePlaces += roomAvailablePlaces;
    if (isRepair) {
      row.repair += 1;
      repair += 1;
    } else if (isOccupied) {
      row.occupied += 1;
      occupied += 1;
    } else {
      row.free += 1;
      free += 1;
    }
    totalCapacity += capacity;
    guestsCount += roomGuests;
    availablePlaces += roomAvailablePlaces;
    categoryMap.set(category, row);
  }

  const total = rooms.length;
  return {
    date: roomDate.format("YYYY-MM-DD"),
    total,
    occupied,
    free,
    repair,
    guests: guestsCount,
    capacity: totalCapacity,
    availablePlaces,
    occupancyPercent:
      total > 0 ? Number(((occupied / total) * 100).toFixed(1)) : 0,
    categories: [...categoryMap.values()].sort((a, b) => {
      const aIndex = ROOM_CATEGORY_ORDER_INDEX.get(a.category);
      const bIndex = ROOM_CATEGORY_ORDER_INDEX.get(b.category);

      if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
      if (aIndex !== undefined) return -1;
      if (bIndex !== undefined) return 1;
      return a.category.localeCompare(b.category, "uz");
    }),
    chart: {
      labels: ["Band", "Bo'sh", "Remont"],
      values: [occupied, free, repair],
      colors: ["#c55b4c", "#2f786f", "#d1a13c"],
    },
  };
};

const getHistoricalRevenue = async (
  previousMonthStart,
  monthStart,
  previousDayStart,
  anchorDayStart,
) => {
  const [result] = await Guest.aggregate([
    { $unwind: "$payments" },
    {
      $match: {
        "payments.createdAt": {
          $gte: previousMonthStart,
          $lt: monthStart,
        },
      },
    },
    {
      $facet: {
        previousMonthTotal: [
          {
            $group: {
              _id: null,
              total: { $sum: { $ifNull: ["$payments.amount", 0] } },
            },
          },
        ],
        previousDayTotal: [
          {
            $match: {
              "payments.createdAt": {
                $gte: previousDayStart,
                $lt: anchorDayStart,
              },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: { $ifNull: ["$payments.amount", 0] } },
            },
          },
        ],
      },
    },
  ]);

  return {
    previousMonthRevenue: Number(result?.previousMonthTotal?.[0]?.total || 0),
    previousDayRevenue: Number(result?.previousDayTotal?.[0]?.total || 0),
  };
};

const getDashboardSummary = async (req, res) => {
  try {
    const base = getMonthBase(req.query.month);
    const roomDate = getRoomDateBase(req.query.roomDate);
    const monthKey = base.format("YYYY-MM");
    const monthStart = base.clone().startOf("month");
    const nextMonthStart = base.clone().add(1, "month").startOf("month");
    const monthEnd = base.clone().endOf("month");
    const previousMonthStart = base.clone().subtract(1, "month").startOf("month");
    const now = moment.tz(TIMEZONE);

    let anchor = now.clone();
    if (now.isBefore(monthStart)) anchor = monthStart.clone().endOf("day");
    if (now.isAfter(monthEnd)) anchor = monthEnd.clone().endOf("day");

    const anchorDayStart = anchor.clone().startOf("day");
    const nextDayStart = anchorDayStart.clone().add(1, "day");
    const previousDayStart = anchorDayStart.clone().subtract(1, "day");
    const dayAfterNextStart = nextDayStart.clone().add(1, "day");

    const [paymentsFacetResult = {}] = await Guest.aggregate([
      { $unwind: "$payments" },
      {
        $match: {
          "payments.createdAt": {
            $gte: monthStart.toDate(),
            $lt: nextMonthStart.toDate(),
          },
        },
      },
      {
        $facet: {
          daily: [
            {
              $group: {
                _id: {
                  $dayOfMonth: {
                    date: "$payments.createdAt",
                    timezone: TIMEZONE,
                  },
                },
                total: { $sum: { $ifNull: ["$payments.amount", 0] } },
              },
            },
          ],
          paymentTypes: [
            {
              $group: {
                _id: "$payments.type",
                total: { $sum: { $ifNull: ["$payments.amount", 0] } },
              },
            },
          ],
          monthlyTotal: [
            {
              $group: {
                _id: null,
                total: { $sum: { $ifNull: ["$payments.amount", 0] } },
              },
            },
          ],
          recentPayments: [
            { $sort: { "payments.createdAt": -1 } },
            { $limit: 6 },
            {
              $lookup: {
                from: "rooms",
                localField: "room",
                foreignField: "_id",
                as: "roomDoc",
              },
            },
            {
              $unwind: {
                path: "$roomDoc",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $project: {
                _id: 0,
                guestId: "$_id",
                guestName: {
                  $trim: {
                    input: {
                      $concat: [
                        { $ifNull: ["$firstname", ""] },
                        " ",
                        { $ifNull: ["$lastname", ""] },
                      ],
                    },
                  },
                },
                roomNumber: { $ifNull: ["$roomDoc.roomNumber", "-"] },
                status: { $ifNull: ["$status", "active"] },
                vip: { $ifNull: ["$vip", false] },
                amount: { $ifNull: ["$payments.amount", 0] },
                type: { $ifNull: ["$payments.type", "naqd"] },
                createdAt: "$payments.createdAt",
              },
            },
          ],
        },
      },
    ]);

    const dailyMap = new Map(
      (paymentsFacetResult?.daily || []).map((item) => [
        Number(item?._id || 0),
        Number(item?.total || 0),
      ]),
    );

    const daysInMonth = base.daysInMonth();
    const monthlySeries = Array.from({ length: daysInMonth }, (_, index) => ({
      day: index + 1,
      value: Number(dailyMap.get(index + 1) || 0),
    }));

    const monthRevenue = Number(paymentsFacetResult?.monthlyTotal?.[0]?.total || 0);
    const { previousMonthRevenue, previousDayRevenue } = await getHistoricalRevenue(
      previousMonthStart.toDate(),
      monthStart.toDate(),
      previousDayStart.toDate(),
      anchorDayStart.toDate(),
    );

    const todayRevenue =
      Number(dailyMap.get(anchorDayStart.date()) || 0);

    const yesterdayRevenue =
      previousDayStart.isSame(monthStart, "month")
        ? Number(dailyMap.get(previousDayStart.date()) || 0)
        : previousDayRevenue;

    const paymentTypeMap = {};
    for (const item of paymentsFacetResult?.paymentTypes || []) {
      const key = String(item?._id || "");
      paymentTypeMap[key] = Number(item?.total || 0);
    }

    let paymentShareTotal = 0;
    for (const value of Object.values(paymentTypeMap)) {
      paymentShareTotal += Number(value || 0);
    }

    const paymentShare = PAYMENT_TYPES.map((item) => {
      const amount = Number(paymentTypeMap[item.type] || 0);
      const percent =
        paymentShareTotal > 0 ? Math.round((amount / paymentShareTotal) * 100) : 0;
      return {
        type: item.type,
        label: item.label,
        amount,
        percent,
      };
    });

    const weeklyRevenue = Array.from({ length: 7 }, (_, index) => {
      const dayMoment = anchorDayStart.clone().subtract(6 - index, "day");
      const isInMonth = dayMoment.isSame(monthStart, "month");
      const amount = isInMonth ? Number(dailyMap.get(dayMoment.date()) || 0) : 0;

      return {
        date: dayMoment.format("YYYY-MM-DD"),
        label: WEEKDAY_LABELS[dayMoment.day()],
        amount,
      };
    });
    const weeklyPeakAmount = Math.max(...weeklyRevenue.map((item) => Number(item?.amount || 0)), 1);
    const weeklyRevenueReady = weeklyRevenue.map((item) => ({
      ...item,
      heightPercent: Math.max((Number(item?.amount || 0) / weeklyPeakAmount) * 100, 3),
    }));

    const overlapMonthFilter = {
      checkInAt: { $lte: monthEnd.toDate() },
      $or: [{ checkOutAt: null }, { checkOutAt: { $gte: monthStart.toDate() } }],
    };

    const [activeGuests, bookedGuests, debtorsAgg = {}, arrivedCount, leftCount, pendingNextDayCount, vipCount, expensesFacet = {}, roomOverview] =
      await Promise.all([
        Guest.countDocuments({
          ...overlapMonthFilter,
          status: "active",
        }),
        Guest.countDocuments({
          status: "booked",
          bookedForAt: { $gte: monthStart.toDate(), $lt: nextMonthStart.toDate() },
        }),
        Guest.aggregate([
          {
            $match: {
              ...overlapMonthFilter,
              debtAmount: { $gt: 0 },
            },
          },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              totalDebt: { $sum: "$debtAmount" },
            },
          },
        ]).then((result) => result?.[0] || {}),
        Guest.countDocuments({
          checkInAt: { $gte: anchorDayStart.toDate(), $lt: nextDayStart.toDate() },
        }),
        Guest.countDocuments({
          checkOutAt: { $gte: anchorDayStart.toDate(), $lt: nextDayStart.toDate() },
        }),
        Guest.countDocuments({
          status: "booked",
          bookedForAt: { $gte: nextDayStart.toDate(), $lt: dayAfterNextStart.toDate() },
        }),
        Guest.countDocuments({
          vip: true,
          checkInAt: { $lte: nextDayStart.toDate() },
          $or: [{ checkOutAt: null }, { checkOutAt: { $gte: anchorDayStart.toDate() } }],
        }),
        Expense.aggregate([
          {
            $match: {
              spentAt: { $gte: monthStart.toDate(), $lt: nextMonthStart.toDate() },
            },
          },
          {
            $facet: {
              daily: [
                {
                  $group: {
                    _id: {
                      $dayOfMonth: {
                        date: "$spentAt",
                        timezone: TIMEZONE,
                      },
                    },
                    total: { $sum: { $ifNull: ["$amount", 0] } },
                  },
                },
              ],
              monthlyTotal: [
                {
                  $group: {
                    _id: null,
                    total: { $sum: { $ifNull: ["$amount", 0] } },
                  },
                },
              ],
            },
          },
        ]).then((result) => result?.[0] || {}),
        getRoomOverviewForDate(roomDate),
      ]);

    const expenseDailyMap = new Map(
      (expensesFacet?.daily || []).map((item) => [
        Number(item?._id || 0),
        Number(item?.total || 0),
      ]),
    );
    const monthlyExpenseSeries = Array.from({ length: daysInMonth }, (_, index) => ({
      day: index + 1,
      value: Number(expenseDailyMap.get(index + 1) || 0),
    }));
    const expensesTotal = Number(expensesFacet?.monthlyTotal?.[0]?.total || 0);
    const monthlyChart = {
      labels: Array.from({ length: daysInMonth }, (_, index) => String(index + 1)),
      revenue: monthlySeries.map((item) => Number(item?.value || 0)),
      expense: monthlyExpenseSeries.map((item) => Number(item?.value || 0)),
      totalRevenue: monthRevenue,
      totalExpense: expensesTotal,
      width: Math.max(760, daysInMonth * 34),
    };
    const totalCapacity = Number(roomOverview?.capacity || 0);

    const recentPayments = (paymentsFacetResult?.recentPayments || []).map((item) => ({
      ...item,
      guestName: item?.guestName || "-",
    }));

    return response.success(res, "Dashboard ma'lumotlari", {
      month: monthKey,
      timezone: TIMEZONE,
      generatedAt: new Date().toISOString(),
      kpis: {
        todayRevenue,
        yesterdayRevenue,
        todayChange: formatChange(todayRevenue, yesterdayRevenue),
        monthRevenue,
        previousMonthRevenue,
        monthChange: formatChange(monthRevenue, previousMonthRevenue),
        activeGuests: Number(activeGuests || 0),
        totalCapacity,
        bookedGuests: Number(bookedGuests || 0),
        debtorsCount: Number(debtorsAgg?.count || 0),
        debtorsAmount: Number(debtorsAgg?.totalDebt || 0),
      },
      dailySnapshot: {
        date: anchorDayStart.format("YYYY-MM-DD"),
        arrived: Number(arrivedCount || 0),
        left: Number(leftCount || 0),
        pendingNextDay: Number(pendingNextDayCount || 0),
        vip: Number(vipCount || 0),
      },
      weeklyRevenue: weeklyRevenueReady,
      paymentShare,
      recentPayments,
      monthlyChart,
      roomOverview,
      expensesTotal,
    });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

module.exports = {
  getDashboardSummary,
};
