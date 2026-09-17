import SiteMessages from "@/components/SiteMessages";

/** Guest payment: a page of its own, so it carries the site's messages itself. */
export default function PayLayout({ children }: { children: React.ReactNode }) {
  return <SiteMessages>{children}</SiteMessages>;
}
