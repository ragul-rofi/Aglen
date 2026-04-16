# Aglen Platform: Standalone Farmer App + Standalone Admin Console

This repository now runs as two separate applications:

- Farmer app (PWA, camera flow, field UX): `ui/`
- Admin app (company master dashboard): `admin-ui/`

They are independent deployments and independent dev servers. The admin experience is not a path inside the farmer app.

## 1) Backend Setup

1. Create your backend env file from `.env.example`:

```powershell
Copy-Item .env.example .env
```

2. Fill in these required values in `.env`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `DEVICE` (`cpu` recommended on non-GPU machines)

3. Start backend:

```powershell
.\.venv\Scripts\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8000
```

## 2) Farmer App (Standalone PWA)

1. Create env file:

```powershell
Copy-Item ui\.env.example ui\.env
```

2. Fill in values in `ui/.env`:

- `VITE_API_URL=http://localhost:8000`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

3. Install and run:

```powershell
Set-Location ui
npm install --legacy-peer-deps
npm run dev
```

Farmer app runs on `http://localhost:5173`.

## 3) Admin Console (Standalone App)

1. Create env file:

```powershell
Copy-Item admin-ui\.env.example admin-ui\.env
```

2. Fill in values in `admin-ui/.env`:

- `VITE_API_URL=http://localhost:8000`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

3. Install and run:

```powershell
Set-Location admin-ui
npm install
npm run dev
```

Admin app runs on `http://localhost:5174`.

For the UI app admin module (`ui/`), route paths are:

- `/admin` (Overview)
- `/admin/users`
- `/admin/scans`
- `/admin/alerts`
- `/admin/map`
- `/admin/health`

## 4) Authentication + Initial Credentials

Seed/create auth users and map them into the `users` table:

```powershell
Set-Location .
.\.venv\Scripts\python.exe scripts\bootstrap_auth.py
```

Default credentials created by the script:

- Farmer: `farmer@aglen.local` / `Farmer@12345!`
- Admin: `admin@aglen.local` / `Admin@12345!`

Change these immediately in production.

## 5) Master Dashboard Controls

The admin console includes:

- Account visibility and role distribution
- Scan throughput visualizations
- Active alert visibility
- Model lifecycle operations (upload/activate)

New backend endpoints:

- `GET /admin/models`
- `POST /admin/models/upload`
- `POST /admin/models/activate`

Model artifacts are stored under `src/weights/model_store/` by default and can be changed via `MODEL_STORE_DIR`.

## 6) Continuous Model Replacement Workflow

1. Train and export new `.pth` model.
2. Optional: export `class_names.json` for that model.
3. Log in to admin console.
4. Upload model in Model Registry Control.
5. Activate the uploaded model.

No code changes are required for each model replacement.

## 7) Production Hosting (3 Platforms)

Recommended split:

- Backend API (`api/`) -> Render (Web Service)
- Farmer PWA (`ui/`) -> Vercel (Static Vite app)
- Admin dashboard (`admin-ui/`) -> Netlify (Static Vite app)

You can choose other providers, but this split keeps concerns isolated and gives HTTPS by default.

### 7.1 Deploy Backend on Render

1. Create a new Render Web Service from this repo.
2. Root directory: repository root.
3. Build command:

```bash
pip install -r requirements.txt
```

4. Start command:

```bash
python -m uvicorn api.main:app --host 0.0.0.0 --port $PORT
```

5. Set environment variables in Render:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `MODEL_PATH=src/weights/best_model.pth`
- `DEVICE=cpu` (unless GPU runtime is configured)
- `MODEL_STORE_DIR=src/weights/model_store`
- `CORS_ALLOW_ORIGINS=https://<farmer-domain>,https://<admin-domain>`

6. After deploy, note backend URL (example: `https://aglen-api.onrender.com`).

### 7.2 Deploy Farmer PWA on Vercel

1. Create Vercel project from this repo.
2. Root directory: `ui`.
3. Framework preset: Vite.
4. Environment variables:

- `VITE_API_URL=https://<your-backend-domain>`
- `VITE_SUPABASE_URL=https://<project-ref>.supabase.co`
- `VITE_SUPABASE_ANON_KEY=<anon-key>`

5. Deploy and note URL (example: `https://aglen-farmer.vercel.app`).

### 7.3 Deploy Admin Dashboard on Netlify

1. Create Netlify site from this repo.
2. Base directory: `admin-ui`.
3. Build command: `npm run build`.
4. Publish directory: `dist`.
5. Environment variables:

- `VITE_API_URL=https://<your-backend-domain>`
- `VITE_SUPABASE_URL=https://<project-ref>.supabase.co`
- `VITE_SUPABASE_ANON_KEY=<anon-key>`

6. Deploy and note URL (example: `https://aglen-admin.netlify.app`).

### 7.4 Final CORS Update

After farmer/admin URLs are known, update backend `CORS_ALLOW_ORIGINS` with exact domains:

```text
https://aglen-farmer.vercel.app,https://aglen-admin.netlify.app
```

Redeploy backend after env update.

### 7.5 Bring PWA to Mobile

1. Open farmer URL on mobile browser:

- Android (Chrome): tap menu -> **Add to Home screen**
- iPhone (Safari): Share -> **Add to Home Screen**

2. Ensure HTTPS is used (Vercel provides this automatically).
3. Open installed app icon from home screen; it will launch in standalone PWA mode.

### 7.6 Post-Deploy Smoke Tests

1. Farmer login works and camera scan loads.
2. Admin login works and `/admin`, `/admin/users`, `/admin/scans`, `/admin/alerts`, `/admin/map`, `/admin/health` load.
3. Model upload + activate works from admin dashboard.
4. Backend `/health` returns `ready=true`.
