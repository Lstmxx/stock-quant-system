import { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '../constant/config';

export function useSSELogStream() {
  const [streamLogs, setStreamLogs] = useState<string[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const connect = useCallback((path: string) => {
    disconnect();
    setStreamLogs([]);
    
    const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
    const es = new EventSource(url, { withCredentials: true });
    
    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        // Filter out heartbeat/connection events
        if (parsed.type !== 'ping' && parsed.type !== 'connected') {
          setStreamLogs(prev => [...prev, parsed.message ?? JSON.stringify(parsed)]);
        }
      } catch {
        setStreamLogs(prev => [...prev, event.data]);
      }
    };
    
    es.onerror = (error) => {
      console.error('SSE Connection Error:', error);
      disconnect();
    };

    eventSourceRef.current = es;
  }, [disconnect]);

  // Automatically clean up when the component is unmounted
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    streamLogs,
    connect,
    disconnect
  };
}
