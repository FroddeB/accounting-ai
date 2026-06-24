import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth";
import { Button } from "@/components/ui/button";
import { Banknote, Clock, LayoutDashboard, Paperclip, Sparkles, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export function Layout() {
  const { user, logout } = useAuth();
  const link = ({ isActive }: { isActive: boolean }) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
      isActive ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center gap-1 px-6 py-2.5">
          <strong className="mr-2 text-sm">Projekt Y</strong>
          <NavLink to="/dashboard" className={link}><LayoutDashboard className="size-4" /> Dashboard</NavLink>
          <NavLink to="/invoices" className={link}><Sparkles className="size-4" /> Invoices</NavLink>
          <NavLink to="/bilag" className={link}><Paperclip className="size-4" /> Bilag</NavLink>
          <NavLink to="/salary" className={link}><Banknote className="size-4" /> Salary</NavLink>
          <NavLink to="/history" className={link}><Clock className="size-4" /> History</NavLink>
          {user?.admin && <NavLink to="/team" className={link}><Users className="size-4" /> Team</NavLink>}
          <div className="flex-1" />
          <span className="text-sm text-muted-foreground">{user?.email}</span>
          <Button variant="ghost" size="sm" onClick={logout}>Log out</Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
