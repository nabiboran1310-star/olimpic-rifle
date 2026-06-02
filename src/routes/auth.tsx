import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Вход — Olympic Rifle Simulator" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/profile" });
  }, [user, loading, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: displayName || email.split("@")[0] },
          },
        });
        if (error) throw error;
        setMsg("Аккаунт создан. Проверьте почту для подтверждения, затем войдите.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/profile" });
      }
    } catch (e: any) {
      setErr(e.message || "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="w-full max-w-md border border-border bg-[var(--navy-mid)] p-8">
        <div className="text-[10px] tracking-[0.4em] text-muted-foreground mb-2">OLYMPIC RANGE</div>
        <h1 className="text-2xl font-bold tracking-widest mb-6">
          {mode === "signin" ? "ВХОД В АККАУНТ" : "РЕГИСТРАЦИЯ"}
        </h1>

        <div className="flex border border-border mb-6">
          <button
            onClick={() => setMode("signin")}
            className={`flex-1 py-2 text-xs tracking-widest ${mode === "signin" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            ВОЙТИ
          </button>
          <button
            onClick={() => setMode("signup")}
            className={`flex-1 py-2 text-xs tracking-widest ${mode === "signup" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            СОЗДАТЬ АККАУНТ
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === "signup" && (
            <div>
              <label className="text-[10px] tracking-widest text-muted-foreground">ИМЯ СТРЕЛКА</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-background border border-border px-3 py-2 mt-1 font-mono"
                placeholder="Например: Иван П."
              />
            </div>
          )}
          <div>
            <label className="text-[10px] tracking-widest text-muted-foreground">EMAIL</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-background border border-border px-3 py-2 mt-1 font-mono"
            />
          </div>
          <div>
            <label className="text-[10px] tracking-widest text-muted-foreground">ПАРОЛЬ</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-background border border-border px-3 py-2 mt-1 font-mono"
            />
          </div>

          {err && <div className="text-xs text-destructive">{err}</div>}
          {msg && <div className="text-xs text-primary">{msg}</div>}

          <button
            disabled={busy}
            className="w-full bg-primary text-primary-foreground font-bold tracking-widest py-2.5 hover:bg-[var(--gold-bright)] transition-colors disabled:opacity-50"
          >
            {busy ? "..." : mode === "signin" ? "ВОЙТИ" : "ЗАРЕГИСТРИРОВАТЬСЯ"}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link to="/" className="text-xs tracking-widest text-muted-foreground hover:text-foreground">
            ← НА ГЛАВНУЮ
          </Link>
        </div>
      </div>
    </div>
  );
}
