import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectionStatus } from "../types";

interface UseWebSocketReturn {
  sendMessage: (data: string) => void;
  lastMessage: MessageEvent | null;
  connectionStatus: ConnectionStatus;
}

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 15000;

/**
 * Wraps a native WebSocket with auto-reconnect (exponential backoff)
 * and exposes the last received message plus connection status.
 */
export function useWebSocket(url: string): UseWebSocketReturn {
  const [lastMessage, setLastMessage] = useState<MessageEvent | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnect = useRef(true);

  const connect = useCallback(() => {
    setConnectionStatus("connecting");
    const socket = new WebSocket(url);
    wsRef.current = socket;

    socket.onopen = () => {
      reconnectAttempts.current = 0;
      setConnectionStatus("connected");
    };

    socket.onmessage = (event: MessageEvent) => {
      setLastMessage(event);
    };

    socket.onclose = () => {
      setConnectionStatus("disconnected");
      if (shouldReconnect.current) {
        const delay = Math.min(
          RECONNECT_DELAY_MS * 2 ** reconnectAttempts.current,
          MAX_RECONNECT_DELAY_MS
        );
        reconnectAttempts.current += 1;
        reconnectTimer.current = setTimeout(connect, delay);
      }
    };

    socket.onerror = () => {
      socket.close();
    };
  }, [url]);

  useEffect(() => {
    shouldReconnect.current = true;
    connect();

    return () => {
      shouldReconnect.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const sendMessage = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  return { sendMessage, lastMessage, connectionStatus };
}
