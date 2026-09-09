// src/app/logistics/page.tsx  ->  /v2/logistics
// Server shell for the logistics v2 shipment dashboard. Middleware gates this path on
// `logistics.dashboard` (same permission key as legacy's /logistics/). Deliberately NOT wired
// into PlatformHeader's nav or the home page — reachable by direct URL only, per the v2
// visibility gate (xpanda-ops-agents.md §1): a module is built-and-deployed-but-unlinked until
// Steve has tested it and confirmed it's complete.
import { headers } from "next/headers";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";
import ShipmentDashboard from "./ShipmentDashboard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "xPanda Logistics — v2",
};

export default async function LogisticsPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";

  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};

  return <ShipmentDashboard userName={userName} isAdmin={isAdmin} permissions={permissions} />;
}
