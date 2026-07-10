from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from uuid import UUID
import base64
from typing import Dict, Any, List

from ...db.session import get_db
from ...models.patient import Patient
from ...models.gesture import GestureType, CalibrationSample
from ...schemas.schemas import CalibrationSession, CalibrationSampleCreate
from ..dependencies import get_current_user, get_detector, get_face_recognizer
from ...cv.face_recognizer import FaceRecognizer

router = APIRouter()

GESTURE_INSTRUCTIONS = {
    GestureType.SUSTAINED_CLOSE: {
        "title": "Sustained Eyes Closed",
        "instruction": "Close your eyes and keep them closed for 3 seconds.",
        "demoVideo": ""
    },
    GestureType.DOUBLE_BLINK: {
        "title": "Double Blink",
        "instruction": "Blink your eyes twice quickly in succession.",
        "demoVideo": ""
    },
    GestureType.MOUTH_OPEN: {
        "title": "Mouth Open",
        "instruction": "Open your mouth wide and hold it open.",
        "demoVideo": ""
    },
    GestureType.HEAD_LEFT: {
        "title": "Head Tilt Left",
        "instruction": "Tilt your head to the left side.",
        "demoVideo": ""
    },
    GestureType.HEAD_RIGHT: {
        "title": "Head Tilt Right",
        "instruction": "Tilt your head to the right side.",
        "demoVideo": ""
    }
}

# ──────────────────────────────────────────────────────────────────────
# Face Capture endpoints (new – Step 0 of calibration)
# ──────────────────────────────────────────────────────────────────────

from pydantic import BaseModel

class FaceCapturePayload(BaseModel):
    frames: List[str]          # List of base64-encoded JPEG frames (20–30 recommended)
    threshold: float = 0.75    # Optional per-patient override


@router.post("/{patient_id}/face/capture")
def capture_face_embedding(
    patient_id: UUID,
    payload: FaceCapturePayload,
    db: Session = Depends(get_db),
    recognizer: FaceRecognizer = Depends(get_face_recognizer),
    current_user=Depends(get_current_user),
):
    """
    Step 0 of calibration: capture 20–30 frames of the patient's face,
    extract ArcFace embeddings, average them, and store in the database.
    """
    patient = db.query(Patient).filter(
        Patient.id == patient_id, Patient.is_active == True
    ).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    embeddings = []
    frames_processed = 0

    for frame_b64 in payload.frames:
        # Strip data URL prefix if present
        if "," in frame_b64:
            frame_b64 = frame_b64.split(",", 1)[1]
        try:
            frame_bytes = base64.b64decode(frame_b64)
            emb = recognizer.extract_embedding(frame_bytes)
            if emb is not None:
                embeddings.append(emb)
            frames_processed += 1
        except Exception:
            pass

    if not embeddings:
        raise HTTPException(
            status_code=422,
            detail="No face detected in any of the provided frames. "
                   "Ensure the patient is well-lit and facing the camera.",
        )

    # Average all detected embeddings → single representative vector
    avg_embedding = recognizer.average_embeddings(embeddings)

    # Persist
    patient.face_embedding = FaceRecognizer.embedding_to_list(avg_embedding)
    patient.face_calibrated = True
    patient.face_similarity_threshold = payload.threshold
    db.commit()

    return {
        "success": True,
        "frames_submitted": len(payload.frames),
        "frames_processed": frames_processed,
        "faces_detected": len(embeddings),
        "threshold_stored": payload.threshold,
        "message": f"Face profile captured from {len(embeddings)} frames.",
    }


@router.get("/{patient_id}/face/status")
def get_face_calibration_status(
    patient_id: UUID,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Returns whether this patient has a stored face embedding."""
    patient = db.query(Patient).filter(
        Patient.id == patient_id, Patient.is_active == True
    ).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    return {
        "patient_id": str(patient_id),
        "face_calibrated": patient.face_calibrated,
        "threshold": patient.face_similarity_threshold or 0.75,
    }


# ──────────────────────────────────────────────────────────────────────
# Existing calibration endpoints (unchanged)
# ──────────────────────────────────────────────────────────────────────

@router.post("/{patient_id}/start", response_model=CalibrationSession)
def start_calibration(patient_id: UUID, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    patient = db.query(Patient).filter(Patient.id == patient_id, Patient.is_active == True).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
        
    gestures = [
        GestureType.SUSTAINED_CLOSE,
        GestureType.DOUBLE_BLINK,
        GestureType.MOUTH_OPEN,
        GestureType.HEAD_LEFT,
        GestureType.HEAD_RIGHT
    ]
    
    return {
        "patientName": patient.name,
        "gesturesToCalibrate": gestures,
        "instructions": {g: GESTURE_INSTRUCTIONS[g] for g in gestures}
    }

@router.post("/{patient_id}/sample")
def save_calibration_sample(
    patient_id: UUID, 
    payload: CalibrationSampleCreate, 
    db: Session = Depends(get_db), 
    detector = Depends(get_detector),
    current_user = Depends(get_current_user)
):
    patient = db.query(Patient).filter(Patient.id == patient_id, Patient.is_active == True).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
        
    ears = []
    mars = []
    
    for frame_base64 in payload.frames:
        if "," in frame_base64:
            frame_base64 = frame_base64.split(",")[1]
        try:
            frame_bytes = base64.b64decode(frame_base64)
            metrics = detector.extract_metrics(frame_bytes)
            if metrics:
                ears.append(metrics["ear"])
                mars.append(metrics["mar"])
        except Exception:
            pass
            
    avg_ear = sum(ears) / len(ears) if ears else 0.28
    avg_mar = sum(mars) / len(mars) if mars else 0.20
    
    sample = CalibrationSample(
        patient_id=patient_id,
        gesture_type=payload.gesture_type,
        metrics_snapshot={"avg_ear": avg_ear, "avg_mar": avg_mar},
        is_valid=True
    )
    db.add(sample)
    db.commit()
    
    return {"message": "Sample saved successfully", "avg_ear": avg_ear, "avg_mar": avg_mar}

@router.post("/{patient_id}/complete")
def complete_calibration(patient_id: UUID, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    patient = db.query(Patient).filter(Patient.id == patient_id, Patient.is_active == True).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
        
    samples = db.query(CalibrationSample).filter(
        CalibrationSample.patient_id == patient_id,
        CalibrationSample.is_valid == True
    ).all()
    
    ear_threshold = 0.21
    mar_threshold = 0.6
    
    closed_ears = [s.metrics_snapshot["avg_ear"] for s in samples if s.gesture_type == GestureType.SUSTAINED_CLOSE]
    open_mouths = [s.metrics_snapshot["avg_mar"] for s in samples if s.gesture_type == GestureType.MOUTH_OPEN]
    
    if closed_ears:
        ear_threshold = min(0.25, max(0.18, sum(closed_ears) / len(closed_ears) + 0.03))
        
    if open_mouths:
        mar_threshold = min(0.8, max(0.4, (sum(open_mouths) / len(open_mouths)) * 0.8))
        
    patient.thresholds = {
        "ear_threshold": ear_threshold,
        "mar_threshold": mar_threshold
    }
    db.commit()
    
    return {
        "message": "Calibration completed",
        "thresholds": patient.thresholds
    }
