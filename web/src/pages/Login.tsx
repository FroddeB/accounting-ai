import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function Login() {
  const { setUser } = useAuth();
  const nav = useNavigate();
  const [step, setStep] = useState<"credentials" | "twofa">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const d = await api.post("/api/auth/login", { email, password });
      setTokenId(d.tokenId);
      setStep("twofa");
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.code === "no_password"
        ? "This account has no password yet — use “Forgot password” to set one."
        : ae.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const d = await api.post("/api/auth/verify-2fa", { tokenId, code });
      setUser(d.user);
      nav("/", { replace: true });
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
          <CardTitle className="text-2xl">Projekt Y</CardTitle>
          <CardDescription>
            {step === "credentials" ? "Sign in to manage bilag" : `Enter the code we emailed to ${email}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "credentials" ? (
            <form onSubmit={submitCredentials} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              {err && <p className="text-sm text-destructive">{err}</p>}
              <Button type="submit" disabled={busy}>{busy ? "…" : "Sign in"}</Button>
              <Link to="/forgot" className="text-center text-sm text-muted-foreground hover:underline">
                Forgot password?
              </Link>
            </form>
          ) : (
            <form onSubmit={submitCode} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="code">Verification code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  className="text-center text-lg tracking-[0.4em]"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  autoFocus
                  required
                />
              </div>
              {err && <p className="text-sm text-destructive">{err}</p>}
              <Button type="submit" disabled={busy || code.length !== 6}>{busy ? "…" : "Verify"}</Button>
              <button type="button" onClick={() => setStep("credentials")} className="text-sm text-muted-foreground hover:underline">
                ← Back
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
