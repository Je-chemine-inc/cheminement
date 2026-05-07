"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Home,
  Users,
  User,
  LogOut,
  ChevronRight,
  ClipboardList,
  Wallet,
  Shield,
  Settings,
  Banknote,
  BookOpen,
  Inbox,
  FileText,
  Tags,
  HelpCircle,
  Library,
  MessageSquare,
} from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { useTranslations } from "next-intl";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import Image from "next/image";

export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { state } = useSidebar();
  const t = useTranslations("Dashboard.sidebar");

  const navigationItems = [
    {
      title: t("dashboard"),
      items: [
        {
          title: t("overview"),
          url: "/admin/dashboard",
          icon: Home,
        },
        {
          title: t("messages"),
          url: "/admin/dashboard/messages",
          icon: MessageSquare,
        },
      ],
    },
    {
      title: t("platformManagement"),
      items: [
        {
          title: t("professionals"),
          url: "/admin/dashboard/professionals",
          icon: Users,
        },
        {
          title: t("patients"),
          url: "/admin/dashboard/patients",
          icon: User,
        },
        {
          title: t("serviceRequests"),
          url: "/admin/dashboard/service-requests",
          icon: Inbox,
        },
        {
          title: t("reports"),
          url: "/admin/dashboard/reports",
          icon: ClipboardList,
        },
        {
          title: t("billing"),
          url: "/admin/dashboard/billing",
          icon: Wallet,
        },
        {
          title: t("accounting"),
          url: "/admin/dashboard/accounting",
          icon: BookOpen,
        },
        {
          title: t("paymentTrust"),
          url: "/admin/dashboard/payment-trust",
          icon: Banknote,
        },
        {
          title: t("legalDocuments"),
          url: "/admin/dashboard/legal-documents",
          icon: FileText,
        },
        {
          title: t("motifs"),
          url: "/admin/dashboard/motifs",
          icon: Tags,
        },
        {
          title: t("faqs"),
          url: "/admin/dashboard/faqs",
          icon: HelpCircle,
        },
        {
          title: t("library"),
          url: "/admin/dashboard/library",
          icon: Library,
        },
      ],
    },
    {
      title: t("administration"),
      items: [
        {
          title: "Admins",
          url: "/admin/dashboard/admins",
          icon: Shield,
        },
        {
          title: t("settings"),
          url: "/admin/dashboard/settings",
          icon: Settings,
        },
      ],
    },
  ];

  return (
    <Sidebar collapsible="icon" className="border-r border-border/40">
      <SidebarHeader className="border-b border-border/40 px-4 py-4">
        <Link
          href="/"
          className="flex items-center gap-2 font-serif text-xl font-light text-foreground"
        >
          {state === "expanded" && (
            <Image
              src="/Logo.png"
              alt={t("logo")}
              className="w-full px-8"
              width={256}
              height={32}
            />
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {navigationItems.map((section) => (
          <SidebarGroup key={section.title}>
            <SidebarGroupLabel className="text-xs font-light tracking-wider text-muted-foreground/70">
              {section.title}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const isActive = pathname === item.url;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        className="font-light transition-colors"
                      >
                        <Link href={item.url}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                          {isActive && (
                            <ChevronRight className="ml-auto h-4 w-4" />
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-border/40 p-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={async () => {
                await signOut({ redirect: false });
                router.push("/");
              }}
              className="font-light cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
              <span>{t("logout")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
