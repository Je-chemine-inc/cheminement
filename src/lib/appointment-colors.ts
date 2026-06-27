/**
 * Shared status → Tailwind colour classes for appointment blocks, so the
 * professional's own agenda and the admin per-pro schedule colour them the same
 * way (and can't drift). Colour conveys the appointment STATUS:
 *   pending → amber · ongoing → violet · completed → slate · scheduled → sky.
 */
export function appointmentStatusColor(status?: string): string {
  switch (status) {
    case "pending":
      return "bg-amber-50 border-amber-200 text-amber-900";
    case "ongoing":
      return "bg-violet-50 border-violet-200 text-violet-900";
    case "completed":
      return "bg-slate-50 border-slate-200 text-slate-700";
    default:
      // scheduled / accepted / anything else
      return "bg-sky-50 border-sky-200 text-sky-900";
  }
}
