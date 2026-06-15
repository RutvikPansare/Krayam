"use client";

import { useEffect, useState } from "react";
import { FileDown, TrendingUp } from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  BarChart, Bar,
} from "recharts";
import { formatINR } from "@/lib/units";

/**
 * Phase 2 Feature 05 — CFO spend dashboard.
 * Real-time analytics over Krayam's own PO data: category donut, monthly
 * trend, vendor concentration, budget vs actual. PDF export for the board.
 */

const COLORS = ["#0B2239", "#F5A623", "#2A6286", "#8CA66B", "#B8732F", "#5A4F80", "#9A9A9E", "#3F8C80"];

const compactINR = (n: number) => {
  if (n >= 1e7) return "₹" + (n / 1e7).toFixed(1) + "Cr";
  if (n >= 1e5) return "₹" + (n / 1e5).toFixed(1) + "L";
  if (n >= 1e3) return "₹" + (n / 1e3).toFixed(0) + "k";
  return "₹" + n.toFixed(0);
};

const monthLabel = (m: string) => {
  const [y, mo] = m.split("-");
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(mo) - 1] + " '" + y.slice(2);
};

export default function SpendPage() {
  const [data, setData] = useState<any | null>(null);
  const [months, setMonths] = useState(6);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/spend?months=${months}`)
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? "Failed to load");
        setData(b);
      })
      .catch((e) => setError(e.message));
  }, [months]);

  if (error) return <div className="p-8 body-md">{error}</div>;
  if (!data) return <div className="p-8 body-md">Loading spend analytics…</div>;

  const byMonth = data.byMonth.map((m: any) => ({ ...m, label: monthLabel(m.month) }));
  const budgetVsActual = data.budgetVsActual.map((m: any) => ({ ...m, label: monthLabel(m.month) }));
  const topVendorShare = data.totalSpend > 0 && data.byVendor[0] ? (data.byVendor[0].amount / data.totalSpend) * 100 : 0;

  return (
    <div className="p-8 max-w-6xl w-full mx-auto">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="heading-lg mb-1 flex items-center gap-2">
            <TrendingUp size={24} style={{ color: "var(--navy)" }} /> Spend analytics
          </h1>
          <p className="body-sm">Procurement spend from Krayam&apos;s own transaction data — no SAP report needed.</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <select className="app-select" style={{ width: 150 }} value={months} onChange={(e) => { setData(null); setMonths(Number(e.target.value)); }}>
            {[3, 6, 12].map((m) => <option key={m} value={m}>Last {m} months</option>)}
          </select>
          <a href={`/api/spend/report?months=${months}`} target="_blank" className="btn btn-dark" style={{ textDecoration: "none" }}>
            <FileDown size={15} /> Board PDF
          </a>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          ["Total spend", formatINR(data.totalSpend)],
          ["Purchase orders", String(data.poCount)],
          ["Avg PO value", formatINR(data.avgPoValue)],
          ["Top vendor share", topVendorShare.toFixed(0) + "%"],
        ].map(([k, v]) => (
          <div key={k} className="card p-5">
            <p className="label mb-1">{k}</p>
            <p style={{ fontSize: 22, fontWeight: 800, color: "var(--navy)" }}>{v}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Donut: spend by category */}
        <div className="card p-5">
          <p className="label mb-3">Spend by category</p>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={data.byCategory.slice(0, 8)} dataKey="amount" nameKey="category" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {data.byCategory.slice(0, 8).map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => formatINR(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Line: spend over time */}
        <div className="card p-5">
          <p className="label mb-3">Spend over time</p>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={byMonth} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={compactINR} tick={{ fontSize: 11 }} width={56} />
              <Tooltip formatter={(v: any) => formatINR(Number(v))} />
              <Line type="monotone" dataKey="amount" name="Spend" stroke="#0B2239" strokeWidth={2.5} dot={{ r: 3.5, fill: "#F5A623", strokeWidth: 0 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Bar: vendor concentration */}
        <div className="card p-5">
          <p className="label mb-3">Vendor concentration (top {Math.min(8, data.byVendor.length)})</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.byVendor.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis type="number" tickFormatter={compactINR} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="vendor" width={130} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: any) => formatINR(Number(v))} />
              <Bar dataKey="amount" name="Spend" fill="#0B2239" radius={[0, 4, 4, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
          {topVendorShare > 35 && (
            <p className="body-sm mt-2" style={{ fontSize: 12, color: "#DC2626", fontWeight: 600 }}>
              ⚠ {data.byVendor[0].vendor} holds {topVendorShare.toFixed(0)}% of spend — concentration risk.
            </p>
          )}
        </div>

        {/* Grouped bar: budget vs actual */}
        <div className="card p-5">
          <p className="label mb-3">Budget vs actual</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={budgetVsActual} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={compactINR} tick={{ fontSize: 11 }} width={56} />
              <Tooltip formatter={(v: any) => formatINR(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="budget" name="Budget" fill="#D8DAD4" radius={[3, 3, 0, 0]} />
              <Bar dataKey="actual" name="Actual" fill="#0B2239" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Plant split */}
      {data.byPlant.length > 0 && (
        <div className="card p-5">
          <p className="label mb-3">Spend by plant</p>
          <div className="grid grid-cols-4 gap-4">
            {data.byPlant.slice(0, 4).map((p: any) => (
              <div key={p.plant}>
                <p className="body-sm" style={{ fontWeight: 700, color: "var(--text-dark)" }}>{p.plant}</p>
                <p style={{ fontSize: 17, fontWeight: 800, color: "var(--navy)" }}>{formatINR(p.amount)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="body-sm mt-4" style={{ fontSize: 12 }}>
        Monthly board report emails automatically on the 1st (set CFO_EMAIL + a cron on /api/spend/monthly-report).
      </p>
    </div>
  );
}
