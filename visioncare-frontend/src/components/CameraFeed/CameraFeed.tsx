import React, { useCallback, useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import { ConnectionStatus } from "../../types";

interface CameraFeedProps {
  patientId: string;
  wsUrl?: string;
  frameIntervalMs?: number;
  onStatusChange?: (status: ConnectionStatus) => void;
}

const DEFAULT_WS_URL = process.env.REACT_APP_WS_URL ?? "ws://localhost:8000";

/**
 * Streams JPEG frames from the bedside camera to the backend gesture
 * pipeline over WebSocket. Runs on the patient-facing device, not the
 * nurse dashboard.
 */
export const CameraFeed: React.FC<CameraFeedProps> = ({
  patientId,
  wsUrl = DEFAULT_WS_URL,
  frameIntervalMs = 200,
  onStatusChange,
}) => {
  const webcamRef = useRef<Webcam>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  const updateStatus = useCallback(
    (next: ConnectionStatus) => {
      setStatus(next);
      onStatusChange?.(next);
    },
    [onStatusChange]
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

    socket.onclose = () => updateStatus("disconnected");
    socket.onerror = () => socket.close();

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      socket.close();
    };
  }, [patientId, wsUrl, frameIntervalMs, updateStatus]);

  return (
    <div className="relative aspect-video bg-ink-950 rounded-xl overflow-hidden">
      <Webcam
        ref={webcamRef}
        audio={false}
        screenshotFormat="image/jpeg"
        screenshotQuality={0.7}
        className="w-full h-full object-cover"
        mirrored
      />
      <div className="absolute top-3 right-3 flex items-center gap-2 bg-black/40 rounded-full px-3 py-1">
        <span
          className={`h-2 w-2 rounded-full ${
            status === "connected"
              ? "bg-emerald-400"
              : status === "connecting"
              ? "bg-signal-amber animate-pulse"
              : "bg-signal-coral"
          }`}
        />
        <span className="text-white text-xs capitalize">{status}</span>
      </div>
    </div>
  );
};

export default CameraFeed;
