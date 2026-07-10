from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from typing import Dict, Set
import asyncio
import json
import logging
from uuid import UUID

import numpy as np

logger = logging.getLogger(__name__)

from ...cv.detector import GestureDetector
from ...cv.gesture_classifier import PatientGestureClassifier
from ...cv.face_recognizer import FaceRecognizer
from ..dependencies import get_detector, get_patient, get_patient_classifier, get_face_recognizer
from ...services import patient_service
from ...services.notification import send_nurse_notification
from ...db.session import SessionLocal

router = APIRouter()

# ──────────────────────────────────────────────────────────────────────
# Connection Manager
# ──────────────────────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        # Ward ID -> Set of connected nurse dashboard websockets
        self.nurse_connections: Dict[str, Set[WebSocket]] = {}
        # Patient ID -> Camera feed websocket
        self.camera_connections: Dict[str, WebSocket] = {}
        
    async def connect_nurse(self, websocket: WebSocket, ward_id: str):
        await websocket.accept()
        if ward_id not in self.nurse_connections:
            self.nurse_connections[ward_id] = set()
        self.nurse_connections[ward_id].add(websocket)
        
    async def connect_camera(self, websocket: WebSocket, patient_id: str):
        await websocket.accept()
        self.camera_connections[patient_id] = websocket
        
    def disconnect_nurse(self, websocket: WebSocket, ward_id: str):
        if ward_id in self.nurse_connections:
            self.nurse_connections[ward_id].discard(websocket)
            
    async def broadcast_to_ward(self, ward_id: str, message: dict):
        if ward_id in self.nurse_connections:
            dead_connections = set()
            for connection in self.nurse_connections[ward_id]:
                try:
                    await connection.send_json(message)
                except Exception:
                    dead_connections.add(connection)
            self.nurse_connections[ward_id] -= dead_connections

manager = ConnectionManager()

# ──────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────

async def update_request_status(request_id: str, status: str, nurse_id: str):
    db = SessionLocal()
    try:
        return patient_service.update_request_status(
            db=db,
            request_id=UUID(request_id),
            status=status,
            nurse_id=nurse_id
        )
    finally:
        db.close()

# ──────────────────────────────────────────────────────────────────────
# Nurse dashboard WebSocket
# ──────────────────────────────────────────────────────────────────────

@router.websocket("/ws/nurse/{ward_id}")
async def nurse_dashboard_websocket(websocket: WebSocket, ward_id: str):
    await manager.connect_nurse(websocket, ward_id)
    try:
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "acknowledge":
                await update_request_status(
                    request_id=data["request_id"],
                    status=data["status"],
                    nurse_id=data["nurse_id"]
                )
    except WebSocketDisconnect:
        manager.disconnect_nurse(websocket, ward_id)

# ──────────────────────────────────────────────────────────────────────
# Camera feed WebSocket  ← identity-gated gesture recognition
# ──────────────────────────────────────────────────────────────────────

@router.websocket("/ws/camera/{patient_id}")
async def camera_feed_websocket(
    websocket: WebSocket,
    patient_id: str,
    detector: GestureDetector = Depends(get_detector),
    recognizer: FaceRecognizer = Depends(get_face_recognizer),
):
    await manager.connect_camera(websocket, patient_id)

    # ── Validate UUID ──────────────────────────────────────────────────
    try:
        patient_uuid = UUID(patient_id)
    except ValueError:
        await websocket.send_json({"type": "error", "detail": "Invalid patient UUID"})
        await websocket.close()
        return

    # ── Load patient (non-fatal if not found) ─────────────────────────
    try:
        patient = await get_patient(patient_uuid)
    except Exception:
        patient = None

    classifier = await get_patient_classifier(patient_uuid) if patient else None

    # ── Load stored face embedding ─────────────────────────────────────
    stored_embedding: np.ndarray | None = None
    face_threshold: float = 0.75
    face_calibrated: bool = False

    if patient:
        if patient.face_calibrated and patient.face_embedding:
            stored_embedding = FaceRecognizer.embedding_from_list(patient.face_embedding)
            face_threshold = patient.face_similarity_threshold or 0.75
            face_calibrated = True
            logger.info(f"Patient {patient.name}: face embedding loaded (threshold={face_threshold})")
        else:
            logger.warning(
                f"Patient {patient.name} has no face embedding — "
                "identity verification DISABLED (all frames accepted)."
            )

    import base64

    # ── Per-frame identity skip counter (avoid spamming WebSocket) ─────
    # Send identity status every N frames to keep bandwidth reasonable
    IDENTITY_REPORT_EVERY = 5
    frame_count = 0

    try:
        while True:
            # ── Receive frame (text = base64 data URL) ─────────────────
            try:
                raw = await websocket.receive_text()
            except Exception:
                try:
                    raw_bytes = await websocket.receive_bytes()
                    raw = None
                except Exception:
                    continue

            # ── Decode base64 → bytes ───────────────────────────────────
            if raw is not None:
                try:
                    if "," in raw:
                        raw = raw.split(",", 1)[1]
                    frame_data = base64.b64decode(raw)
                except Exception:
                    continue
            else:
                frame_data = raw_bytes

            frame_count += 1

            # ── ① Face Recognition / Identity Verification ─────────────
            identity_matched = True   # default: pass-through when not calibrated
            similarity = 1.0

            if face_calibrated and stored_embedding is not None:
                live_embedding = recognizer.extract_embedding(frame_data)
                identity_matched, similarity = recognizer.is_match(
                    live_embedding, stored_embedding, threshold=face_threshold
                )

                # Send identity status back to the camera client periodically
                if frame_count % IDENTITY_REPORT_EVERY == 0:
                    try:
                        await websocket.send_json({
                            "type": "identity",
                            "status": "matched" if identity_matched else "unknown",
                            "similarity": round(similarity, 3),
                            "threshold": face_threshold,
                        })
                    except Exception:
                        pass

                if not identity_matched:
                    # Unknown person — skip gesture recognition entirely
                    continue

            # ── ② Gesture Recognition (only for verified patient) ───────
            metrics = detector.extract_metrics(frame_data)
            if metrics and classifier and patient:
                result = classifier.process_frame(metrics)

                if result:
                    gesture_type, need_type, confidence = result

                    db = SessionLocal()
                    try:
                        detection = patient_service.create_detection(
                            db=db,
                            patient_id=patient_uuid,
                            gesture_type=gesture_type,
                            need_type=need_type,
                            confidence=confidence,
                        )

                        # Broadcast alert to nurse dashboard
                        await manager.broadcast_to_ward(
                            patient.ward_id,
                            {
                                "type": "new_request",
                                "patient_id": patient_id,
                                "patient_name": patient.name,
                                "bed_number": patient.bed_number,
                                "need": need_type.value,
                                "confidence": confidence,
                                "face_similarity": round(similarity, 3),
                                "timestamp": detection.created_at.isoformat(),
                                "request_id": str(detection.id),
                            },
                        )

                        await send_nurse_notification(patient.ward_id, detection)
                    except Exception as exc:
                        logger.error(f"Error saving detection: {exc}")
                    finally:
                        db.close()

    except WebSocketDisconnect:
        if patient_id in manager.camera_connections:
            del manager.camera_connections[patient_id]
