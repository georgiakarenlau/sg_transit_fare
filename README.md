# OptiMap — Singapore Transit Fare Calculator

A web app that finds and compares public transport routes across Singapore, with fare estimates, route visualisation, and multi-criteria optimisation.

**Live app: [opti-map-amber.vercel.app](https://opti-map-amber.vercel.app/)**

## Features

- **Route search** — type any MRT station, bus stop, or landmark; live autocomplete powered by OneMap
- **Multiple route options** — up to 8 unique itineraries per search across transit, bus, and rail modes
- **Fare estimates** — Adult / Student / Senior EZ-Link fares calculated against the 2024 LTA distance-fare table
- **Optimise by** — toggle between Lowest Fare, Fewest Transfers, or Least Walking
- **Interactive map** — per-leg coloured polylines using actual route geometry; MRT lines use official LTA colours
- **MRT line colours** — chips and map polylines both match the official line colour (e.g. EWL green, DTL blue, CCL orange)

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, react-leaflet, Leaflet.js — hosted on Vercel |
| Backend | Python 3.11+, FastAPI, httpx, Pydantic — hosted on Render |
| Routing data | OneMap API (Singapore Land Authority) |
| Map tiles | CARTO Positron |

## Project Structure

```
opti_map/
├── backend/
│   ├── main.py              # FastAPI app — routing, fare calculation, OneMap calls
│   ├── fare_calculator.py   # LTA 2024 distance-fare table lookup
│   ├── requirements.txt
│   ├── .env.example         # credential template
│   └── .env                 # (not committed) — holds ONEMAP_EMAIL and ONEMAP_PASSWORD
├── frontend/
│   ├── src/
│   │   ├── App.jsx               # Main component — map, search, route list
│   │   ├── components/
│   │   │   ├── RouteCard.jsx     # Individual route card with chip summary
│   │   │   └── LocationInput.jsx # Autocomplete input
│   │   └── index.css
│   ├── index.html
│   └── package.json
└── render.yaml              # Render.com deployment config (backend)
```

## Local Setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- A free [OneMap account](https://www.onemap.gov.sg/apidocs/) (for the routing API)

### Backend

```bash
cd backend
pip install -r requirements.txt
```

Create a `.env` file in the `backend/` folder (see `.env.example`):

```
ONEMAP_EMAIL=your@email.com
ONEMAP_PASSWORD=yourpassword
```

Start the server:

```bash
uvicorn main:app --reload
```

The API runs at `http://localhost:8000`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The app runs at `http://localhost:5173`.

---

## Deployment

The app is deployed for free using **Render** (backend) and **Vercel** (frontend).

| Service | URL |
|---|---|
| Frontend (Vercel) | https://opti-map-amber.vercel.app/ |
| Backend (Render) | https://opti-map.onrender.com |

> **Note:** On the free Render tier the backend sleeps after 15 minutes of inactivity. The first request after idle takes ~30–60 seconds to wake up. You can check the backend is live at `/health`.

### Re-deploying after code changes

- **Frontend** — Vercel auto-deploys on every push to `main`. Nothing to do.
- **Backend** — Render also auto-deploys on push. If it doesn't trigger, go to the Render dashboard → **Manual Deploy → Deploy latest commit**.

### Setting up your own deployment

#### 1 — Backend on Render

1. Go to [render.com](https://render.com) and sign up (free, no credit card).
2. Click **New → Web Service** → **Connect a repository** → select `opti_map`.
3. Set the following (Render may not auto-read `render.yaml` if set up manually):
   - **Root Directory:** `backend`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Under **Environment Variables**, add:
   - `ONEMAP_EMAIL` → your OneMap email
   - `ONEMAP_PASSWORD` → your OneMap password
5. Click **Deploy** and copy the service URL once it finishes.

#### 2 — Frontend on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub (free).
2. Click **Add New → Project** → import `opti_map`.
3. Set **Root Directory** to `frontend`.
4. Under **Environment Variables**, add:
   - `VITE_API_BASE` → your Render backend URL from step 1
5. Click **Deploy**.

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | Liveness check — returns `{"status":"ok"}` |
| `GET /api/search?q=<query>` | Location autocomplete via OneMap |
| `GET /api/routes?from=<loc>&to=<loc>` | Returns up to 8 ranked route itineraries (adult EZ-Link fares) |

## Fare Accuracy Notes

Fares are calculated using the **2024 LTA distance-fare table** against corrected fare distances:

- **MRT cross-line journeys** — haversine distance × 1.17 (OTP track geometry overestimates vs LTA's internal fare distance)
- **Single MRT line** — OTP distance used directly (accurate)
- **Bus** — adaptive correction: if OTP distance / haversine < 1.15 (no GTFS shape data), uses haversine × 1.20

Fares shown are indicative. Always verify before travel.

## License

MIT
