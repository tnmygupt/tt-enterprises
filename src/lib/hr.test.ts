import { describe, expect, it } from "vitest";
import {
  computePayroll,
  dateInIst,
  deriveDayAttendance,
  distanceMeters,
  isWeakGps,
  leaveOverlapsMonth,
  leaveQuotaBlocked,
  leaveQuotaRemaining,
  matchGeofence,
  mergeHrAdvancesForStaff,
  WEAK_GPS_M,
} from "./hr";
import type { HrPunch, HrTerms } from "./types";

describe("geofence", () => {
  it("marks a punch inside a 150 m factory pin", () => {
    const site = { id: "panki", name: "Panki", lat: 26.467, lng: 80.241, radiusM: 150 };
    const inside = matchGeofence(26.4671, 80.2411, [site]);
    expect(inside.insideFence).toBe(true);
    expect(inside.siteId).toBe("panki");
    const far = matchGeofence(26.48, 80.26, [site]);
    expect(far.insideFence).toBe(false);
    expect(distanceMeters(26.467, 80.241, 26.467, 80.241)).toBeLessThan(1);
  });

  it("flags GPS accuracy worse than 100 m", () => {
    expect(isWeakGps(40)).toBe(false);
    expect(isWeakGps(WEAK_GPS_M + 1)).toBe(true);
  });
});

describe("attendance and payroll", () => {
  const terms: HrTerms = {
    id: "t1",
    userId: "u1",
    monthlySalary: 30000,
    joinDate: "2026-01-01",
    weekOff: 0,
    otRatePerHour: 100,
    casualDaysPerYear: 6,
    sickDaysPerYear: 6,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("treats in+out as present and only-in as half / missing out", () => {
    const punches: HrPunch[] = [
      {
        id: "1",
        userId: "u1",
        kind: "in",
        at: "2026-09-01T03:40:00.000Z",
        insideFence: true,
        createdAt: "2026-09-01T03:40:00.000Z",
      },
      {
        id: "2",
        userId: "u1",
        kind: "out",
        at: "2026-09-01T12:40:00.000Z",
        insideFence: true,
        createdAt: "2026-09-01T12:40:00.000Z",
      },
    ];
    const full = deriveDayAttendance(punches, "u1", dateInIst(punches[0]!.at));
    expect(full.present).toBe(true);
    expect(full.half).toBe(false);
    const half = deriveDayAttendance(punches.slice(0, 1), "u1", dateInIst(punches[0]!.at));
    expect(half.half).toBe(true);
    expect(half.missingOut).toBe(true);
  });

  it("pays present + half + paid leave, not unpaid leave", () => {
    const punches: HrPunch[] = [];
    const month = "2026-02";
    for (let d = 2; d <= 28; d++) {
      const day = `2026-02-${String(d).padStart(2, "0")}`;
      const dow = new Date(day + "T00:00:00").getDay();
      if (dow === 0) continue;
      punches.push({
        id: `in${d}`,
        userId: "u1",
        kind: "in",
        at: `${day}T03:40:00.000Z`,
        insideFence: true,
        createdAt: `${day}T03:40:00.000Z`,
      });
      punches.push({
        id: `out${d}`,
        userId: "u1",
        kind: "out",
        at: `${day}T12:40:00.000Z`,
        insideFence: true,
        createdAt: `${day}T12:40:00.000Z`,
      });
    }
    const pay = computePayroll({
      month,
      terms,
      punches,
      leaves: [
        {
          id: "l1",
          userId: "u1",
          kind: "casual",
          from: "2026-02-02",
          to: "2026-02-02",
          days: 1,
          status: "approved",
          createdAt: "2026-02-01T00:00:00.000Z",
        },
        {
          id: "l2",
          userId: "u1",
          kind: "unpaid",
          from: "2026-02-03",
          to: "2026-02-03",
          days: 1,
          status: "approved",
          createdAt: "2026-02-01T00:00:00.000Z",
        },
      ],
      advances: [
        {
          id: "a1",
          userId: "u1",
          date: "2026-02-05",
          amount: 1000,
          createdBy: "owner",
          createdAt: "2026-02-05T00:00:00.000Z",
        },
      ],
    });
    expect(pay.leavePaid).toBe(1);
    expect(pay.leaveUnpaid).toBe(1);
    expect(pay.paidDays).toBeGreaterThan(pay.presentDays);
    expect(pay.net).toBe(pay.gross + pay.otPay - 1000);
  });

  it("marks a short in+out as half day from hours", () => {
    const shift = {
      id: "s1",
      name: "G",
      start: "09:00",
      end: "18:00",
      graceMinutes: 15,
    };
    const punches: HrPunch[] = [
      {
        id: "1",
        userId: "u1",
        kind: "in",
        at: "2026-09-01T03:40:00.000Z",
        insideFence: true,
        createdAt: "2026-09-01T03:40:00.000Z",
      },
      {
        id: "2",
        userId: "u1",
        kind: "out",
        at: "2026-09-01T05:40:00.000Z",
        insideFence: true,
        createdAt: "2026-09-01T05:40:00.000Z",
      },
    ];
    const att = deriveDayAttendance(punches, "u1", "2026-09-01", shift);
    expect(att.half).toBe(true);
    expect(att.present).toBe(false);
    expect(att.workedMinutes).toBe(120);
  });

  it("pays daily wage and overtime with 1.5 multiplier", () => {
    const shift = {
      id: "s1",
      name: "G",
      start: "09:00",
      end: "18:00",
      graceMinutes: 15,
    };
    const punches: HrPunch[] = [
      {
        id: "1",
        userId: "u1",
        kind: "in",
        at: "2026-09-01T03:30:00.000Z",
        insideFence: true,
        createdAt: "2026-09-01T03:30:00.000Z",
      },
      {
        id: "2",
        userId: "u1",
        kind: "out",
        at: "2026-09-01T14:30:00.000Z",
        insideFence: true,
        createdAt: "2026-09-01T14:30:00.000Z",
      },
    ];
    const pay = computePayroll({
      month: "2026-09",
      terms: {
        ...terms,
        payBasis: "daily",
        dailyWage: 500,
        otRatePerHour: 100,
        otMultiplier: 1.5,
        weekOff: 0,
      },
      shift,
      punches,
      leaves: [],
      advances: [],
    });
    expect(pay.presentDays).toBe(1);
    expect(pay.otMinutes).toBe(120);
    expect(pay.otPay).toBe(300);
    expect(pay.gross).toBe(500);
    expect(pay.net).toBe(800);
  });

  it("pays hourly rate on worked hours plus paid leave hours", () => {
    const shift = {
      id: "s1",
      name: "G",
      start: "09:00",
      end: "18:00",
      graceMinutes: 15,
    };
    const punches: HrPunch[] = [
      {
        id: "1",
        userId: "u1",
        kind: "in",
        at: "2026-09-01T03:30:00.000Z",
        insideFence: true,
        createdAt: "2026-09-01T03:30:00.000Z",
      },
      {
        id: "2",
        userId: "u1",
        kind: "out",
        at: "2026-09-01T12:30:00.000Z",
        insideFence: true,
        createdAt: "2026-09-01T12:30:00.000Z",
      },
    ];
    const pay = computePayroll({
      month: "2026-09",
      terms: {
        ...terms,
        payBasis: "hourly",
        hourlyRate: 50,
        weekOff: 0,
      },
      shift,
      punches,
      leaves: [
        {
          id: "l1",
          userId: "u1",
          kind: "casual",
          from: "2026-09-02",
          to: "2026-09-02",
          days: 1,
          status: "approved",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ],
      advances: [],
    });
    expect(pay.leavePaid).toBe(1);
    expect(pay.workedMinutes).toBe(540);
    expect(pay.paidLeaveHours).toBe(9);
    expect(pay.gross).toBe(50 * (9 + 9));
  });

  it("does not deduct pending or rejected advances", () => {
    const pay = computePayroll({
      month: "2026-09",
      terms,
      punches: [],
      leaves: [],
      advances: [
        {
          id: "p",
          userId: "u1",
          date: "2026-09-01",
          amount: 2000,
          status: "pending",
          createdBy: "u1",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "r",
          userId: "u1",
          date: "2026-09-01",
          amount: 500,
          status: "rejected",
          createdBy: "u1",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "i",
          userId: "u1",
          date: "2026-09-01",
          amount: 300,
          status: "issued",
          createdBy: "owner",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    });
    expect(pay.advances).toBe(300);
    expect(pay.net).toBe(pay.gross + pay.otPay - 300);
  });
});

describe("leave quota", () => {
  const terms: HrTerms = {
    id: "t1",
    userId: "u1",
    monthlySalary: 30000,
    joinDate: "2026-01-01",
    weekOff: 0,
    otRatePerHour: 0,
    casualDaysPerYear: 6,
    sickDaysPerYear: 6,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("blocks casual leave beyond yearly quota and counts pending", () => {
    const used = Array.from({ length: 6 }, (_, i) => ({
      id: `l${i}`,
      userId: "u1",
      kind: "casual" as const,
      from: `2026-03-0${i + 1}`,
      to: `2026-03-0${i + 1}`,
      days: 1,
      status: i < 5 ? ("approved" as const) : ("pending" as const),
      createdAt: "2026-03-01T00:00:00.000Z",
    }));
    expect(leaveQuotaRemaining(used, terms, "u1", "casual", "2026")).toBe(0);
    expect(
      leaveQuotaBlocked(used, terms, {
        id: "new",
        userId: "u1",
        kind: "casual",
        from: "2026-09-01",
        days: 1,
      })
    ).toBe(true);
    expect(
      leaveQuotaBlocked(used, terms, {
        id: "new",
        userId: "u1",
        kind: "unpaid",
        from: "2026-09-01",
        days: 2,
      })
    ).toBe(false);
  });

  it("filters leave that overlaps the selected month", () => {
    expect(
      leaveOverlapsMonth(
        {
          id: "l1",
          userId: "u1",
          kind: "casual",
          from: "2026-08-30",
          to: "2026-09-02",
          days: 4,
          status: "pending",
          createdAt: "2026-08-01T00:00:00.000Z",
        },
        "2026-09"
      )
    ).toBe(true);
    expect(
      leaveOverlapsMonth(
        {
          id: "l2",
          userId: "u1",
          kind: "casual",
          from: "2026-07-01",
          to: "2026-07-02",
          days: 2,
          status: "approved",
          createdAt: "2026-07-01T00:00:00.000Z",
        },
        "2026-09"
      )
    ).toBe(false);
  });
});

describe("mergeHrAdvancesForStaff", () => {
  it("lets staff insert only their own pending advance", () => {
    const cloud = [
      {
        id: "a1",
        userId: "other",
        date: "2026-09-01",
        amount: 500,
        status: "issued" as const,
        createdBy: "owner",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    const incoming = [
      ...cloud,
      {
        id: "a2",
        userId: "me",
        date: "2026-09-10",
        amount: 100,
        status: "pending" as const,
        createdBy: "me",
        createdAt: "2026-09-10T00:00:00.000Z",
      },
      {
        id: "a3",
        userId: "me",
        date: "2026-09-10",
        amount: 999,
        status: "issued" as const,
        createdBy: "me",
        createdAt: "2026-09-10T00:00:00.000Z",
      },
      {
        id: "a4",
        userId: "other",
        date: "2026-09-10",
        amount: 50,
        status: "pending" as const,
        createdBy: "me",
        createdAt: "2026-09-10T00:00:00.000Z",
      },
    ];
    const out = mergeHrAdvancesForStaff(incoming, cloud, "me", false);
    expect(out.map((a) => a.id).sort()).toEqual(["a1", "a2"]);
    expect(out.find((a) => a.id === "a2")?.status).toBe("pending");
  });

  it("does not let staff overwrite an issued advance", () => {
    const cloud = [
      {
        id: "a1",
        userId: "me",
        date: "2026-09-01",
        amount: 500,
        status: "issued" as const,
        createdBy: "owner",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    const incoming = [
      {
        id: "a1",
        userId: "me",
        date: "2026-09-01",
        amount: 1,
        status: "pending" as const,
        createdBy: "me",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    const out = mergeHrAdvancesForStaff(incoming, cloud, "me", false);
    expect(out).toHaveLength(1);
    expect(out[0]?.amount).toBe(500);
    expect(out[0]?.status).toBe("issued");
  });
});
