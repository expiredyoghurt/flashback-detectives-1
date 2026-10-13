# Flashback Detectives v1.3

Branching-story practice for P3/4 pupils: 10 stories (4 embedded, 4 linked, 2 classical) plus a sorting game. See CHANGELOG.md.
Cloudflare Worker + D1 database + static pages (`public/`). Pupils log in with a username and PIN. Teachers use `/teacher.html`.

## Files
- `public/index.html`: story selector, login, all three stories
- `public/notes.html`: notes on the three flashback types
- `public/teacher.html`: teacher dashboard
- `src/worker.js`: API and server-side scoring
- `src/stories.json`: ALL story content, feedback, points, hints and the sorting extracts (edit this to change or add stories)
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
- Scoring is done on the server. Pupil PINs are hashed, sessions expire, and repeated bad logins are locked out for 10 minutes.
- Teacher dashboard: filter by class, click a pupil for their choices, comment on writing, assign stories, bulk-create accounts (PINs are shown once), export CSV.
- Adding a story: copy an entry in `src/stories.json` (each node needs at least one option with `"r":"g"`; `"n"` is the next node, `"sum"` ends the story; `"rt":1` forces a retry). Then redeploy.
