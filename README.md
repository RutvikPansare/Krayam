# Krayam — Procurement Intelligence

Fixing how Indian manufacturers buy, track, and control their procurement. Sits on top of SAP and automates the purchase cycle from request to order.

## Stack

Next.js 14 (App Router) · Supabase (Postgres + Auth + Realtime) · Tailwind · Framer Motion · Resend · SAP OData (S/4HANA `MM_PUR_REQ_MAINTAIN_SRV`).

## Features

| # | Feature | SAP needed? | Route |
|---|---------|-------------|-------|
| 01 | Mobile PR form (PWA, no install) | No | `/pr/new` |
| 02 | One-click email approval flow | No | `/approve/[token]` |
| 03 | Automatic SAP PR creation (ME21N via OData) | Mock by default | fires on approval |
| 04 | RFQ auto-generation + vendor email blast | No | fires on approval |
| 05 | Vendor quote form + live comparison table | No | `/quote/[token]`, `/dashboard/rfqs/[id]` |
| 06 | PO generation (PDF) + SAP PO push | Mock by default | `/dashboard/rfqs/[id]` → Generate PO, `/dashboard/pos` |
| 07 | Duplicate detection at PR form (fuzzy material search + stock) | No (mirror) | `/pr/new` — type 3+ chars in item name |
| 08 | Material master dedup audit + PDF report | Read-only mirror | `/dashboard/audit` |
| 09 | Stock check before PO (15-min cache) | Mock by default | intercepts Generate PO |
| 10 | Manual quote entry + unit normalization + audit tags | No | comparison table |

## Setup

1. **Supabase**: create a project, run `supabase/migrations/0001_init.sql` then `supabase/migrations/0002_features_06_10.sql` in the SQL editor (0002 enables `pg_trgm`, creates the materials mirror with 80 seeded materials including planted duplicate clusters, and the PO tables). Enable Email auth (and Google OAuth if wanted). Create a dashboard user under Authentication → Users.
2. **Env**: `cp .env.example .env.local` and fill in Supabase keys + a random `TOKEN_SECRET`.
3. **Run**:
   ```bash
   npm install
   npm run dev
   ```

## Testing the full cycle locally (no SAP, no Resend)

1. Leave `RESEND_API_KEY` empty — emails print to the dev server console, including the approve/quote links.
2. Open `/pr/new` on your phone or browser, submit a request.
3. Copy the approval link from the console, open it, click **Approve**.
4. On approval: a mock SAP PR number is generated (`SAP_MODE=mock`), an RFQ is created, and quote links for all 5 seeded vendors print to the console.
5. Open quote links in different tabs, submit different prices/units (one in dozens, one in pieces).
6. Watch `/dashboard/rfqs/<id>` — the comparison table populates live, normalized to per-piece prices, best quote highlighted. Use **Enter quote manually** for the phone-call vendor.

### Testing with someone remote (e.g. dad in India)

```bash
ngrok http 3000
```
Set `NEXT_PUBLIC_SITE_URL` to the ngrok URL (so email links point there), add a real `RESEND_API_KEY`, and point a vendor's email at his inbox.

### Testing features 06–10 locally

- **07 duplicate detection**: on `/pr/new`, type "brg 6205" or "bering" — fuzzy matches appear with stock chips; picking one fills the material code and warns about existing stock.
- **06 + 09 PO flow**: open an RFQ comparison, click **Generate PO** under a vendor — the stock-check intercept runs first (try an item with material code MAT-10001: "6 in Pune Plant"), suggests reduced quantities, then creates the PO, pushes to SAP (mock PO number), and offers the PDF.
- **08 audit**: `/dashboard/audit` scans the seeded master — it should find the planted clusters (Bearing 6205 ×3, V Belt B-68 ×3, M12x50 bolts ×3, …) and total the rupee value. **Download PDF report** produces the sales artifact.
- **10 audit tags**: comparison table headers show "entered manually" vs "via form" pills.
- **Material import** (SE16 export): `npx tsx scripts/import-materials.ts makt-export.csv` — upserts on material_code.
- **Stock cache**: repeat the same Generate PO within 15 min — stock rows show "(cached)".

### Moving SAP from mock → live

Set `SAP_MODE=live` and fill `SAP_BASE_URL`, `SAP_USER`, `SAP_PASSWORD`, `SAP_CLIENT` (+ company code / purchasing org / group / plant). The client implements the standard CSRF-token fetch + POST flow:

- Week 1: ES5 Gateway (`sapes5.sapdevcenter.com`) — proves auth/CSRF code.
- Week 2: BTP Trial S/4HANA sandbox — real `MM_PUR_REQ_MAINTAIN_SRV` PR creation.
- Week 3: Mukund QA (client 200) — real field values.
- Live: Mukund Production (client 100) — config switch only.

## Team, organization & notifications

- **Profile menu** (top right, every dashboard page): name, email, role badge, links to Team/Organization, sign out.
- **Notification bell** (next to it): role-routed in-app notifications, live via Supabase Realtime, mark-one/mark-all read.
- **Team** (`/dashboard/settings/team`): add members with enterprise roles — Managing Director (owner), IT Administrator, Finance Controller, Purchase Officer, Plant Engineer. Only MD/IT Admin can manage. First user to sign in becomes Managing Director automatically.
- **Organization** (`/dashboard/settings/organization`): company name, registered address, GSTIN, CIN, logo. Used on PO PDFs and all vendor-facing emails (replaces the COMPANY_NAME env var; env remains the fallback).
- **Notification routing** (`src/types/roles.ts` → `NOTIFY_ROUTING`):
  - PR raised → Purchase Officers + IT Admin (+ MD)
  - PR approved/rejected → Purchase Officers
  - Quote received → Purchase Officers
  - PO raised → Finance Controller + Purchase Officers + IT Admin (+ MD)
  - Invoice flagged in 3-way match → Finance Controller + Purchase Officers
  - GRN posted → Purchase Officers + Finance Controller

Run `supabase/migrations/0009_team_org_notifications.sql` to enable (creates `company_settings`, `team_members`, `notifications` + Realtime).
