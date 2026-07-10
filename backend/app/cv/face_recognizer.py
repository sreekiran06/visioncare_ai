"""
face_recognizer.py
──────────────────
Provides identity verification via face embeddings (ArcFace / InsightFace).

Pipeline
  frame_bytes ──► face detection ──► ArcFace embedding (512-dim float32)
                                          │
                         cosine_similarity(stored_embedding, live_embedding)
                                          │
                               similarity ≥ threshold?  → matched / unknown

Mock Mode
  Activated automatically when insightface or onnxruntime is not installed.
  In mock mode the extractor returns a deterministic pseudo-embedding seeded
  by the hash of the raw bytes, so calibration and live monitoring always
  "match" – useful for development without the heavy models.
"""

from __future__ import annotations

import hashlib
import logging
import os
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Try to import insightface + onnxruntime (optional heavy dependency)
# ---------------------------------------------------------------------------
try:
    import insightface
    from insightface.app import FaceAnalysis
    _INSIGHTFACE_AVAILABLE = True
except ImportError:
    _INSIGHTFACE_AVAILABLE = False
    logger.warning(
        "insightface is not installed. FaceRecognizer will run in Mock Mode. "
        "Run: pip install insightface onnxruntime"
    )

try:
    import cv2 as _cv2
    _CV2_AVAILABLE = True
except ImportError:
    _CV2_AVAILABLE = False

EMBEDDING_DIM = 512
DEFAULT_SIMILARITY_THRESHOLD = 0.75


class FaceRecognizer:
    """
    Wraps InsightFace ArcFace to provide face embedding extraction and
    cosine-similarity-based identity verification.

    Falls back to a deterministic mock if insightface is not installed.
    """

    def __init__(self, model_name: str = "buffalo_l", threshold: float = DEFAULT_SIMILARITY_THRESHOLD, force_mock: bool = False):
        self.threshold = threshold
        self.model_name = model_name
        self._app = None
        self._initialized = False

        # Real mode requires: insightface + cv2 available AND env var explicitly set to true
        if force_mock:
            self.mock_mode = True
            logger.info("FaceRecognizer: forced Mock Mode.")
        elif not (_INSIGHTFACE_AVAILABLE and _CV2_AVAILABLE):
            self.mock_mode = True
            logger.warning("FaceRecognizer is running in Mock Mode (insightface/cv2 unavailable).")
        else:
            import os
            real_mode = os.environ.get("FACE_RECOGNIZER_REAL_MODE", "false").lower() == "true"
            self.mock_mode = not real_mode
            if self.mock_mode:
                logger.info(
                    "FaceRecognizer: Mock Mode active. "
                    "Set FACE_RECOGNIZER_REAL_MODE=true in .env to enable real ArcFace."
                )
            else:
                logger.info("FaceRecognizer: Real Mode — model will download on first use.")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def _ensure_initialized(self):
        """Lazy-load the InsightFace model on first use (only in real mode)."""
        if self._initialized:
            return
        self._initialized = True
        if not self.mock_mode:
            try:
                logger.info(f"Loading InsightFace model '{self.model_name}' (this may take a moment)...")
                self._app = FaceAnalysis(
                    name=self.model_name,
                    providers=["CPUExecutionProvider"],
                )
                self._app.prepare(ctx_id=0, det_size=(320, 320))
                logger.info(f"InsightFace model '{self.model_name}' loaded successfully.")
            except Exception as exc:
                logger.error(f"Failed to load InsightFace model: {exc}. Falling back to Mock Mode.")
                self.mock_mode = True

    def extract_embedding(self, frame_bytes: bytes) -> Optional[np.ndarray]:
        """
        Extract a 512-dim ArcFace embedding for the most prominent face in
        the frame.

        Returns None if no face is detected.
        """
        self._ensure_initialized()
        if self.mock_mode:
            return self._mock_embedding(frame_bytes)


        try:
            img = self._decode_image(frame_bytes)
            if img is None:
                return None
            faces = self._app.get(img)
            if not faces:
                return None
            # Pick the face with the largest bounding box
            face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
            emb = face.normed_embedding  # already L2-normalised by insightface
            return emb.astype(np.float32)
        except Exception as exc:
            logger.error(f"FaceRecognizer.extract_embedding error: {exc}")
            return None

    def compute_similarity(self, emb_a: np.ndarray, emb_b: np.ndarray) -> float:
        """
        Cosine similarity between two embeddings.
        Both vectors are expected to be L2-normalised (insightface guarantees this).
        Returns a float in [-1, 1]; higher = more similar.
        """
        if emb_a is None or emb_b is None:
            return 0.0
        a = emb_a / (np.linalg.norm(emb_a) + 1e-8)
        b = emb_b / (np.linalg.norm(emb_b) + 1e-8)
        return float(np.dot(a, b))

    def is_match(
        self,
        live_embedding: Optional[np.ndarray],
        stored_embedding: Optional[np.ndarray],
        threshold: Optional[float] = None,
    ) -> tuple[bool, float]:
        """
        Returns (matched: bool, similarity: float).
        If either embedding is None (no face / not calibrated) returns (False, 0.0).
        """
        if live_embedding is None or stored_embedding is None:
            return False, 0.0
        
        if self.mock_mode:
            import time
            # Cycle: 20 seconds of matching patient, 8 seconds of unknown person
            cycle_time = time.time() % 28
            if cycle_time > 20:
                # Simulate unknown person
                return False, 0.38
            else:
                # Simulate matched patient
                return True, 0.88

        sim = self.compute_similarity(live_embedding, stored_embedding)
        t = threshold if threshold is not None else self.threshold
        return sim >= t, sim

    def average_embeddings(self, embeddings: list[np.ndarray]) -> Optional[np.ndarray]:
        """Average multiple embeddings and re-normalise (used after face capture)."""
        valid = [e for e in embeddings if e is not None]
        if not valid:
            return None
        avg = np.mean(np.stack(valid, axis=0), axis=0)
        norm = np.linalg.norm(avg)
        return (avg / norm).astype(np.float32) if norm > 1e-8 else avg.astype(np.float32)

    # ------------------------------------------------------------------
    # Serialisation helpers (store embedding in JSON as plain Python list)
    # ------------------------------------------------------------------

    @staticmethod
    def embedding_to_list(emb: np.ndarray) -> list[float]:
        return emb.tolist()

    @staticmethod
    def embedding_from_list(data: list[float]) -> np.ndarray:
        return np.array(data, dtype=np.float32)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _decode_image(self, frame_bytes: bytes):
        """Decode JPEG/PNG bytes to BGR numpy array (requires cv2)."""
        if not _CV2_AVAILABLE:
            return None
        import cv2
        nparr = np.frombuffer(frame_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        return img  # None if decode failed

    def _mock_embedding(self, frame_bytes: bytes) -> np.ndarray:
        """
        Deterministic pseudo-embedding derived from the FIRST 64 bytes of the
        frame. Using the first bytes (not the whole frame) keeps it fast.
        Different frames of the same camera session will produce similar but
        not identical embeddings — close enough to always exceed threshold.
        """
        seed_data = frame_bytes[:64] if len(frame_bytes) >= 64 else frame_bytes
        digest = hashlib.sha256(seed_data).digest()  # 32 bytes
        # Expand to 512 floats by tiling and adding tiny noise
        rng = np.random.default_rng(seed=int.from_bytes(digest[:8], "big"))
        base = np.frombuffer(digest * (EMBEDDING_DIM // 32 + 1), dtype=np.uint8)[
            :EMBEDDING_DIM
        ].astype(np.float32)
        noise = rng.normal(0, 0.05, EMBEDDING_DIM).astype(np.float32)
        emb = base + noise
        norm = np.linalg.norm(emb)
        return (emb / norm).astype(np.float32) if norm > 1e-8 else emb

    def _mock_embedding_stable(self, seed_int: int) -> np.ndarray:
        """
        A fully stable mock embedding seeded by an integer (e.g. patient UUID hash).
        Used during calibration so the stored embedding and live embeddings match.
        """
        rng = np.random.default_rng(seed=seed_int)
        emb = rng.standard_normal(EMBEDDING_DIM).astype(np.float32)
        norm = np.linalg.norm(emb)
        return (emb / norm).astype(np.float32)
