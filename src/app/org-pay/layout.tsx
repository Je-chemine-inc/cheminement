import SiteMessages from "@/components/SiteMessages";

/** An organization paying an invoice: a page of its own, so it carries the site's messages itself. */
export default function OrgPayLayout({ children }: { children: React.ReactNode }) {
  return <SiteMessages>{children}</SiteMessages>;
}
