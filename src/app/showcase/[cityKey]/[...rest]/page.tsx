import { notFound } from "next/navigation";

/**
 * Any path on a city host that no page claims: a real 404 (the HTTP status
 * included) rendered inside the city's own header and footer, instead of the
 * root 404 page, whose links point at pages that only exist on www.
 */
export const dynamic = "force-dynamic";

export default function ShowcaseUnknownPath(): never {
  notFound();
}
