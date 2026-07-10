from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

from .core.config import settings
from .db.session import engine, SessionLocal
from .models.base import Base
from .models.user import User
from .core.security import get_password_hash

# Import routers
from .api.routes import auth, patient, gesture_mappings, calibration, detections, websocket

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="VisionCare AI Backend",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(patient.router, prefix="/api/patients", tags=["patients"])
app.include_router(gesture_mappings.router, prefix="/api/gesture-mappings", tags=["gesture-mappings"])
app.include_router(calibration.router, prefix="/api/calibration", tags=["calibration"])
app.include_router(detections.router, prefix="/api/detections", tags=["detections"])
app.include_router(websocket.router, tags=["websockets"])

@app.on_event("startup")
def startup_event():
    logger.info("Initializing database tables...")
    try:
        from sqlalchemy import inspect, text
        inspector = inspect(engine)
        if "patients" in inspector.get_table_names():
            columns = [c["name"] for c in inspector.get_columns("patients")]
            if "face_embedding" not in columns:
                logger.info("Database schema is out of date (missing face_embedding). Migrating columns...")
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE patients ADD COLUMN face_embedding JSON DEFAULT NULL"))
                    conn.execute(text("ALTER TABLE patients ADD COLUMN face_calibrated BOOLEAN DEFAULT 0"))
                    conn.execute(text("ALTER TABLE patients ADD COLUMN face_similarity_threshold JSON DEFAULT NULL"))
                logger.info("Database migration completed.")
        
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables initialized successfully.")
    except Exception as e:
        logger.error(f"Failed to initialize database tables: {e}")
        
    # Seed default user if none exist
    db = SessionLocal()
    try:
        if db.query(User).count() == 0:
            default_user = User(
                email="nurse@visioncare.com",
                name="Default Nurse",
                hashed_password=get_password_hash("password123"),
                role="nurse",
                ward_id="ICU-1"
            )
            db.add(default_user)
            db.commit()
            logger.info("Seeded default nurse user: nurse@visioncare.com / password123")
    except Exception as e:
        logger.error(f"Error seeding database: {e}")
    finally:
        db.close()

@app.get("/health", tags=["health"])
def health_check():
    return {"status": "healthy"}
