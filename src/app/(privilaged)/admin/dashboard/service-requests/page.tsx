import RequestsQueueTable from "@/components/admin/RequestsQueueTable";

/**
 * "Demande de service" — the full admin request queue: every pending request
 * (unassigned, proposed, accepted-but-unscheduled, and the awaiting_admin
 * dossiers returned after a failed auto-match cascade). The Pool Général tab
 * reuses the same table component, filtered to general-pool requests.
 */
export default function AdminServiceRequestsPage() {
  return (
    <RequestsQueueTable
      fetchUrl="/api/admin/service-requests"
      titleKey="title"
      subtitleKey="subtitle"
      enableStatusFilter
    />
  );
}
