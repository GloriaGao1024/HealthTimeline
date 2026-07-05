# HealthTimeline

HealthTimeline is a native HTML/CSS/JavaScript health record timeline app. It uses a small Node.js server (`server.js`) to serve the static files and provide backend proxy APIs for Baidu OCR and AI chat.

This repository intentionally stays framework-free. It is not a React or Vue project.

## Project Structure

- `index.html`: Main page.
- `css/`: Page styles.
- `js/`: Browser-side application logic.
- `assets/`: Images and visual assets.
- `lib/`: Browser-side integration helpers, including Supabase client setup.
- `server.js`: Node.js static server plus OCR and AI API endpoints.
- `deploy/`: Deployment-specific files for VPS and Vercel options.
- `scripts/`: Utility scripts.
- `DEPLOY.md`: Additional deployment notes.
- `deploy.ps1`, `auto-deploy.ps1`, `deploy-zip.ps1`: Windows deployment helpers.

Generated folders such as `node_modules/`, `outputs/`, `dist/`, and zip archives should not be committed.

## Local Development

Requirements:

- Node.js 22 or newer
- npm

Install dependencies:

```bash
npm install
```

Create local environment variables:

```bash
cp .env.example .env
```

Edit `.env` and fill in the keys you need. Then start the app:

```bash
npm start
```

Open:

```text
http://127.0.0.1:8792/
```

Health check:

```text
http://127.0.0.1:8792/api/health
```

## Environment Variables

`server.js` reads `.env` from the project root.

- `PORT`: Local server port. Defaults to `8792`.
- `BAIDU_OCR_API_KEY`: Baidu OCR API key.
- `BAIDU_OCR_SECRET_KEY`: Baidu OCR secret key.
- `BAIDU_OCR_ENDPOINT`: Optional OCR endpoint override.
- `AI_API_BASE`: Base URL for an OpenAI-compatible chat API.
- `AI_CHAT_COMPLETIONS_URL`: Optional full chat completions URL override.
- `AI_API_KEY`: AI API key.
- `AI_MODEL`: Chat model name.

Do not commit `.env` or any real secret values.

## Supabase Configuration

The browser app loads Supabase SDK from CDN in `index.html` and creates the client in `lib/supabase.js`.

To connect a different Supabase project, update the public project URL and publishable key in `lib/supabase.js`:

```js
const SUPABASE_URL = "https://your-project.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "your_publishable_key";
```

The publishable key is safe to expose in browser code, but Supabase Row Level Security and Storage policies must be configured correctly in the Supabase dashboard. Do not place service role keys in this repository or in browser-side files.

The current app expects Supabase tables/storage used by the existing page logic, including family members, reports, indicators, and report file storage. Keep database schema and policies aligned with the browser code before deploying.

### Supabase SQL Migration

Before using multiple email identities, run the migration in Supabase SQL Editor:

```text
supabase/migrations/001_add_user_isolation.sql
```

This creates a lightweight `users` table if needed and ensures these app data tables support `user_id` isolation:

- `family_members.user_id`
- `documents.user_id`
- `reports.user_id`

The current MVP does not use Supabase Auth. The browser creates a stable `user_id` from the normalized email, then every Supabase query and insert includes that `user_id`. Different email addresses therefore read and write separate rows.

To verify isolation:

1. Log in with `person-a@example.com`, add a family member or upload a report.
2. Open the site in another browser/session and log in with `person-b@example.com`.
3. Confirm the second email does not see the first email's family members or reports.
4. In Supabase Table Editor, compare `family_members`, `documents`, and `reports`; rows from the two emails should have different `user_id` values.

## Server Deployment

On a server:

```bash
git clone <your-github-repo-url> HealthTimeline
cd HealthTimeline
npm install
cp .env.example .env
```

Fill in `.env`, then start:

```bash
npm start
```

For long-running deployment, use a process manager such as pm2:

```bash
npm install -g pm2
pm2 start server.js --name healthtimeline
pm2 save
```

Make sure the server firewall and cloud security group allow the configured `PORT`.

Windows deployment helpers are included:

- `deploy.ps1`: Pull latest code, install dependencies, and restart the Node service.
- `auto-deploy.ps1`: Check remote Git changes and run deployment when new commits exist.
- `deploy-zip.ps1`: Deploy from a zip package while preserving the server `.env`.

## GitHub Collaboration Flow

Recommended flow:

```bash
git checkout -b feature/short-description
git status
git add .
git commit -m "Describe the change"
git push -u origin feature/short-description
```

Open a Pull Request on GitHub, review the changed files, then merge into the main branch after verification.

Before committing, check that these are not included:

- `.env` or other files containing real keys
- `node_modules/`
- `outputs/`
- temporary zip archives
- runtime logs
