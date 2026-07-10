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

    # -- Mock scenario cycling --
    _mock_scenario_index: int = 0
    _mock_frame_in_scenario: int = 0
    # Each scenario: (name, num_frames, metrics_fn)
    _MOCK_SCENARIOS = [
        # 1. Normal resting face  (40 frames – no gesture fires)
        ("resting", 40, lambda: {
            "ear": __import__("random").uniform(0.26, 0.32),
            "mar": __import__("random").uniform(0.15, 0.22),
            "yaw_ratio": __import__("random").uniform(0.97, 1.03),
            "roll_angle": __import__("random").uniform(-1.5, 1.5),
        }),
        # 2. Sustained eyes-closed for 20 frames (triggers sustained_close)
        ("sustained_close", 20, lambda: {
            "ear": __import__("random").uniform(0.10, 0.17),
            "mar": __import__("random").uniform(0.15, 0.22),
            "yaw_ratio": __import__("random").uniform(0.97, 1.03),
            "roll_angle": __import__("random").uniform(-1.0, 1.0),
        }),
        # 3. Rest again
        ("resting2", 30, lambda: {
            "ear": __import__("random").uniform(0.26, 0.32),
            "mar": __import__("random").uniform(0.15, 0.22),
            "yaw_ratio": __import__("random").uniform(0.97, 1.03),
            "roll_angle": __import__("random").uniform(-1.5, 1.5),
        }),
        # 4. Wide mouth open for 20 frames (triggers mouth_open / yawn)
        ("mouth_open", 20, lambda: {
            "ear": __import__("random").uniform(0.26, 0.32),
            "mar": __import__("random").uniform(0.65, 0.80),
            "yaw_ratio": __import__("random").uniform(0.97, 1.03),
            "roll_angle": __import__("random").uniform(-1.0, 1.0),
        }),
        # 5. Rest
        ("resting3", 30, lambda: {
            "ear": __import__("random").uniform(0.26, 0.32),
            "mar": __import__("random").uniform(0.15, 0.22),
            "yaw_ratio": __import__("random").uniform(0.97, 1.03),
            "roll_angle": __import__("random").uniform(-1.5, 1.5),
        }),
        # 6. Head turned left for 20 frames (triggers head_left)
        ("head_left", 20, lambda: {
            "ear": __import__("random").uniform(0.26, 0.32),
            "mar": __import__("random").uniform(0.15, 0.22),
            "yaw_ratio": __import__("random").uniform(1.35, 1.50),
            "roll_angle": __import__("random").uniform(-2.0, 2.0),
        }),
        # 7. Rest
        ("resting4", 30, lambda: {
            "ear": __import__("random").uniform(0.26, 0.32),
            "mar": __import__("random").uniform(0.15, 0.22),
            "yaw_ratio": __import__("random").uniform(0.97, 1.03),
            "roll_angle": __import__("random").uniform(-1.5, 1.5),
        }),
        # 8. Head turned right for 20 frames (triggers head_right)
        ("head_right", 20, lambda: {
            "ear": __import__("random").uniform(0.26, 0.32),
            "mar": __import__("random").uniform(0.15, 0.22),
            "yaw_ratio": __import__("random").uniform(0.55, 0.65),
            "roll_angle": __import__("random").uniform(-2.0, 2.0),
        }),
        # 9. Double blink – two quick closes separated by a brief open
        ("double_blink_close1", 4, lambda: {
            "ear": __import__("random").uniform(0.10, 0.16),
            "mar": __import__("random").uniform(0.15, 0.22),
            "yaw_ratio": __import__("random").uniform(0.97, 1.03),
            "roll_angle": 0.0,
        }),
        ("double_blink_open1", 3, lambda: {
            "ear": __import__("random").uniform(0.26, 0.32),
            "mar": __import__("random").uniform(0.15, 0.22),
            "yaw_ratio": __import__("random").uniform(0.97, 1.03),
            "roll_angle": 0.0,
        }),
        ("double_blink_close2", 4, lambda: {
            "ear": __import__("random").uniform(0.10, 0.16),
            "mar": __import__("random").uniform(0.15, 0.22),
            "yaw_ratio": __import__("random").uniform(0.97, 1.03),
            "roll_angle": 0.0,
        }),
        ("double_blink_open2", 20, lambda: {
            "ear": __import__("random").uniform(0.26, 0.32),
            "mar": __import__("random").uniform(0.15, 0.22),
            "yaw_ratio": __import__("random").uniform(0.97, 1.03),
            "roll_angle": 0.0,
        }),
    ]

    def extract_metrics(self, frame_bytes: bytes) -> Optional[Dict[str, Any]]:
        # If in mock mode, return simulated metrics
        if self.mock_mode:
            # Advance the scenario pointer
            scenarios = self.__class__._MOCK_SCENARIOS
            idx = self.__class__._mock_scenario_index % len(scenarios)
            name, num_frames, metrics_fn = scenarios[idx]

            metrics = metrics_fn()

            self.__class__._mock_frame_in_scenario += 1
            if self.__class__._mock_frame_in_scenario >= num_frames:
                self.__class__._mock_frame_in_scenario = 0
                self.__class__._mock_scenario_index = (idx + 1) % len(scenarios)

            return metrics


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
