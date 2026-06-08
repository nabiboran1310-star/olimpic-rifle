# Vercel deployment

This is a TanStack Start SSR app built by Vite/Nitro. Vercel must build the
Nitro Vercel output, not a plain static `dist/` folder.

Use these Vercel project settings:

- Root Directory: project root (`olimpic-rifle`)
- Framework Preset: TanStack Start, or Other if TanStack Start is not shown
- Install Command: `npm ci`
- Build Command: `npm run build`
- Output Directory: leave empty

`vercel.json` pins the install and build commands so Vercel does not choose Bun
just because `bun.lock` is present.

Add these Environment Variables in Vercel for Production, Preview, and
Development:

```env
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
VITE_SUPABASE_PROJECT_ID=
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_AUTH_REDIRECT_URL=
```

Where to get each value:

- `SUPABASE_URL`: Supabase project API URL, formatted like
  `https://PROJECT_REF.supabase.co`, with no `/rest/v1`.
- `SUPABASE_PUBLISHABLE_KEY`: Supabase anon/public key from Supabase project
  settings.
- `VITE_SUPABASE_PROJECT_ID`: Supabase project ref, the part before
  `.supabase.co`.
- `VITE_SUPABASE_URL`: same Supabase project API URL as `SUPABASE_URL`; this is
  public because it is exposed to the browser.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: same anon/public key as
  `SUPABASE_PUBLISHABLE_KEY`; this is public because it is exposed to the
  browser.
- `VITE_AUTH_REDIRECT_URL`: the public Vercel app URL, for example
  `https://your-project.vercel.app`. Supabase email confirmations and OAuth
  redirects should return users to this URL, not `localhost`.

`SUPABASE_SERVICE_ROLE_KEY` is not required by the current app because no server
route imports the admin Supabase client. Only add it for real backend admin
operations that must bypass RLS, and never put it in a `VITE_*` variable.

## Database

Migrations are SQL files that create or update database tables. This app needs
the `profiles` table from `supabase/migrations`.

The Supabase project ref is the part of the URL before `.supabase.co`. Example:
for `https://abc123.supabase.co`, the project ref is `abc123`.

If the app shows a Supabase error like `Could not find the table ... in the
schema cache`, apply the SQL migration to the target Supabase project:

```sh
supabase link --project-ref ilvkdymeuhwcqliaorks
supabase db push
```

If the Supabase CLI is not logged in or asks for a database password, open the
Supabase Dashboard SQL Editor for the same project and run the SQL files in
`supabase/migrations` in filename order.
