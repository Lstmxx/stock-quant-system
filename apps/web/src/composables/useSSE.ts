import { ref, onUnmounted } from 'vue'
import { API_BASE_URL } from '../constant/config'

export function useSSELogStream() {
  const streamLogs = ref<string[]>([])
  let eventSource: EventSource | null = null

  function connect(path: string) {
    disconnect()
    streamLogs.value = []
    
    eventSource = new EventSource(`${API_BASE_URL}${path}`)
    
    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data)
        // Filter out heartbeat/connection events
        if (parsed.type !== 'ping' && parsed.type !== 'connected') {
          streamLogs.value.push(parsed.message ?? JSON.stringify(parsed))
        }
      } catch {
        streamLogs.value.push(event.data)
      }
    }
    
    eventSource.onerror = (error) => {
      console.error('SSE Connection Error:', error)
      disconnect()
    }
  }

  function disconnect() {
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
  }

  // Automatically clean up when the component is unmounted
  onUnmounted(() => {
    disconnect()
  })

  return {
    streamLogs,
    connect,
    disconnect
  }
}
