import RequestsQueueTable from "@/components/admin/RequestsQueueTable";

/**
 * "Pool Général / Liste Générale" — the requests currently in the general pool
 * (routingStatus "general"/"refused"), i.e. open for any active professional to
 * self-claim. Mirrors the "Demande de service" tab's feature set exactly (same
 * assign / re-match / send-to-general / delete actions), just filtered to the
 * pool. NOTE: this is the appointment-level general pool — distinct from the
 * "Patients" tab, which is the client CRM.
 */
export default function AdminGeneralPoolPage() {
  return (
    <RequestsQueueTable
      fetchUrl="/api/admin/general-pool"
      titleKey="poolTitle"
      subtitleKey="poolSubtitle"
    />
  );
}
