# Project Rules

## Deployment

- This project is a TanStack Start SSR app built with Vite and Nitro.
- Vercel root directory is the repository root: `olimpic-rifle`.
- Vercel install command is `npm ci`.
- Vercel build command is `npm run build`.
- Vercel output directory should be left empty so Vercel uses Nitro's
  `.vercel/output` build output.
- Keep `vercel.json` minimal. It pins npm commands because both `package-lock.json`
  and `bun.lock` exist.
- Do not convert this to a static SPA deployment unless the app is intentionally
  rewritten to stop using TanStack Start SSR.

## Env Safety

- Never commit `.env`, `.env.local`, or generated Vercel handoff files.
- Keep `.env.example` committed with variable names only, no real secret values.
- Public browser variables use `VITE_*`; anything private must not use `VITE_*`.
- `VERCEL_ENV_IMPORT.local.env` and `VERCEL_ENV_VALUES.local.md` are local-only
  helper files and must stay ignored by Git.
- Do not print API keys, tokens, database passwords, private keys, or service
  role keys in chat or documentation.

## Supabase

- `SUPABASE_URL` is the base Supabase project URL, with no `/rest/v1`.
- `SUPABASE_PUBLISHABLE_KEY` is the Supabase anon/public key.
- `VITE_SUPABASE_URL` is the same public project URL exposed to the browser.
- `VITE_SUPABASE_PUBLISHABLE_KEY` is the same anon/public key exposed to the
  browser.
- `VITE_SUPABASE_PROJECT_ID` is the project ref, the part before
  `.supabase.co`.
- `VITE_AUTH_REDIRECT_URL` is the public app URL used for Supabase email/OAuth
  redirects in deployed environments. It must not be `localhost` on Vercel.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. Never put it in frontend code,
  `VITE_*`, `.env.example` values, or public docs.
- Only require a service role key when a real backend admin action must bypass
  RLS. Public reads and authenticated profile updates should use the anon/public
  key with RLS policies.

## Database Migrations

- Migrations are SQL files in `supabase/migrations` that create or update
  database tables.
- The current app needs the `profiles` table and auth trigger migration.
- If Supabase reports that a table cannot be found in the schema cache, apply
  the migrations to the target Supabase project.
- If the Supabase CLI is available, use:

```sh
supabase link --project-ref ilvkdymeuhwcqliaorks
supabase db push
```

- If CLI auth or the database password is missing, run the migration SQL files
  manually in the Supabase Dashboard SQL Editor, in filename order.
- For apps that require starter content, use idempotent seed SQL. This app does
  not need starter profile rows because profiles are created on signup.

## Gemini

- `GEMINI_API_KEY` is server-only and must never be exposed as `VITE_*`.
- `GEMINI_MODEL` should default to `gemini-2.5-flash-lite` for student projects
  unless the user explicitly asks for another model.
- Do not require Gemini env vars unless code actually uses Gemini.

## Before Deploy

- Confirm the working folder and Git remote are the intended project.
- Confirm `.env` is ignored and not tracked by Git.
- Confirm `.env.example` contains names only and is committed.
- Confirm Vercel env vars are set for Production, Preview, and Development.
- Confirm Supabase migrations have been applied to the same project ref used by
  the env vars.
- Run `npm run build` and verify it creates Nitro/Vercel output.
