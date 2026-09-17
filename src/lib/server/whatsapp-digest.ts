import { allOpenReceivables, creditLimitBreach, partyBalance } from "@/lib/accounting";
import {
  dealerHasScheme,
  daysUntilSchemeEnd,
  isSchemeEndingSoon,
} from "@/lib/schemes";
import {
  notifyStaffWhatsAppServer,
  sendWhatsAppTextServer,
} from "@/lib/server/whatsapp-notify";
import { tallyWaConfigured } from "@/lib/server/tally-whatsapp";
import { buildOwnerDailySummary, listStaleEstimates, ownerUsers } from "@/lib/owner-daily-summary";
import { dateInIst, staffMissingInPunch, suspiciousPunches } from "@/lib/hr";
import { monthCloseObligation } from "@/lib/month-close-policy";
import type { AppDatabase } from "@/lib/store/db";
import type { Locale, Party, UserProfile } from "@/lib/types";
import { roundMoney } from "@/lib/pricing";
import {
  creditLimitDealerWhatsAppText,
  creditLimitStaffWhatsAppText,
  overdueDealerWhatsAppText,
  overdueStaffWhatsAppText,
  schemeEndingDealerWhatsAppText,
  schemeEndingStaffWhatsAppText,
  staleEstimateDealerWhatsAppText,
  whatsappCountryCode,
} from "@/lib/whatsapp";

export const WHATSAPP_DIGEST_COOLDOWN_DAYS = 6;

export function todayIsoDate(at = new Date()): string {
  return at.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = new Date(from.slice(0, 10) + "T00:00:00");
  const b = new Date(to.slice(0, 10) + "T00:00:00");
  return Math.floor((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

export function digestRecentlySent(
  lastOn: string | undefined,
  today: string,
  days = WHATSAPP_DIGEST_COOLDOWN_DAYS
): boolean {
  if (!lastOn) return false;
  return daysBetween(lastOn, today) < days;
}

function dealerLocale(user?: UserProfile): Locale {
  return user?.locale === "hi" ? "hi" : "en";
}

function partyPhone(party: Party, users: UserProfile[]): string | undefined {
  const fromParty = party.phone?.trim();
  if (fromParty) return fromParty;
  if (!party.linkedUserId) return undefined;
  return users.find((u) => u.id === party.linkedUserId)?.phone?.trim();
}

export type WhatsAppDigestResult = {
  overdueDealers: number;
  overdueStaff: number;
  creditDealers: number;
  creditStaff: number;
  schemeDealers: number;
  schemeStaff: number;
    dailyOwners: number;
  staleDealers: number;
  hrMissPunch: number;
  hrFence: number;
  monthAudit: number;
  skipped: string[];
  dirty: boolean;
};

/**
 * Weekly overdue / credit-limit / scheme-ending WhatsApp.
 * Mutates db.settings.whatsappDigest when a section actually sends.
 */
export async function runWhatsAppDigest(
  db: AppDatabase
): Promise<WhatsAppDigestResult> {
  const result: WhatsAppDigestResult = {
    overdueDealers: 0,
    overdueStaff: 0,
    creditDealers: 0,
    creditStaff: 0,
    schemeDealers: 0,
    schemeStaff: 0,
    dailyOwners: 0,
    staleDealers: 0,
    hrMissPunch: 0,
    hrFence: 0,
    monthAudit: 0,
    skipped: [],
    dirty: false,
  };
  if (db.settings.whatsappNotifyEnabled === false) {
    result.skipped.push("whatsappNotifyEnabled is off");
    return result;
  }
  if (!tallyWaConfigured()) {
    result.skipped.push("WhatsApp instance not configured");
    return result;
  }

  const today = todayIsoDate();
  const company = db.settings.companyName || "TT Enterprises";
  const country = whatsappCountryCode(db.settings);
  const beforeStamp = JSON.stringify(db.settings.whatsappDigest ?? {});
  const stamp = { ...(db.settings.whatsappDigest ?? {}) };
  const enabled = db.settings.whatsappNotifyEnabled;

  if (!digestRecentlySent(stamp.dailyOn, today, 1)) {
    const owners = ownerUsers(db.users);
    if (owners.length) {
      const summary = buildOwnerDailySummary({
        db,
        today,
        locale: "en",
      });
      result.dailyOwners = await notifyStaffWhatsAppServer({
        users: owners,
        countryCode: country,
        enabled,
        text: summary.text,
      });
      if (result.dailyOwners > 0) stamp.dailyOn = today;
    } else {
      result.skipped.push("no super-admin phone for daily summary");
    }
  } else {
    result.skipped.push("daily summary already sent today");
  }

  if (!digestRecentlySent(stamp.overdueOn, today)) {
    const open = allOpenReceivables(
      db.parties,
      db.vouchers,
      db.billAllocations ?? [],
      today
    ).filter((r) => r.daysOverdue > 0 && r.outstanding > 0.009);
    const byParty = new Map<string, typeof open>();
    for (const row of open) {
      const pid = row.voucher.partyId;
      if (!pid) continue;
      const list = byParty.get(pid) ?? [];
      list.push(row);
      byParty.set(pid, list);
    }
    const staffTop: { name: string; amount: number }[] = [];
    let overdueTotal = 0;
    for (const [partyId, bills] of byParty) {
      const party = db.parties.find((p) => p.id === partyId);
      if (!party?.active) continue;
      const total = roundMoney(bills.reduce((s, b) => s + b.outstanding, 0));
      overdueTotal = roundMoney(overdueTotal + total);
      staffTop.push({ name: party.name, amount: total });
      const linked = db.users.find((u) => u.id === party.linkedUserId);
      const locale = dealerLocale(linked);
      const phone = partyPhone(party, db.users);
      if (!phone) continue;
      const ok = await sendWhatsAppTextServer({
        phone,
        countryCode: country,
        enabled,
        text: overdueDealerWhatsAppText({
          partyName: party.name,
          companyName: company,
          locale,
          total,
          bills: bills.map((b) => ({
            number: b.voucher.number,
            due: (b.voucher.dueDate || b.voucher.date).slice(0, 10),
            amount: b.outstanding,
            daysOverdue: b.daysOverdue,
          })),
        }),
      });
      if (ok) result.overdueDealers += 1;
    }
    staffTop.sort((a, b) => b.amount - a.amount);
    if (byParty.size) {
      result.overdueStaff = await notifyStaffWhatsAppServer({
        users: db.users,
        countryCode: country,
        enabled,
        text: overdueStaffWhatsAppText({
          companyName: company,
          locale: "en",
          partyCount: staffTop.length,
          total: overdueTotal,
          top: staffTop,
        }),
      });
      stamp.overdueOn = today;
    }
  } else {
    result.skipped.push("overdue cooldown");
  }

  if (!digestRecentlySent(stamp.creditOn, today)) {
    const rows: {
      name: string;
      receivable: number;
      creditLimit: number;
      overBy: number;
      phone?: string;
      locale: Locale;
    }[] = [];
    for (const party of db.parties) {
      if (!party.active || party.type !== "customer" || !party.creditLimit) {
        continue;
      }
      const recv = partyBalance(party, db.ledgerEntries);
      const check = creditLimitBreach(party, recv, 0);
      if (check.ok) continue;
      const linked = db.users.find((u) => u.id === party.linkedUserId);
      rows.push({
        name: party.name,
        receivable: recv,
        creditLimit: party.creditLimit,
        overBy: check.overBy,
        phone: partyPhone(party, db.users),
        locale: dealerLocale(linked),
      });
    }
    for (const row of rows) {
      if (!row.phone) continue;
      const ok = await sendWhatsAppTextServer({
        phone: row.phone,
        countryCode: country,
        enabled,
        text: creditLimitDealerWhatsAppText({
          partyName: row.name,
          companyName: company,
          locale: row.locale,
          receivable: row.receivable,
          creditLimit: row.creditLimit,
          overBy: row.overBy,
        }),
      });
      if (ok) result.creditDealers += 1;
    }
    if (rows.length) {
      result.creditStaff = await notifyStaffWhatsAppServer({
        users: db.users,
        countryCode: country,
        enabled,
        text: creditLimitStaffWhatsAppText({
          companyName: company,
          locale: "en",
          rows,
        }),
      });
      stamp.creditOn = today;
    }
  } else {
    result.skipped.push("credit cooldown");
  }

  if (!digestRecentlySent(stamp.schemeOn, today)) {
    const ending = (db.schemes ?? []).filter((s) => isSchemeEndingSoon(s));
    const dealers = db.users.filter(
      (u) => u.active && u.approved && u.role === "customer"
    );
    const staffSchemes: { name: string; daysLeft: number; dealerCount: number }[] =
      [];
    for (const scheme of ending) {
      const assigned = dealers.filter((u) =>
        dealerHasScheme(scheme, u.assignedSchemeIds)
      );
      staffSchemes.push({
        name: scheme.name.en || scheme.name.hi,
        daysLeft: daysUntilSchemeEnd(scheme),
        dealerCount: assigned.length,
      });
    }
    const byDealer = new Map<
      string,
      { user: UserProfile; schemes: { name: string; daysLeft: number }[] }
    >();
    for (const scheme of ending) {
      for (const user of dealers) {
        if (!dealerHasScheme(scheme, user.assignedSchemeIds)) continue;
        const locale = dealerLocale(user);
        const name = scheme.name[locale] || scheme.name.en;
        const cur = byDealer.get(user.id) ?? { user, schemes: [] };
        cur.schemes.push({ name, daysLeft: daysUntilSchemeEnd(scheme) });
        byDealer.set(user.id, cur);
      }
    }
    for (const { user, schemes } of byDealer.values()) {
      const phone = user.phone?.trim();
      if (!phone) continue;
      const ok = await sendWhatsAppTextServer({
        phone,
        countryCode: country,
        enabled,
        text: schemeEndingDealerWhatsAppText({
          dealerName: user.name || "Dealer",
          companyName: company,
          locale: dealerLocale(user),
          schemes,
        }),
      });
      if (ok) result.schemeDealers += 1;
    }
    if (staffSchemes.length) {
      result.schemeStaff = await notifyStaffWhatsAppServer({
        users: db.users,
        countryCode: country,
        enabled,
        text: schemeEndingStaffWhatsAppText({
          companyName: company,
          locale: "en",
          schemes: staffSchemes,
        }),
      });
      stamp.schemeOn = today;
    }
  } else {
    result.skipped.push("scheme cooldown");
  }

  if (!digestRecentlySent(stamp.staleOn, today)) {
    const stale = listStaleEstimates(db.orders, today);
    const byDealer = new Map<string, typeof stale>();
    for (const row of stale) {
      const list = byDealer.get(row.userId) ?? [];
      list.push(row);
      byDealer.set(row.userId, list);
    }
    for (const rows of byDealer.values()) {
      const user = db.users.find((u) => u.id === rows[0]?.userId);
      const phone =
        rows[0]?.phone || user?.phone?.trim() || undefined;
      if (!phone) continue;
      const ok = await sendWhatsAppTextServer({
        phone,
        countryCode: country,
        enabled,
        text: staleEstimateDealerWhatsAppText({
          dealerName: rows[0]?.userName || user?.name || "Dealer",
          companyName: company,
          locale: dealerLocale(user),
          orders: rows.map((r) => ({
            orderNumber: r.orderNumber,
            daysOpen: r.daysOpen,
          })),
        }),
      });
      if (ok) result.staleDealers += 1;
    }
    if (stale.length) stamp.staleOn = today;
  } else {
    result.skipped.push("stale estimates cooldown");
  }

  const istToday = dateInIst(new Date().toISOString());
  if (!digestRecentlySent(stamp.hrMissPunchOn, istToday, 1)) {
    const missing = staffMissingInPunch(db.users, db.hrPunches ?? [], istToday);
    for (const user of missing) {
      const phone = user.phone?.trim();
      if (!phone) continue;
      const ok = await sendWhatsAppTextServer({
        phone,
        countryCode: country,
        enabled,
        text:
          user.locale === "hi"
            ? `${company}: आज की इन-पंच नहीं मिली। कृपया ऐप से क्लॉक-इन करें।`
            : `${company}: No clock-in today. Please clock in from the staff app.`,
      });
      if (ok) result.hrMissPunch += 1;
    }
    if (missing.length) stamp.hrMissPunchOn = istToday;
  }

  if (!digestRecentlySent(stamp.hrFenceOn, istToday, 1)) {
    const month = istToday.slice(0, 7);
    const flags = suspiciousPunches(db.hrPunches ?? [], month).filter(
      (p) => dateInIst(p.at) === istToday
    );
    if (flags.length) {
      const lines = flags
        .slice(0, 8)
        .map((p) => {
          const name =
            db.users.find((u) => u.id === p.userId)?.name || p.userId;
          return `${name} ${p.kind} ${p.insideFence ? "" : "outside fence"} ${p.weakGps ? "weak GPS" : ""}`.trim();
        })
        .join("\n");
      result.hrFence = await notifyStaffWhatsAppServer({
        users: db.users,
        capability: "view_financials",
        countryCode: country,
        enabled,
        text: `${company} GPS flags today:\n${lines}`,
      });
      stamp.hrFenceOn = istToday;
    }
  }

  if (!digestRecentlySent(stamp.monthAuditOn, istToday, 1)) {
    const obligation = monthCloseObligation(db);
    if (obligation.state !== "ok") {
      const blockers = obligation.blockers.length
        ? ` Blockers: ${obligation.blockers.join(", ")}.`
        : "";
      const override = obligation.override
        ? ` Override by ${obligation.override.by}.`
        : "";
      result.monthAudit = await notifyStaffWhatsAppServer({
        users: db.users,
        capability: "view_financials",
        countryCode: country,
        enabled,
        text: `${company}: Monthly audit ${obligation.month} is ${obligation.state}.${blockers}${override} Open /admin/owner#audit`,
      });
      if (result.monthAudit > 0) stamp.monthAuditOn = istToday;
    }
  } else {
    result.skipped.push("month audit already sent today");
  }

  result.dirty = JSON.stringify(stamp) !== beforeStamp;
  if (result.dirty) db.settings.whatsappDigest = stamp;
  return result;
}
