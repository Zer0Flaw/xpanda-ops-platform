// src/app/logistics/loading/page.tsx  ->  /v2/logistics/loading
// Server shell for the interactive dock loading dashboard (unit 3b). Distinct from the existing
// PASSIVE `/v2/loading` TV wall (src/app/loading/page.tsx, logistics.loading.tv) -- this is the
// operator-facing surface loading/loading.html ports, gated by middleware on `logistics.loading`
// (same key as legacy's /logistics/loading and /api/loading-*). Deliberately NOT wired into
// PlatformHeader's nav or the home page -- reachable by direct URL only, per the v2 visibility
// gate (xpanda-ops-agents.md §1): built-and-deployed-but-unlinked until Steve has floor-tested it
// and confirmed it's complete (see also §Termination: legacy logistics/loading.html stays live
// and untouched until then).
import { Suspense } from "react";
import { headers } from "next/headers";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";
import DockBoard from "./DockBoard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "xPanda Loading Dashboard — v2",
};

export default async function LoadingDashboardPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";

  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};

  return (
    // PXXX-b: DockBoard reads ?assignment=/?shipment= via useSearchParams() for notification
    // deep-linking -- Next.js requires a Suspense boundary around any client component using it.
    <Suspense fallback={null}>
      <DockBoard userName={userName} isAdmin={isAdmin} permissions={permissions} />
    </Suspense>
  );
}
