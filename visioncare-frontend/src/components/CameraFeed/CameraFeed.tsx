import React, { useCallback, useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import { ConnectionStatus } from "../../types";

interface IdentityStatus {
  status: "matched" | "unknown" | "uncalibrated";
  similarity: number;
  threshold: number;
}

interface CameraFeedProps {
  patientId: string;
  wsUrl?: string;
  frameIntervalMs?: number;
  onStatusChange?: (status: ConnectionStatus) => void;
  onIdentityChange?: (identity: IdentityStatus) => void;
}

const DEFAULT_WS_URL = process.env.REACT_APP_WS_URL ?? "ws://localhost:8000";

/**
 * Streams JPEG frames from the bedside camera to the backend gesture
 * pipeline over WebSocket. Shows identity verification overlay.
 * 
 * Pipeline on each frame:
 *   Frontend → (base64 JPEG) → Backend
 *   Backend  → Face Recognition → Identity Gate → Gesture Detection
 *   Backend  → (identity JSON)  → Frontend overlay
 */
export const CameraFeed: React.FC<CameraFeedProps> = ({
  patientId,
  wsUrl = DEFAULT_WS_URL,
  frameIntervalMs = 200,
  onStatusChange,
  onIdentityChange,
}) => {
  const webcamRef = useRef<Webcam>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [identity, setIdentity] = useState<IdentityStatus>({
    status: "uncalibrated",
    similarity: 0,
    threshold: 0.75,
  });
  // How long to keep showing the last identity status (ms)
  const identityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateStatus = useCallback(
    (next: ConnectionStatus) => {
      setStatus(next);
      onStatusChange?.(next);
    },
    [onStatusChange]
  );

  const updateIdentity = useCallback(
    (next: IdentityStatus) => {
      setIdentity(next);
      onIdentityChange?.(next);
      // Auto-reset to uncalibrated after 3 s of no messages
      if (identityTimeoutRef.current) clearTimeout(identityTimeoutRef.current);
      identityTimeoutRef.current = setTimeout(() => {
        setIdentity((prev) => ({ ...prev, status: "uncalibrated" }));
      }, 3000);
    },
    [onIdentityChange]
  );

  useEffect(() => {
    const socket = new WebSocket(`${wsUrl}/ws/camera/${patientId}`);
    socketRef.current = socket;

    socket.onopen = () => {
      updateStatus("connected");
      intervalRef.current = setInterval(() => {
        const frame = webcamRef.current?.getScreenshot();
        if (frame && socket.readyState === WebSocket.OPEN) {
          socket.send(frame);
        }
      }, frameIntervalMs);
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "identity") {
          updateIdentity({
            status: msg.status as "matched" | "unknown",
            similarity: msg.similarity ?? 0,
            threshold: msg.threshold ?? 0.75,
          });
        }
      } catch {
        // Binary or non-JSON message — ignore
      }
    };

    socket.onclose = () => updateStatus("disconnected");
    socket.onerror = () => socket.close();

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (identityTimeoutRef.current) clearTimeout(identityTimeoutRef.current);
      socket.close();
    };
  }, [patientId, wsUrl, frameIntervalMs, updateStatus, updateIdentity]);

  // ── Identity badge config ──────────────────────────────────────────
  const identityConfig = {
    matched: {
      dot: "bg-emerald-400",
      text: "text-emerald-300",
      border: "border-emerald-400/40",
      bg: "bg-emerald-900/60",
      label: "Identity Verified",
      icon: "✅",
    },
    unknown: {
      dot: "bg-red-400 animate-ping",
      text: "text-red-300",
      border: "border-red-400/40",
      bg: "bg-red-900/60",
      label: "Unknown Person",
      icon: "🚫",
    },
    uncalibrated: {
      dot: "bg-slate-400",
      text: "text-slate-300",
      border: "border-slate-500/40",
      bg: "bg-slate-900/60",
      label: "Face ID Inactive",
      icon: "👤",
    },
  };

  const cfg = identityConfig[identity.status];

  return (
    <div className="relative aspect-video bg-slate-950 rounded-xl overflow-hidden">
      <Webcam
        ref={webcamRef}
        audio={false}
        screenshotFormat="image/jpeg"
        screenshotQuality={0.7}
        className="w-full h-full object-cover"
        mirrored
      />

      {/* ── Connection status — top right ── */}
      <div className="absolute top-3 right-3 flex items-center gap-2 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5 border border-white/10">
        <span
          className={`h-2 w-2 rounded-full ${
            status === "connected"
              ? "bg-emerald-400"
              : status === "connecting"
              ? "bg-amber-400 animate-pulse"
              : "bg-red-400"
          }`}
        />
        <span className="text-white text-xs font-medium capitalize">{status}</span>
      </div>

      {/* ── Identity status — bottom left ── */}
      <div
        className={`absolute bottom-3 left-3 flex items-center gap-2 backdrop-blur-sm
                    rounded-xl px-3 py-2 border transition-all duration-500
                    ${cfg.bg} ${cfg.border}`}
      >
        <span className="text-base leading-none">{cfg.icon}</span>
        <div>
          <p className={`text-xs font-semibold ${cfg.text}`}>{cfg.label}</p>
          {identity.status !== "uncalibrated" && (
            <p className="text-slate-400 text-[10px] mt-0.5">
              Similarity: {(identity.similarity * 100).toFixed(0)}%
              {" · "}
              Threshold: {(identity.threshold * 100).toFixed(0)}%
            </p>
          )}
        </div>
      </div>

      {/* ── "Unknown Person" full-frame red pulse overlay ── */}
      {identity.status === "unknown" && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 border-4 border-red-500 rounded-xl animate-pulse" />
          <div className="absolute inset-0 bg-red-900/10" />
        </div>
      )}
    </div>
  );
};

export default CameraFeed;
