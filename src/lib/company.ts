import { createAdminClient } from "@/lib/supabase/admin";
import { getOrgId } from "@/lib/org";

export interface CompanyProfile {
  company_name: string;
  address: string | null;
  gstin: string | null;
  cin: string | null;
  logo_url: string | null;
  po_prefix: string;
  delivery_address: string | null;
  standard_terms: string | null;
}

/**
 * Organization profile — one row per org (company_settings.org_id).
 * Falls back to env so nothing breaks before migrations have run or before an
 * org has saved its profile. Pass an explicit orgId on multi-tenant pages;
 * defaults to the resolved install org.
 */
export async function getCompany(orgId?: string): Promise<CompanyProfile> {
  try {
    const admin = createAdminClient();
    const resolvedOrg = orgId ?? (await getOrgId());
    const { data } = await admin.from("company_settings").select("*").eq("org_id", resolvedOrg).maybeSingle();
    if (data) {
      return {
        company_name: data.company_name || process.env.COMPANY_NAME || "Krayam Manufacturing",
        address: data.address,
        gstin: data.gstin,
        cin: data.cin,
        logo_url: data.logo_url,
        po_prefix: data.po_prefix || "PO-",
        delivery_address: data.delivery_address ?? null,
        standard_terms: data.standard_terms ?? null,
      };
    }
  } catch (err) {
    console.error("getCompany failed, using env fallback:", err);
  }
  return {
    company_name: process.env.COMPANY_NAME || "Krayam Manufacturing",
    address: process.env.COMPANY_ADDRESS || null,
    gstin: null,
    cin: null,
    logo_url: null,
    po_prefix: process.env.PO_PREFIX || "PO-",
    delivery_address: process.env.COMPANY_ADDRESS || null,
    standard_terms: null,
  };
}
