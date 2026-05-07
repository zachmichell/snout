import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  CalendarDays,
  PawPrint,
  Users,
  ClipboardList,
  LogOut,
  MessageSquare,
  BedDouble,
  Scissors,
  HeartPulse,
  FileText,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
  ShoppingCart,
  Receipt,
  Package,
  Wrench,
  GraduationCap,
  BarChart3,
} from "lucide-react";
import Logo from "./Logo";
import StaffCodeSwitcher from "./StaffCodeSwitcher";
import LocationSwitcher from "./LocationSwitcher";
import { useAuth } from "@/hooks/useAuth";
import { useStaffUnreadCount } from "@/hooks/useConversations";
import { usePermissions } from "@/hooks/usePermissions";
import type { Permission } from "@/lib/permissions";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSidebarCollapsed } from "@/hooks/useSidebarCollapsed";

const sections: Array<{
  label: string;
  items: Array<{ to: string; icon: any; label: string; badgeKey?: "messages"; permission?: Permission }>;
}> = [
  {
    label: "Overview",
    items: [{ to: "/dashboard", icon: LayoutDashboard, label: "Pack View" }],
  },
  {
    label: "Operations",
    items: [
      { to: "/calendar", icon: CalendarDays, label: "Calendar" },
      { to: "/reservations", icon: ClipboardList, label: "Reservations" },
      { to: "/group-classes", icon: GraduationCap, label: "Group Classes" },
      { to: "/lodging", icon: BedDouble, label: "Lodging" },
      { to: "/grooming", icon: Scissors, label: "Grooming" },
      { to: "/pet-care", icon: HeartPulse, label: "Pet Care" },
      { to: "/report-cards", icon: FileText, label: "Report Cards" },
    ],
  },
  {
    label: "Billing",
    items: [
      { to: "/pos/cart", icon: ShoppingCart, label: "POS" },
      { to: "/invoices", icon: Receipt, label: "Invoices", permission: "invoices.view" as Permission },
      { to: "/products", icon: Package, label: "Products" },
      { to: "/services", icon: Wrench, label: "Services", permission: "services.manage" as Permission },
    ],
  },
  {
    label: "Insights",
    items: [
      { to: "/analytics", icon: BarChart3, label: "Analytics", permission: "revenue.view" as Permission },
    ],
  },
  {
    label: "Facility",
    items: [
      { to: "/pets", icon: PawPrint, label: "Pets" },
      { to: "/owners", icon: Users, label: "Owners" },
      { to: "/messages", icon: MessageSquare, label: "Messages", badgeKey: "messages" },
    ],
  },
];

export default function Sidebar({ orgName }: { orgName?: string | null }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const unreadMessages = useStaffUnreadCount();
  const { can } = usePermissions();
  const { collapsed, toggle } = useSidebarCollapsed();

  const visibleSections = sections
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.permission || can(i.permission)) }))
    .filter((s) => s.items.length > 0);

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  const initials = `${profile?.first_name?.[0] ?? ""}${profile?.last_name?.[0] ?? ""}`.toUpperCase() || "??";
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || profile?.email || "User";

  const width = collapsed ? "w-[68px]" : "w-[250px]";

  return (
    <TooltipProvider delayDuration={150}>
      <aside className={`flex h-screen ${width} flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200`}>
        <div className={`flex items-center ${collapsed ? "justify-center px-0" : "justify-between px-5"} pt-6 pb-4`}>
          {!collapsed && (
            <div className="min-w-0">
              <Logo className="text-sidebar-primary-foreground" />
              {orgName && (
                <div className="mt-1 pl-7 text-xs text-sidebar-foreground/70 truncate">{orgName}</div>
              )}
            </div>
          )}
          <button
            onClick={toggle}
            className="rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-primary-foreground transition-colors"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <nav className={`flex-1 overflow-y-auto overflow-x-hidden ${collapsed ? "px-2" : "px-3"} py-2`}>
          {visibleSections.map((section) => (
            <div key={section.label} className="mb-5">
              {!collapsed && (
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-sidebar-foreground/50">
                  {section.label}
                </div>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const badgeCount =
                    (item as { badgeKey?: string }).badgeKey === "messages" ? unreadMessages : 0;
                  const link = (
                    <NavLink
                      to={item.to}
                      end={item.to === "/dashboard"}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-md ${
                          collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2"
                        } text-[13px] font-medium transition-colors ${
                          isActive
                            ? "bg-sidebar-primary text-sidebar-primary-foreground"
                            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        }`
                      }
                    >
                      <span className="relative">
                        <item.icon className="h-4 w-4 shrink-0" />
                        {collapsed && badgeCount > 0 && (
                          <span className="absolute -right-2 -top-1.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
                            {badgeCount > 9 ? "9+" : badgeCount}
                          </span>
                        )}
                      </span>
                      {!collapsed && <span className="flex-1">{item.label}</span>}
                      {!collapsed && badgeCount > 0 && (
                        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white">
                          {badgeCount > 99 ? "99+" : badgeCount}
                        </span>
                      )}
                    </NavLink>
                  );
                  return (
                    <li key={item.to}>
                      {collapsed ? (
                        <Tooltip>
                          <TooltipTrigger asChild>{link}</TooltipTrigger>
                          <TooltipContent side="right">{item.label}</TooltipContent>
                        </Tooltip>
                      ) : (
                        link
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className={`border-t border-sidebar-border ${collapsed ? "px-2 py-3 flex justify-center" : "px-3 py-3 space-y-2"}`}>
          <StaffCodeSwitcher compact={collapsed} />
          {!collapsed && <LocationSwitcher />}
        </div>

        <div className="border-t border-sidebar-border px-3 py-3">
          <div className={`flex items-center ${collapsed ? "flex-col gap-2" : "gap-3"} rounded-md px-2 py-2`}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground text-xs font-semibold">
              {initials}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-sidebar-primary-foreground">{fullName}</div>
                <div className="truncate text-[11px] text-sidebar-foreground/60">{profile?.email}</div>
              </div>
            )}
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <NavLink
                    to="/settings"
                    className="rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-primary-foreground transition-colors"
                    aria-label="Settings"
                  >
                    <SettingsIcon className="h-4 w-4" />
                  </NavLink>
                </TooltipTrigger>
                <TooltipContent side="right">Settings</TooltipContent>
              </Tooltip>
            ) : (
              <NavLink
                to="/settings"
                className="rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-primary-foreground transition-colors"
                aria-label="Settings"
              >
                <SettingsIcon className="h-4 w-4" />
              </NavLink>
            )}
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleSignOut}
                    className="rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-primary-foreground transition-colors"
                    aria-label="Sign out"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Sign out</TooltipContent>
              </Tooltip>
            ) : (
              <button
                onClick={handleSignOut}
                className="rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-primary-foreground transition-colors"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}
