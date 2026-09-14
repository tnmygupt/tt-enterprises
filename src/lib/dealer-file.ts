import { normalizePhone, phonesMatch } from "@/lib/phone";
import type {
  Party,
  PeopleActivity,
  PeopleActivityAction,
  PeopleActivityChange,
  UserProfile,
} from "@/lib/types";

export const PEOPLE_ACTIVITY_MAX = 400;

export type DealerFileAction =
  | "approve"
  | "reject"
  | "revoke"
  | "restore"
  | "update";

export type DealerFilePatch = {
  name?: string;
  phone?: string;
  company?: string;
  address?: string;
  pincode?: string;
  gstOrAadhar?: string;
  transport?: string;
  creditLimit?: number | null;
};

export type DealerFileDb = {
  users: UserProfile[];
  parties: Party[];
  peopleActivity?: PeopleActivity[];
};

function blank(value: string | undefined | null): string {
  return String(value ?? "").trim();
}

function creditLabel(value: number | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "";
  return String(value);
}

export function appendPeopleActivity(
  db: DealerFileDb,
  entry: Omit<PeopleActivity, "id" | "at"> & { at?: string }
): void {
  const row: PeopleActivity = {
    ...entry,
    id: `pa_${crypto.randomUUID()}`,
    at: entry.at || new Date().toISOString(),
  };
  db.peopleActivity = [row, ...(db.peopleActivity ?? [])].slice(
    0,
    PEOPLE_ACTIVITY_MAX
  );
}

function logDealerAction(
  db: DealerFileDb,
  actor: UserProfile,
  user: UserProfile,
  action: PeopleActivityAction,
  extra?: { reason?: string; changes?: PeopleActivityChange[] }
): void {
  appendPeopleActivity(db, {
    actorId: actor.id,
    actorName: actor.name || actor.phone,
    action,
    userId: user.id,
    userName: user.name,
    userPhone: user.phone,
    reason: extra?.reason?.trim() || undefined,
    changes: extra?.changes?.length ? extra.changes : undefined,
  });
}

export function ensureLinkedCustomerParty(
  db: DealerFileDb,
  user: UserProfile
): Party {
  const name = (user.company?.trim() || user.name).trim();
  const existing = (db.parties ?? []).find(
    (p) => p.linkedUserId === user.id && p.type === "customer"
  );
  if (existing) {
    existing.name = name || existing.name;
    existing.phone = user.phone || existing.phone;
    existing.address = user.address;
    existing.pincode = user.pincode;
    existing.gstin = user.gstOrAadhar;
    existing.active = user.active !== false;
    return existing;
  }
  const party: Party = {
    id: `party_${crypto.randomUUID()}`,
    name: name || user.name,
    phone: user.phone,
    type: "customer",
    linkedUserId: user.id,
    openingBalance: 0,
    address: user.address,
    pincode: user.pincode,
    gstin: user.gstOrAadhar,
    active: user.active !== false,
    createdAt: new Date().toISOString(),
  };
  db.parties = [...(db.parties ?? []), party];
  return party;
}

function applyStatus(
  db: DealerFileDb,
  actor: UserProfile,
  user: UserProfile,
  action: Exclude<DealerFileAction, "update">,
  reason?: string
): void {
  if (action === "approve") {
    user.approved = true;
    user.active = true;
    user.revokedAt = undefined;
    user.revokedBy = undefined;
    user.revokedReason = undefined;
  } else if (action === "reject") {
    user.approved = false;
    user.active = false;
  } else if (action === "revoke") {
    user.active = false;
    user.revokedAt = new Date().toISOString();
    user.revokedBy = actor.id;
    user.revokedReason = reason?.trim() || undefined;
  } else {
    user.active = true;
    user.revokedAt = undefined;
    user.revokedBy = undefined;
    user.revokedReason = undefined;
  }
  ensureLinkedCustomerParty(db, user);
  logDealerAction(db, actor, user, action, { reason });
}

function applyUpdate(
  db: DealerFileDb,
  actor: UserProfile,
  user: UserProfile,
  patch: DealerFilePatch
): void {
  const phone = normalizePhone(patch.phone ?? user.phone);
  if (phone.length < 10) {
    throw new Error("Enter a valid 10-digit mobile number");
  }
  const clash = (db.users ?? []).some(
    (u) => u.id !== user.id && phonesMatch(u.phone, phone)
  );
  if (clash) throw new Error("This phone number already exists");

  const party = ensureLinkedCustomerParty(db, user);
  const nextCredit =
    patch.creditLimit === undefined
      ? party.creditLimit
      : patch.creditLimit == null ||
          !Number.isFinite(Number(patch.creditLimit)) ||
          Number(patch.creditLimit) <= 0
        ? undefined
        : Number(patch.creditLimit);

  const next = {
    name: blank(patch.name) || user.name,
    phone,
    company: blank(patch.company) || undefined,
    address: blank(patch.address) || undefined,
    pincode: blank(patch.pincode) || undefined,
    gstOrAadhar: blank(patch.gstOrAadhar) || undefined,
    transport: blank(patch.transport) || undefined,
  };

  const changes: PeopleActivityChange[] = [];
  const track = (
    field: string,
    from: string | undefined,
    to: string | undefined
  ) => {
    const a = blank(from);
    const b = blank(to);
    if (a === b) return;
    changes.push({ field, from: a, to: b });
  };
  track("name", user.name, next.name);
  track("phone", user.phone, next.phone);
  track("company", user.company, next.company);
  track("address", user.address, next.address);
  track("pincode", user.pincode, next.pincode);
  track("gstOrAadhar", user.gstOrAadhar, next.gstOrAadhar);
  track("transport", user.transport, next.transport);
  track("creditLimit", creditLabel(party.creditLimit), creditLabel(nextCredit));

  if (!changes.length) return;

  user.name = next.name;
  user.phone = next.phone;
  user.company = next.company;
  user.address = next.address;
  user.pincode = next.pincode;
  user.gstOrAadhar = next.gstOrAadhar;
  user.transport = next.transport;
  party.creditLimit = nextCredit;
  ensureLinkedCustomerParty(db, user);
  logDealerAction(db, actor, user, "edit", { changes });
}

/**
 * Mutate dealer rows in-place. Caller must already have `approve_dealers`.
 * Staff logins are never changed here.
 */
export function applyDealerFileActions(
  db: DealerFileDb,
  actor: UserProfile,
  input: {
    action: DealerFileAction;
    ids: string[];
    reason?: string;
    patch?: DealerFilePatch;
  }
): UserProfile[] {
  if (actor.id && input.ids.includes(actor.id)) {
    throw new Error("You cannot change your own access here");
  }
  const reviewed: UserProfile[] = [];
  for (const userId of input.ids) {
    const user = (db.users ?? []).find((u) => u.id === userId);
    if (!user || user.role !== "customer") continue;
    if (input.action === "update") {
      applyUpdate(db, actor, user, input.patch ?? {});
    } else {
      applyStatus(db, actor, user, input.action, input.reason);
    }
    reviewed.push(user);
  }
  if (!reviewed.length) throw new Error("Dealer not found");
  return reviewed;
}
