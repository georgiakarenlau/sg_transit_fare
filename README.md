# OptiMap — Singapore Transit Fare Calculator

A web app that finds and compares public transport routes across Singapore, with fare estimates, route visualisation, and multi-criteria optimisation.

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
| Frontend | React 18, Vite, react-leaflet, Leaflet.js |
| Backend | Python 3.11+, FastAPI, httpx, Pydantic |
| Routing data | OneMap API (Singapore Land Authority) |
| Map tiles | CARTO Positron |

## Project Structure

```
opti_map/
├── backend/
│   ├── main.py              # FastAPI app — routing, fare calculation, OneMap calls
│   ├── fare_calculator.py   # LTA 2024 distance-fare table lookup
│   ├── requirements.txt
│   └── .env                 # (not committed) — holds ONEMAP_EMAIL and ONEMAP_PASSWORD
└── frontend/
    ├── src/
    │   ├── App.jsx           # Main component — map, search, route list
    │   ├── components/
    │   │   ├── RouteCard.jsx     # Individual route card with chip summary
    │   │   └── LocationInput.jsx # Autocomplete input
    │   └── index.css
    ├── index.html
    └── package.json
```

## Setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- A free [OneMap account](https://www.onemap.gov.sg/apidocs/) (for the routing API)

### Backend

```bash
cd backend
pip install -r requirements.txt
```

Create a `.env` file in the `backend/` folder:

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

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/search?q=<query>` | Location autocomplete via OneMap |
| `GET /api/routes?from=<loc>&to=<loc>&fare_type=<adult\|student\|senior>` | Returns up to 8 ranked route itineraries |

## Fare Accuracy Notes

Fares are calculated using the **2024 LTA distance-fare table** against corrected fare distances:

- **MRT cross-line journeys** — haversine distance × 1.17 (OTP track geometry overestimates vs LTA's internal fare distance)
- **Single MRT line** — OTP distance used directly (accurate)
- **Bus** — adaptive correction: if OTP distance / haversine < 1.15 (no GTFS shape data), uses haversine × 1.20

Fares shown are indicative. Always verify before travel.

## License

MIT
