# VisionCare AI

Real-time patient monitoring via computer vision. A camera feed is analyzed
frame-by-frame for eye/mouth landmark metrics (EAR/MAR) and head pose,
classified into gestures (blink, sustained eyes-closed, yawn, head tilt),
and streamed to a live dashboard — with configurable alert escalation
(email/SMS) when a gesture is sustained and high-confidence.

## Architecture

```
Camera Feed (frontend) ──WS──▶ /ws/feed/{patient_id} ──▶ Detector (dlib landmarks)
                                                              │
                                                    metrics.py (EAR/MAR)
                                                              │
                                              gesture_classifier.py (sustained-event tracking)
                                                              │
                                        notification.py (alert eval + email/SMS + broadcast)
                                                              │
                                                    /ws/alerts ──WS──▶ Dashboard (frontend)
```

REST API (`/api/patients`, `/api/detections`) handles CRUD and historical
queries; WebSockets (`/ws/*`) handle the real-time path.

## Stack

- **Backend:** FastAPI, SQLAlchemy + PostgreSQL, dlib + OpenCV, JWT auth
- **Frontend:** React + TypeScript, WebSocket hook for live updates
- **Infra:** Docker Compose (Postgres, backend, frontend)

## Getting started

```bash
git clone <repo-url>
cd visioncare-ai
cp .env.example .env   # fill in SECRET_KEY at minimum
```

**Get the landmark model** (not bundled — see `backend/app/cv/detector.py`):

```bash
mkdir -p backend/app/cv/models
curl -L -o backend/app/cv/models/shape_predictor_68_face_landmarks.dat.bz2 \
  http://dlib.net/files/shape_predictor_68_face_landmarks.dat.bz2
bunzip2 backend/app/cv/models/shape_predictor_68_face_landmarks.dat.bz2
```

**Run everything:**

```bash
docker compose up --build
```

- Backend: http://localhost:8000 (docs at `/docs`, health at `/health`)
- Frontend: http://localhost:3000
- Postgres: `localhost:5432` (user/pass/db: `visioncare`)

**Run the backend alone, locally:**

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## Configuration

All settings load from environment variables (see `backend/app/core/config.py`
for the full list and defaults). Key ones:

| Variable | Purpose |
|---|---|
| `SECRET_KEY` | JWT signing key — **must** be overridden in any non-local deployment |
| `DATABASE_URL` | Postgres connection string |
| `EAR_THRESHOLD` / `MAR_THRESHOLD` | Eyes-closed / mouth-open detection thresholds |
| `CONSECUTIVE_FRAMES_ALERT` | Frames a condition must persist before it counts as "sustained" |
| `NOTIFICATIONS_ENABLED`, `SMTP_*`, `TWILIO_*` | Alert escalation channels |

## API overview

| Endpoint | Description |
|---|---|
| `POST /api/detections/analyze` | Run detection on a single uploaded frame, no persistence |
| `POST /api/detections` | Persist a detection event, triggers alert evaluation |
| `GET /api/detections` | List/filter detection history |
| `WS /ws/feed/{patient_id}` | Camera worker pushes live metrics |
| `WS /ws/alerts?patient_id=` | Dashboard subscribes to real-time alerts |

## Project status

This repo is under active scaffolding. Built so far:

- ✅ `app/main.py`, `app/core/config.py`, `app/core/security.py`
- ✅ `app/api/dependencies.py`, routes: `detections.py`, `websocket.py`
- ✅ `app/cv/` — `metrics.py`, `gesture_classifier.py`, `detector.py`
- ✅ `app/services/` — `patient_service.py`, `notification.py`
- ✅ `backend/requirements.txt`, `backend/Dockerfile`, `docker-compose.yml`

**Not yet built** (needed before this runs end-to-end):

- ⬜ `app/db/session.py` — SQLAlchemy engine/session + Alembic migrations
- ⬜ `app/models/` — `Patient`, `Detection`, `Alert`, `User` (SQLAlchemy)
- ⬜ `app/schemas/` — matching Pydantic schemas (`DetectionCreate`, etc.)
- ⬜ `app/api/routes/patients.py`, `app/api/routes/auth.py`
- ⬜ `__init__.py` in every backend package
- ⬜ Frontend: `main.tsx`/`App.tsx`, `services/api.ts`, `services/websocket.ts`,
  `types/`, state management, and all component implementations
- ⬜ Backend/frontend test suites

## License

TBD.
