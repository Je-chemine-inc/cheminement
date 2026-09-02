/**
 * Display name for an appointment's client, safe when the client record is gone.
 *
 * `Appointment.clientId` is a ref. When the user is deleted the ref dangles and
 * mongoose `populate` yields `null`, so `appointment.clientId.firstName` throws
 * and takes the whole React tree with it — a white screen the professional
 * cannot get past, in any browser, because it is the data and not the cache.
 *
 * The professional dashboard's proposals page already guards this by filtering
 * orphan rows out of a list of pending requests, which is fine there. An agenda
 * is different: silently dropping a session the professional actually held is
 * worse than showing it, so the schedule keeps the row and labels the client.
 *
 * The caller supplies the fallback so the copy stays in next-intl (FR/EN
 * lockstep) rather than being hardcoded here.
 */
export function clientDisplayName(
  client:
    | { firstName?: string | null; lastName?: string | null }
    | null
    | undefined,
  fallback: string,
): string {
  if (!client) return fallback;

  const name = [client.firstName, client.lastName]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" ");

  // A populated doc with no usable name is as unhelpful as a missing one.
  return name || fallback;
}

/**
 * Initials for an avatar bubble, safe when the client record is gone.
 *
 * The crash sites used `client.firstName.charAt(0)` directly, which throws on
 * both a null client AND a client whose name fields are empty.
 */
export function clientInitials(
  client:
    | { firstName?: string | null; lastName?: string | null }
    | null
    | undefined,
  fallback = "?",
): string {
  const first = typeof client?.firstName === "string" ? client.firstName.trim() : "";
  const last = typeof client?.lastName === "string" ? client.lastName.trim() : "";
  const initials = `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
  return initials || fallback;
}
