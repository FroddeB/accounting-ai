import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Login } from "./pages/Login";
import { Forgot } from "./pages/Forgot";
import { Reset } from "./pages/Reset";
import { Bilag } from "./pages/Bilag";

export function App() {
  const { loading } = useAuth();
  if (loading) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading…</div>;
  }
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot" element={<Forgot />} />
      <Route path="/reset" element={<Reset />} />
      <Route path="/" element={<Protected><Bilag /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Protected({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}
