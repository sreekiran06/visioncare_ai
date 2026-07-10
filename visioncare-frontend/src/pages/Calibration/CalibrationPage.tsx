import React, { useCallback, useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import { useNavigate, useParams } from "react-router-dom";
import { calibrationApi } from "../../services/api";
import { CalibrationSession, GestureType } from "../../types";

const SAMPLES_REQUIRED = 10;
const COUNTDOWN_SECONDS = 3;
const CAPTURE_FRAMES = 30;
const FRAME_INTERVAL_MS = 33; // ~30fps

// Face capture constants
const FACE_FRAMES_REQUIRED = 25;
const FACE_FRAME_INTERVAL_MS = 80; // ~12fps – enough for a good embedding average

type CaptureStatus = "idle" | "countdown" | "capturing" | "processing" | "done";
type CalibStep = "face" | "gestures";

// ─────────────────────────────────────────────────────────────────────────────
// Step 0 — Face Capture
// ─────────────────────────────────────────────────────────────────────────────
interface FaceCaptureStepProps {
  patientId: string;
  patientName: string;
  onComplete: () => void;
}

const FaceCaptureStep: React.FC<FaceCaptureStepProps> = ({
  patientId,
  patientName,
  onComplete,
}) => {
  const webcamRef = useRef<Webcam>(null);
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [progress, setProgress] = useState(0); // 0–FACE_FRAMES_REQUIRED
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    faces_detected: number;
    frames_processed: number;
  } | null>(null);

  const captureAndSend = useCallback(async () => {
    if (!webcamRef.current) return;
    setStatus("capturing");
    setProgress(0);
    setError(null);

    const frames: string[] = [];
    for (let i = 0; i < FACE_FRAMES_REQUIRED; i++) {
      const frame = webcamRef.current.getScreenshot();
      if (frame) frames.push(frame);
      setProgress(i + 1);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((res) => setTimeout(res, FACE_FRAME_INTERVAL_MS));
    }

    setStatus("processing");
    try {
      const response = await calibrationApi.captureFace(patientId, frames, 0.75);
      setResult(response.data);
      setStatus("done");
    } catch (err: any) {
      const detail =
        err?.response?.data?.detail ??
        "Face capture failed. Ensure the patient is well-lit and facing the camera.";
      setError(detail);
      setStatus("idle");
    }
  }, [patientId]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 p-6 flex flex-col items-center justify-center">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/20 border border-indigo-400/30 mb-4">
            <span className="h-2 w-2 rounded-full bg-indigo-400 animate-pulse" />
            <span className="text-indigo-300 text-sm font-medium">Step 1 of 2 — Face Registration</span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">
            Register Face for <span className="text-indigo-400">{patientName}</span>
          </h1>
          <p className="text-slate-400 text-sm max-w-md mx-auto">
            The system will capture {FACE_FRAMES_REQUIRED} frames to create a unique face profile.
            Only this patient's face will trigger gesture alerts.
          </p>
        </div>

        {/* Camera */}
        <div className="relative rounded-2xl overflow-hidden bg-black aspect-video mb-6 ring-2 ring-indigo-500/30">
          <Webcam
            ref={webcamRef}
            audio={false}
            screenshotFormat="image/jpeg"
            screenshotQuality={0.85}
            className="w-full h-full object-cover"
            mirrored
          />

          {/* Overlay guide */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className={`w-48 h-60 rounded-full border-4 transition-colors duration-300 ${
              status === "capturing"
                ? "border-emerald-400 shadow-lg shadow-emerald-400/30"
                : status === "done"
                ? "border-indigo-400 shadow-lg shadow-indigo-400/30"
                : "border-white/30"
            }`} />
          </div>

          {/* Progress bar during capture */}
          {(status === "capturing" || status === "processing") && (
            <div className="absolute bottom-0 inset-x-0">
              <div className="h-1.5 bg-slate-800/70">
                <div
                  className="h-full bg-emerald-400 transition-all duration-100"
                  style={{ width: `${(progress / FACE_FRAMES_REQUIRED) * 100}%` }}
                />
              </div>
              <div className="bg-black/60 text-center py-2 text-sm text-white">
                {status === "processing"
                  ? "Processing face profile…"
                  : `Capturing frame ${progress} / ${FACE_FRAMES_REQUIRED}`}
              </div>
            </div>
          )}

          {/* Success overlay */}
          {status === "done" && result && (
            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center">
              <div className="text-5xl mb-3">✅</div>
              <p className="text-white font-semibold text-lg">Face Registered!</p>
              <p className="text-slate-300 text-sm mt-1">
                {result.faces_detected} / {result.frames_processed} frames had a detectable face
              </p>
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="bg-slate-800/50 rounded-xl p-4 mb-6 text-sm text-slate-300 space-y-1 border border-slate-700/50">
          <p className="font-medium text-white mb-2">📋 Instructions</p>
          <p>• Position the patient's face inside the oval guide</p>
          <p>• Ensure even lighting — avoid harsh shadows or backlighting</p>
          <p>• Patient should look directly at the camera with a neutral expression</p>
          <p>• Hold still for ~2 seconds during capture</p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-400/30 rounded-lg text-red-300 text-sm">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-2 underline text-red-400"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3">
          {status !== "done" ? (
            <button
              onClick={captureAndSend}
              disabled={status !== "idle"}
              className="flex-1 py-3 px-6 rounded-xl font-semibold text-white
                         bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                         disabled:cursor-not-allowed transition-all"
            >
              {status === "idle" && "📸 Capture Face"}
              {status === "capturing" && `Capturing… ${progress}/${FACE_FRAMES_REQUIRED}`}
              {status === "processing" && "⏳ Processing…"}
            </button>
          ) : (
            <button
              onClick={onComplete}
              className="flex-1 py-3 px-6 rounded-xl font-semibold text-white
                         bg-emerald-600 hover:bg-emerald-500 transition-all"
            >
              Continue to Gesture Calibration →
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Gesture Calibration (unchanged logic, new design polish)
// ─────────────────────────────────────────────────────────────────────────────

export const CalibrationPage: React.FC = () => {
  const { patientId } = useParams<{ patientId: string }>();
  const navigate = useNavigate();
  const webcamRef = useRef<Webcam>(null);

  const [step, setStep] = useState<CalibStep>("face");
  const [session, setSession] = useState<CalibrationSession | null>(null);
  const [currentGestureIndex, setCurrentGestureIndex] = useState(0);
  const [sampleCount, setSampleCount] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // Load gesture session when entering gesture step
  useEffect(() => {
    if (step !== "gestures" || !patientId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await calibrationApi.start(patientId);
        if (!cancelled) setSession(response.data);
      } catch {
        if (!cancelled) setError("Failed to start the gesture calibration session.");
      }
    })();
    return () => { cancelled = true; };
  }, [step, patientId]);

  const currentGesture = session?.gesturesToCalibrate[currentGestureIndex] as GestureType | undefined;
  const instructions = currentGesture ? session?.instructions[currentGesture] : undefined;

  const captureFrames = useCallback(async () => {
    if (!webcamRef.current || !currentGesture || !patientId) return;
    setStatus("capturing");
    const frames: string[] = [];
    for (let i = 0; i < CAPTURE_FRAMES; i++) {
      const frame = webcamRef.current.getScreenshot();
      if (frame) frames.push(frame);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, FRAME_INTERVAL_MS));
    }
    setStatus("processing");
    try {
      await calibrationApi.saveSample(patientId, {
        gesture_type: currentGesture,
        frames,
        sample_index: sampleCount,
      });
      const nextSampleCount = sampleCount + 1;
      setSampleCount(nextSampleCount);
      if (nextSampleCount >= SAMPLES_REQUIRED) {
        const nextGestureIndex = currentGestureIndex + 1;
        if (nextGestureIndex < (session?.gesturesToCalibrate.length ?? 0)) {
          setCurrentGestureIndex(nextGestureIndex);
          setSampleCount(0);
        } else {
          await calibrationApi.complete(patientId);
          navigate(`/patients/${patientId}/setup-mappings`);
          return;
        }
      }
    } catch {
      setError("Failed to save that sample. Please try again.");
    }
    setStatus("idle");
  }, [currentGesture, currentGestureIndex, patientId, sampleCount, session, navigate]);

  const startCapture = () => {
    setStatus("countdown");
    setCountdown(COUNTDOWN_SECONDS);
  };

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) { captureFrames(); setCountdown(null); return; }
    const timer = setTimeout(() => setCountdown((c) => (c ?? 1) - 1), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  const skipGesture = () => {
    const nextGestureIndex = currentGestureIndex + 1;
    if (nextGestureIndex < (session?.gesturesToCalibrate.length ?? 0)) {
      setCurrentGestureIndex(nextGestureIndex);
      setSampleCount(0);
    }
  };

  // ── Render: Step 0 — Face Capture ──────────────────────────────────
  if (step === "face") {
    return (
      <FaceCaptureStep
        patientId={patientId!}
        patientName="Patient"
        onComplete={() => setStep("gestures")}
      />
    );
  }

  // ── Render: loading gesture session ────────────────────────────────
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-indigo-400 border-t-transparent" />
      </div>
    );
  }

  const progressPct = (sampleCount / SAMPLES_REQUIRED) * 100;

  // ── Render: Step 1 — Gesture Calibration ───────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-400/30 mb-4">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-emerald-300 text-sm font-medium">Step 2 of 2 — Gesture Calibration</span>
          </div>
          <h1 className="text-2xl font-bold text-white">
            Calibrating: <span className="text-indigo-400">{session.patientName}</span>
          </h1>
          <p className="text-slate-400 mt-1">
            Gesture {currentGestureIndex + 1} of {session.gesturesToCalibrate.length}
          </p>
        </div>

        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex justify-between text-sm text-slate-400 mb-2">
            <span>{instructions?.title}</span>
            <span>{sampleCount} / {SAMPLES_REQUIRED} samples</span>
          </div>
          <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Webcam */}
          <div className="relative">
            <div className="aspect-video bg-slate-950 rounded-2xl overflow-hidden ring-2 ring-slate-700/50 relative">
              <Webcam
                ref={webcamRef}
                audio={false}
                screenshotFormat="image/jpeg"
                className="w-full h-full object-cover"
                mirrored
              />
              {status === "countdown" && countdown !== null && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <span className="text-8xl font-bold text-white animate-pulse">{countdown}</span>
                </div>
              )}
              {status === "capturing" && (
                <div className="absolute inset-0 border-4 border-red-500">
                  <div className="absolute top-4 right-4 flex items-center gap-2">
                    <span className="h-3 w-3 bg-red-500 rounded-full animate-pulse" />
                    <span className="text-white font-medium text-sm">Recording</span>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 flex gap-3">
              <button
                onClick={startCapture}
                disabled={status !== "idle"}
                className="flex-1 py-3 px-6 bg-indigo-600 hover:bg-indigo-500 text-white
                           rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed
                           transition-all"
              >
                {status === "idle" && "📸 Capture Sample"}
                {status === "countdown" && `Starting in ${countdown}…`}
                {status === "capturing" && "Capturing…"}
                {status === "processing" && "Processing…"}
              </button>
              <button
                onClick={skipGesture}
                className="py-3 px-5 bg-slate-700 hover:bg-slate-600 text-slate-300
                           rounded-xl font-medium transition-all"
              >
                Skip
              </button>
            </div>
          </div>

          {/* Instructions */}
          <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 p-6">
            <h2 className="text-xl font-bold text-white mb-3">{instructions?.title}</h2>
            <p className="text-slate-300 mb-6 leading-relaxed">{instructions?.instruction}</p>
            <div className="bg-indigo-500/10 rounded-xl p-4 border border-indigo-500/20">
              <h3 className="font-semibold text-indigo-300 mb-2">💡 Tips</h3>
              <ul className="text-sm text-slate-400 space-y-1">
                <li>• Keep the face well-lit and clearly visible</li>
                <li>• Perform the gesture naturally</li>
                <li>• Hold the gesture until recording completes</li>
                <li>• Slight variation between samples improves accuracy</li>
              </ul>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-6 p-4 bg-red-500/10 border border-red-400/30 rounded-xl">
            <p className="text-red-300 text-sm">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400 underline text-sm mt-2">
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CalibrationPage;
