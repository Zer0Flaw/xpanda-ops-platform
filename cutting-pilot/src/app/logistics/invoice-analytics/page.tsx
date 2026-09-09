// src/app/logistics/invoice-analytics/page.tsx  →  /v2/logistics/invoice-analytics
// Server shell. Gated admin-only by -b's `/v2/logistics` -> `logistics.v2` middleware rule
// (startsWith covers this subpath already — no routing work needed here).
import { headers } from "next/headers";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";
import InvoiceAnalytics from "@/components/logistics/InvoiceAnalytics";

export const metadata = { title: "xPanda Invoice Analytics — v2" };

export default async function InvoiceAnalyticsPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";
  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  return (
    <InvoiceAnalytics
      userName={userName}
      isAdmin={session?.isAdministrator ?? false}
      permissions={session?.permissions ?? {}}
    />
  );
}
