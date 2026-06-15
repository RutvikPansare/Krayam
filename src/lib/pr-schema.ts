import { z } from "zod";
import { UNIT_OPTIONS } from "@/lib/units";

/**
 * Purchase request validation — single source of truth, shared by the PR
 * form (client) and /api/pr (server). Messages written for shop-floor users,
 * not developers.
 */

const unitValues = UNIT_OPTIONS.map((u) => u.value) as [string, ...string[]];

export const prItemSchema = z.object({
  item_name: z.string().trim().min(3, "Item name needs at least 3 characters"),
  material_code: z.string().trim().max(40).optional().or(z.literal("")),
  quantity: z
    .number({ message: "Enter a quantity" })
    .positive("Quantity must be more than 0")
    .max(1_000_000, "Quantity looks too large"),
  unit: z.enum(unitValues),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export const prFormSchema = z.object({
  requester_name: z.string().trim().min(2, "Enter your name"),
  requester_email: z.string().trim().email("Enter a valid email address"),
  department: z.string().trim().max(80).optional().or(z.literal("")),
  plant: z.string().trim().max(80).optional().or(z.literal("")),
  cost_center: z.string().trim().min(1, "Select a cost center"),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  needed_by: z.string().optional().or(z.literal("")),
  justification: z.string().trim().max(1000).optional().or(z.literal("")),
  approver_email: z.string().trim().email("Enter the approver's email address"),
  items: z.array(prItemSchema).min(1, "Add at least one item"),
  attachment_ids: z.array(z.string().uuid()).optional(),
});

export type PRFormData = z.infer<typeof prFormSchema>;
export type PRItemData = z.infer<typeof prItemSchema>;
