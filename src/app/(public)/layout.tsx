import { Header, Footer } from "@/components/layout";
import SiteMessages from "@/components/SiteMessages";
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SiteMessages>
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </div>
    </SiteMessages>
  );
}
