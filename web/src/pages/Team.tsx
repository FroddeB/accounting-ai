import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, Users } from "lucide-react";

interface Member {
  id: string;
  email: string;
  role: string;
  is_admin: boolean;
  created_at: string;
  last_login_at: string | null;
  has_password: boolean;
}

export function Team() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const d = await api.get("/api/team");
      setMembers(d.members);
    } catch (e) {
      toast.error((e as ApiError).message);
      setMembers([]);
    }
  }
  useEffect(() => { load(); }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const d = await api.post("/api/team/invite", { email });
      toast.success(d.created ? `Invited ${email}` : `Re-sent invite to ${email}`);
      setEmail("");
      load();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6">
      <h1 className="flex items-center gap-2 text-lg font-semibold"><Users className="size-5" /> Team</h1>

      <Card>
        <CardHeader><CardTitle className="text-base">Invite a member</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={invite} className="flex gap-2">
            <Input type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Button type="submit" disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : "Send invite"}</Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">They'll get an email to set a password, then can upload invoices.</p>
        </CardContent>
      </Card>

      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last login</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members === null ? (
              <TableRow><TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                <Loader2 className="mr-2 inline size-4 animate-spin" /> Loading…
              </TableCell></TableRow>
            ) : members.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">{m.email}</TableCell>
                <TableCell><Badge variant={m.is_admin ? "default" : "secondary"}>{m.role}</Badge></TableCell>
                <TableCell>
                  {m.has_password
                    ? <span className="text-success text-sm">active</span>
                    : <span className="text-warning text-sm">invite pending</span>}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {m.last_login_at ? new Date(m.last_login_at).toLocaleString("da-DK") : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
