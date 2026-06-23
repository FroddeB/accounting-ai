import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function Reset() {
  const [params] = useSearchParams();
  const id = params.get("id") ?? "";
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const invalidLink = !id || !token;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (password !== confirm) {
      setErr("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/auth/reset", { id, token, password });
      setDone(true);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-muted/40 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Set password</CardTitle>
          <CardDescription>Choose a password for your account.</CardDescription>
        </CardHeader>
        <CardContent>
          {invalidLink ? (
            <p className="text-sm text-destructive">This reset link is invalid or incomplete.</p>
          ) : done ? (
            <div className="grid gap-4">
              <p className="text-sm">Your password has been set.</p>
              <Link to="/login" className="text-sm font-medium hover:underline">→ Sign in</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="pw">New password</Label>
                <Input id="pw" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pw2">Confirm password</Label>
                <Input id="pw2" type="password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </div>
              {err && <p className="text-sm text-destructive">{err}</p>}
              <Button type="submit" disabled={busy}>{busy ? "…" : "Set password"}</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
