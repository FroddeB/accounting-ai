import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

export interface User {
  id: string;
  email: string;
  admin: boolean;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/api/auth/me")
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    await api.post("/api/auth/logout");
    setUser(null);
  }

  return <Ctx.Provider value={{ user, loading, setUser, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
