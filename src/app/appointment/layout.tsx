import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

/**
 * Gate the public booking funnel.
 *
 * Anyone can reach /appointment — unauthenticated visitors are treated as
 * guests and may submit the form. But if an *authenticated* user with a
 * non-client role (admin / professional / employee) lands here, the API
 * would later reject their submission with an opaque "clientId required"
 * Mongoose validation error. Redirect them to their own dashboard
 * preemptively so they can't trigger that failure mode.
 */
export default async function AppointmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;

  if (role === "admin") redirect("/admin/dashboard");
  if (role === "professional") redirect("/professional/dashboard");
  if (role === "employee") redirect("/login");

  return <>{children}</>;
}
