# Supabase Experiment

This keeps Netlify as a static frontend host and moves the app data layer to Supabase.

## Scope

- Netlify: hosts `index.html`, CSS, images, and JS
- Supabase: stores employees, trusted devices, active breaks, break history
- No Netlify Functions are needed for the experiment path

## Files in this experiment

- [supabase.config.js](/C:/Users/D_Reyes/Documents/New%20project/supabase.config.js)
- [supabase-schema.sql](/C:/Users/D_Reyes/Documents/New%20project/supabase-schema.sql)
- [supabase-experiment.js](/C:/Users/D_Reyes/Documents/New%20project/supabase-experiment.js)

## Step by step

1. In Supabase SQL Editor, run [supabase-schema.sql](/C:/Users/D_Reyes/Documents/New%20project/supabase-schema.sql).
2. In Supabase `Table Editor`, import your employees into `employees`.
3. Make sure each TL has their own row in `employees`.
4. Add or keep one admin row. The SQL file already seeds `admin@ags.com / agent707`.
5. Edit [supabase.config.js](/C:/Users/D_Reyes/Documents/New%20project/supabase.config.js) and paste your real `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
6. In [index.html](/C:/Users/D_Reyes/Documents/New%20project/index.html), change the last script line from `./app.js` to `./supabase-experiment.js`.
7. Deploy the site to Netlify.
8. Test login as admin, agent, and TL.

## Employees table mapping

- `employee_id` = Google Sheet Col A
- `full_name` = Google Sheet Col B
- `department` = Google Sheet Col C
- `email` = Google Sheet Col D
- `tl_email` = Google Sheet Col E
- `role` = `agent`, `tl`, or `admin`
- `password` = your generated password

## Important notes

- This experiment uses direct frontend access with the anon key.
- The provided RLS policies are intentionally open so you can test quickly.
- Because passwords are stored in plain text here, treat this as an experiment, not a hardened production auth system.
- Once the flow works, the next hardening step would be moving login/auth away from plain text employees rows.
