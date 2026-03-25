# AGS Break Tracker

Netlify-hosted break tracker for AGS agents and team leads, with Supabase as the backend.

## What it does

- Uses Supabase as the source of truth for employees, trusted devices, active breaks, and break history.
- Lets agents and TLs sign in with their email and their own password from the `employees` table.
- Gives agents access only to their own current break and break history.
- Gives team leads the same personal view plus live team breaks and overbreak history for their team.
- Uses Supabase Realtime plus a light polling fallback so TLs can see updates across browsers in near real time.
- Links each account to the first browser/device that signs in successfully.

## Deployment

1. Upload this project to a Netlify site.
2. Run [supabase-schema.sql](/C:/Users/D_Reyes/Documents/New%20project/supabase-schema.sql) in your Supabase SQL Editor.
3. Import your employees into the `employees` table.
4. Update [supabase.config.js](/C:/Users/D_Reyes/Documents/New%20project/supabase.config.js) with your actual Supabase project URL and anon key.
5. Deploy the site to Netlify.

## Notes

- The app currently allows only two break types: `15m` and `60m`.
- Each employee and TL should have their own row in the `employees` table.
- Real-time TL updates use Supabase Realtime with a 15-second polling fallback.
- `Keep me signed in` saves the session in browser storage on that computer.
- If a device needs to be replaced later, the trusted-device record for that email will need to be reset.
- This setup is for experimentation and still stores passwords in plain text in Supabase, so it is not a hardened production auth design yet.
