import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Menu, LogOut, User as UserIcon, ChevronDown } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useOwnerRecord } from "@/hooks/useOwnerRecord";
import { useOwnerConversation } from "@/hooks/useConversations";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

const navItems = [
  { to: "/portal/dashboard", label: "Dashboard" },
  { to: "/portal/pets", label: "My Pets" },
  { to: "/portal/bookings", label: "Bookings" },
  { to: "/portal/history", label: "History" },
  { to: "/portal/report-cards", label: "Report Cards" },
  { to: "/portal/webcams", label: "Live Cameras" },
  { to: "/portal/classes", label: "Classes" },
  { to: "/portal/messages", label: "Messages", badge: "messages" as const },
  { to: "/portal/invoices", label: "Invoices" },
  { to: "/portal/purchases", label: "Purchases" },
  { to: "/portal/credits", label: "Credits" },
  { to: "/portal/agreements", label: "Agreements" },
];

function initials(first?: string | null, last?: string | null, email?: string | null) {
  const f = (first ?? "").trim()[0];
  const l = (last ?? "").trim()[0];
  if (f || l) return `${f ?? ""}${l ?? ""}`.toUpperCase();
  return (email ?? "?")[0]?.toUpperCase() ?? "?";
}

export default function OwnerTopNav() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: owner } = useOwnerRecord();
  const { data: conversation } = useOwnerConversation(owner?.id);
  const unreadCount = conversation?.unread_owner ?? 0;

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      isActive
        ? "bg-primary-light text-primary-hover"
        : "text-foreground/70 hover:text-foreground hover:bg-muted"
    }`;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <NavLink to="/portal/dashboard" className="flex items-center gap-2">
            <span className="text-xl">🐾</span>
            <span className="font-display text-lg font-bold tracking-tight">Snout</span>
          </NavLink>
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const showBadge = item.badge === "messages" && unreadCount > 0;
              return (
                <NavLink key={item.to} to={item.to} className={linkClass}>
                  <span className="inline-flex items-center gap-1.5">
                    {item.label}
                    {showBadge && (
                      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                  </span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-full px-2 py-1 hover:bg-muted transition-colors">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">
                  {initials(profile?.first_name, profile?.last_name, profile?.email)}
                </span>
                <span className="hidden sm:inline text-sm font-medium text-foreground">
                  {profile?.first_name ?? "Account"}
                </span>
                <ChevronDown className="hidden sm:block h-4 w-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => navigate("/portal/account")}>
                <UserIcon className="mr-2 h-4 w-4" />
                Account Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <nav className="mt-8 flex flex-col gap-1">
                {navItems.map((item) => {
                  const showBadge = item.badge === "messages" && unreadCount > 0;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center justify-between px-3 py-3 rounded-md text-sm font-medium ${
                          isActive
                            ? "bg-primary-light text-primary-hover"
                            : "text-foreground/80 hover:bg-muted"
                        }`
                      }
                    >
                      <span>{item.label}</span>
                      {showBadge && (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
