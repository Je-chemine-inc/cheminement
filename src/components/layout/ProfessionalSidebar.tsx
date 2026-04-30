"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState, useEffect } from "react";
import {
  Home,
  User,
  Calendar,
  FileText,
  Settings,
  BookOpen,
  Users,
  BarChart3,
  HelpCircle,
  LogOut,
  ChevronRight,
  Wallet,
  Star,
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

export function ProfessionalSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { state } = useSidebar();
  const t = useTranslations("Dashboard.sidebar");
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const loadUnread = async () => {
      try {
        const res = await fetch("/api/messages");
        if (!res.ok) return;
        const data = await res.json();
        const total = (data.conversations as Array<{ unread: number }>).reduce(
          (sum, c) => sum + (c.unread ?? 0),
          0,
        );
        setUnreadCount(total);
      } catch {
        // silent
      }
    };
    loadUnread();
    const id = setInterval(loadUnread, 60000);
    return () => clearInterval(id);
  }, []);

  const navigationItems = [
    {
      title: t("dashboard"),
      items: [
        {
          title: t("overview"),
          url: "/professional/dashboard",
          icon: Home,
        },
        {
          title: t("profile"),
          url: "/professional/dashboard/profile",
          icon: User,
        },
        {
          title: t("schedule"),
          url: "/professional/dashboard/schedule",
          icon: Calendar,
        },
        {
          title: t("billing"),
          url: "/professional/dashboard/billing",
          icon: Wallet,
        },
      ],
    },
    {
      title: t("clientManagement"),
      items: [
        {
          title: t("proposals"),
          url: "/professional/dashboard/proposals",
          icon: Star,
        },
        {
          title: t("myClients"),
          url: "/professional/dashboard/clients",
          icon: Users,
        },
        {
          title: t("sessions"),
          url: "/professional/dashboard/sessions",
          icon: FileText,
        },
      ],
    },
    {
      title: t("resources"),
      items: [
        {
          title: t("library"),
          url: "/professional/dashboard/library",
          icon: BookOpen,
        },
        {
          title: t("analytics"),
          url: "/professional/dashboard/analytics",
          icon: BarChart3,
        },
      ],
    },
    {
      title: t("support"),
      items: [
        {
          title: t("messages"),
          url: "/professional/dashboard/messages",
          icon: MessageSquare,
          badge: unreadCount,
        },
        {
          title: t("helpCenter"),
          url: "/professional/dashboard/help-center",
          icon: HelpCircle,
        },
        {
          title: t("settings"),
          url: "/professional/dashboard/settings",
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
                  const badge = "badge" in item ? (item as { badge?: number }).badge : undefined;
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
                          {badge && badge > 0 ? (
                            <span className="ml-auto inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold w-4 h-4">
                              {badge > 9 ? "9+" : badge}
                            </span>
                          ) : isActive ? (
                            <ChevronRight className="ml-auto h-4 w-4" />
                          ) : null}
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
