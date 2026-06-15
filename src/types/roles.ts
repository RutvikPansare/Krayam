/** Enterprise roles for a manufacturing company. */
export type TeamRole = "owner" | "admin" | "cfo" | "purchase_officer" | "engineer";

export interface TeamMember {
  id: string;
  user_id: string | null;
  email: string;
  full_name: string | null;
  role: TeamRole;
  created_at: string;
}

export const ROLE_LABELS: Record<TeamRole, { label: string; desc: string }> = {
  owner: {
    label: "Managing Director",
    desc: "Full access including team ownership. Cannot be changed or removed.",
  },
  admin: {
    label: "IT Administrator",
    desc: "Full system access. Manages team, organization profile and configuration.",
  },
  cfo: {
    label: "Finance Controller",
    desc: "Spend analytics, invoice matching and purchase order oversight.",
  },
  purchase_officer: {
    label: "Purchase Officer",
    desc: "Runs the purchase cycle — RFQs, quote comparison and purchase orders.",
  },
  engineer: {
    label: "Plant Engineer",
    desc: "Raises purchase requests from the shop floor and tracks their status.",
  },
};

/** Roles allowed to manage team & organization settings. */
export const MANAGER_ROLES: TeamRole[] = ["owner", "admin"];

/** Who gets notified for which event. */
export const NOTIFY_ROUTING: Record<string, TeamRole[]> = {
  pr_created:      ["purchase_officer", "admin"],
  pr_approved:     ["purchase_officer"],
  pr_rejected:     ["purchase_officer"],
  quote_received:  ["purchase_officer"],
  po_created:      ["cfo", "purchase_officer", "admin"],
  invoice_flagged: ["cfo", "purchase_officer"],
  invoice_bank_change: ["cfo"],   // high-priority fraud signal — finance only
  grn_posted:      ["purchase_officer", "cfo"],
};
