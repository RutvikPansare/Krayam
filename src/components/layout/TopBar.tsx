"use client";

import { NotificationBell } from "./NotificationBell";
import { UserMenu } from "./UserMenu";

/**
 * Slim top bar rendered on every dashboard page (mounted in the dashboard
 * layout): notification bell + profile menu, top right.
 */
export default function TopBar() {
  return (
    <div
      className="flex items-center justify-end gap-1.5 px-6 flex-shrink-0"
      style={{
        height: 52,
        background: "var(--paper)",
        borderBottom: "1px solid var(--border)",
        fontFamily: "var(--font-dm-sans,'DM Sans',sans-serif)",
      }}
    >
      <NotificationBell />
      <UserMenu />
    </div>
  );
}
