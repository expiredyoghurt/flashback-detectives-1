# Flashback Detectives

Branching-story practice for P3/4 pupils: **Embedded** (The Lost Puppy), **Classical** (The Old Bicycle) and **Linked** (The New Boy) flashbacks.
Cloudflare Worker + D1 database + static pages (`public/`). Pupils log in with a username and PIN. Teachers use `/teacher.html`.

## Files
- `public/index.html`: story selector, login, all three stories
- `public/notes.html`: notes on the three flashback types
- `public/teacher.html`: teacher dashboard
- `src/worker.js`: API (register, login, log, complete, admin summary, reset PIN)
- `schema.sql`: D1 tables (safe to re-run)
- `.github/workflows/deploy.yml`: auto-deploy on push to `main`

## Deploy via GitHub
1. Create a GitHub repo and push this folder to `main`.
2. In a terminal (once): `npx wrangler login`, then `npx wrangler d1 create flashback-db`. Copy the `database_id` into `wrangler.toml`, commit and push.
3. Create a Cloudflare API token (template **Edit Cloudflare Workers**, plus **D1: Edit**). In the GitHub repo go to Settings → Secrets and variables → Actions and add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. Push to `main` (or run the workflow manually). It creates the tables and deploys. The URL is `https://flashback-detectives.<your-subdomain>.workers.dev`.
5. **Set your own teacher login** (one time, after the first deploy):
   ```
   npx wrangler secret put admin_user
   npx wrangler secret put admin_password
   ```
   If these secrets are not set, the defaults are **admin123 / password123**. Change them before pupils use it.

## Local test
`npx wrangler d1 execute DB --local --file=schema.sql && npx wrangler dev`

## Teacher guide
- Open `/teacher.html` and log in.
- **Pupils:** stories finished (of 3), points, try-agains, last active. Reset a forgotten PIN here.
- **Where pupils struggle:** each step ranked by the share of non-best choices. Steps near the top need re-teaching (e.g. "len" in The Lost Puppy shows who picks over-long flashbacks).
- **Reflections:** open each completed story to read pupils' written answers.
- In class: pupils read the notes, play one story per lesson, then discuss the reflection answers.

## Notes
- Scoring is calculated in the browser, which is fine for a low-stakes classroom tool.
- Pupil sessions do not expire. Pupil PINs are hashed, but there is no login rate limiting. Add Cloudflare rate-limit rules if you open it beyond your school.
