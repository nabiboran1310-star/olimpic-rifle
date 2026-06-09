import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "Профиль - Olympic Rifle Simulator" }] }),
  component: ProfilePage,
});

type Profile = {
  display_name: string | null;
  credits: number;
  total_score: number;
  perfect_tens: number;
  equipped_skin: string;
  selected_discipline: string;
  skins: unknown;
  upgrades: unknown;
  created_at: string;
};

function createFallbackProfile(email?: string): Profile {
  return {
    display_name: email?.split("@")[0] ?? null,
    credits: 0,
    total_score: 0,
    perfect_tens: 0,
    equipped_skin: "default",
    selected_discipline: "air_rifle_10m",
    skins: ["default"],
    upgrades: [],
    created_at: new Date().toISOString(),
  };
}

function ProfilePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;

    (async () => {
      setFetching(true);
      setProfileError(null);

      const { data, error } = await supabase
        .from("profiles")
        .select("display_name, credits, total_score, perfect_tens, equipped_skin, selected_discipline, skins, upgrades, created_at")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        setProfileError("Не удалось загрузить профиль. Проверьте Supabase RLS и миграции.");
      }

      const nextProfile = (data as Profile | null) ?? createFallbackProfile(user.email);
      setProfile(nextProfile);
      setName(nextProfile.display_name ?? "");
      setFetching(false);
    })();
  }, [user]);

  const saveName = async () => {
    if (!user) return;

    setSaving(true);
    setProfileError(null);

    const { error } = await supabase
      .from("profiles")
      .upsert({ user_id: user.id, display_name: name }, { onConflict: "user_id" });

    if (error) {
      setProfileError("Не удалось сохранить профиль.");
    } else {
      setProfile((p) => (p ? { ...p, display_name: name } : createFallbackProfile(user.email)));
    }

    setSaving(false);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  if (loading || fetching) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground text-xs tracking-widest">
        ЗАГРУЗКА...
      </div>
    );
  }

  if (!user || !profile) return null;

  const skinsList: string[] = Array.isArray(profile.skins) ? profile.skins : [];
  const upgradesList: string[] = Array.isArray(profile.upgrades) ? profile.upgrades : [];

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="text-[10px] tracking-[0.4em] text-muted-foreground">OLYMPIC RANGE</div>
            <h1 className="text-2xl font-bold tracking-widest">ПРОФИЛЬ СТРЕЛКА</h1>
          </div>
          <div className="flex gap-2">
            <Link
              to="/"
              className="border border-border px-4 py-2 text-xs tracking-widest hover:bg-secondary"
            >
              В ТИР
            </Link>
            <button
              onClick={signOut}
              className="border border-destructive text-destructive px-4 py-2 text-xs tracking-widest hover:bg-destructive hover:text-destructive-foreground"
            >
              ВЫЙТИ
            </button>
          </div>
        </div>

        {profileError && (
          <div className="border border-destructive text-destructive px-4 py-3 text-xs mb-6">
            {profileError}
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <Stat label="КРЕДИТЫ" value={profile.credits.toString()} accent="gold" />
          <Stat label="ОБЩИЙ СЧЕТ" value={Number(profile.total_score).toFixed(1)} />
          <Stat label="ИДЕАЛЬНЫХ 10.9" value={profile.perfect_tens.toString()} accent="gold" />
        </div>

        <div className="border border-border bg-[var(--navy-mid)] p-6 mb-6">
          <div className="text-[10px] tracking-widest text-muted-foreground mb-3">EMAIL</div>
          <div className="font-mono mb-6 break-all">{user.email}</div>

          <div className="text-[10px] tracking-widest text-muted-foreground mb-2">ИМЯ СТРЕЛКА</div>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 bg-background border border-border px-3 py-2 font-mono"
            />
            <button
              onClick={saveName}
              disabled={saving || name === (profile.display_name ?? "")}
              className="bg-primary text-primary-foreground px-4 py-2 text-xs tracking-widest disabled:opacity-40"
            >
              {saving ? "..." : "СОХРАНИТЬ"}
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-border bg-[var(--navy-mid)] p-6">
            <div className="text-[10px] tracking-widest text-muted-foreground mb-3">ЭКИПИРОВАННЫЙ ПРИЦЕЛ</div>
            <div className="font-bold tracking-widest">{profile.equipped_skin.toUpperCase()}</div>
            <div className="text-[10px] tracking-widest text-muted-foreground mt-4 mb-2">ОТКРЫТЫЕ СКИНЫ ({skinsList.length})</div>
            <div className="flex flex-wrap gap-1">
              {skinsList.map((s) => (
                <span key={s} className="text-[10px] tracking-widest border border-border px-2 py-1 font-mono">{s}</span>
              ))}
            </div>
          </div>
          <div className="border border-border bg-[var(--navy-mid)] p-6">
            <div className="text-[10px] tracking-widest text-muted-foreground mb-3">УЛУЧШЕНИЯ ({upgradesList.length})</div>
            {upgradesList.length === 0 ? (
              <div className="text-xs text-muted-foreground">Еще ничего не куплено</div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {upgradesList.map((u) => (
                  <span key={u} className="text-[10px] tracking-widest border border-primary text-primary px-2 py-1 font-mono">{u}</span>
                ))}
              </div>
            )}
            <div className="text-[10px] tracking-widest text-muted-foreground mt-4">АККАУНТ СОЗДАН</div>
            <div className="font-mono text-xs">{new Date(profile.created_at).toLocaleDateString()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "gold" }) {
  return (
    <div className="border border-border bg-[var(--navy-mid)] p-4">
      <div className="text-[10px] tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-3xl font-bold tabular-nums mt-1 ${accent === "gold" ? "text-[var(--gold-bright)]" : "text-primary"}`}>
        {value}
      </div>
    </div>
  );
}
