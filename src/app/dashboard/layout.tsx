import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // AUTH BYPASSED FOR LOCAL DEVELOPMENT
  // const supabase = await createClient();
  // const { data: { user } } = await supabase.auth.getUser();
  // if (!user) redirect("/login");

  return (
    <div
      className="dashboard-shell flex h-dvh overflow-hidden"
      style={{
        background: "var(--paper)",
        fontFamily: "var(--font-dm-sans,'DM Sans',sans-serif)",
        overscrollBehaviorY: "none",
      }}
    >
      <Sidebar />
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <TopBar />
        <main className="dashboard-main flex-1 min-w-0 min-h-0 flex flex-col overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
