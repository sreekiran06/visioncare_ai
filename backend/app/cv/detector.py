import os
# Optional OpenCV import – if not installed we fall back to mock mode
try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    cv2 = None
    CV2_AVAILABLE = False
import numpy as np
import logging
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

# Try to import dlib, default to mock mode if not available or if import fails
try:
    import dlib
    DLIB_AVAILABLE = True
except ImportError:
    DLIB_AVAILABLE = False
    logger.warning("dlib not installed. GestureDetector will run in Mock Mode.")

from .metrics import calculate_ear, calculate_mar, calculate_head_pose
from ..core.config import settings

class GestureDetector:
    def __init__(self, model_path: str = None):
        self.mock_mode = True
        self.detector = None
        self.predictor = None
        
        if not DLIB_AVAILABLE:
            return
            
        model_path = model_path or settings.DETECTOR_MODEL_PATH
        if os.path.exists(model_path):
            try:
                self.detector = dlib.get_frontal_face_detector()
                self.predictor = dlib.shape_predictor(model_path)
                self.mock_mode = False
                logger.info(f"Loaded dlib shape predictor from {model_path}. Running in Real Mode.")
            except Exception as e:
                logger.error(f"Error loading dlib model from {model_path}: {e}. Falling back to Mock Mode.")
        else:
            logger.warning(f"Landmark model file not found at {model_path}. Running in Mock Mode.")

    def extract_metrics(self, frame_bytes: bytes) -> Optional[Dict[str, Any]]:
        # If in mock mode, return simulated metrics
        if self.mock_mode:
            import random
            # Simulate a face with normal fluctuations
            return {
                "ear": random.uniform(0.24, 0.32),
                "mar": random.uniform(0.15, 0.25),
                "yaw_ratio": random.uniform(0.95, 1.05),
                "roll_angle": random.uniform(-2.0, 2.0)
            }
            
        # Real Mode
        try:
            nparr = np.frombuffer(frame_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return None
                
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            faces = self.detector(gray)
            
            if not faces:
                return None
                
            # Process the first face found
            face = faces[0]
            shape = self.predictor(gray, face)
            
            # Convert to list of (x, y) coordinates
            landmarks = [(shape.part(i).x, shape.part(i).y) for i in range(68)]
            
            # Extract landmarks for eyes and mouth
            # Left eye indices: 36 to 41
            left_eye = landmarks[36:42]
            # Right eye indices: 42 to 47
            right_eye = landmarks[42:48]
            # Mouth outer lip indices: 48 to 59
            mouth = landmarks[48:60]
            
            left_ear = calculate_ear(left_eye)
            right_ear = calculate_ear(right_eye)
            ear = (left_ear + right_ear) / 2.0
            
            mar = calculate_mar(mouth)
            head_pose = calculate_head_pose(landmarks)
            
            return {
                "ear": ear,
                "mar": mar,
                "yaw_ratio": head_pose["yaw_ratio"],
                "roll_angle": head_pose["roll_angle"]
            }
            
        except Exception as e:
            logger.error(f"Error in extract_metrics: {e}")
            return None
