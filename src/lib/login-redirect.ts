/**
 * Where to send a signed-out visitor of a private page: /login, carrying the
 * page they asked for so the login page resumes there after sign-in.
 *
 * Found 2026-09-19: the (privilaged) layout redirected to a bare /login before
 * the professional layout could add its callbackUrl, so every email deep-link
 * (« Voir la demande », « À planifier ») dropped a signed-out pro on their
 * default page. Both layouts now build the redirect here.
 *
 * `pathname` and `search` come from the middleware's x-pathname / x-search
 * headers. Only the private areas are carried over; the login page still
 * accepts nothing but a same-origin path.
 */
const PRIVATE_AREAS = ["/professional", "/client", "/admin"];

export function loginRedirectFor(pathname: string, search = ""): string {
  const isPrivate = PRIVATE_AREAS.some(
    (area) => pathname === area || pathname.startsWith(`${area}/`),
  );
  if (!isPrivate) return "/login";
  const query = search.startsWith("?") ? search : "";
  return `/login?callbackUrl=${encodeURIComponent(pathname + query)}`;
}
