import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function Forgot() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/api/auth/forgot", { email });
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-muted/40 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Forgot password</CardTitle>
          <CardDescription>We'll email you a link to set a new password.</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="grid gap-4">
              <p className="text-sm">
                If an account exists for <b>{email}</b>, a link is on its way. Check your inbox.
              </p>
              <Link to="/login" className="text-sm text-muted-foreground hover:underline">← Back to sign in</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
              </div>
              <Button type="submit" disabled={busy}>{busy ? "…" : "Send reset link"}</Button>
              <Link to="/login" className="text-center text-sm text-muted-foreground hover:underline">← Back to sign in</Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
