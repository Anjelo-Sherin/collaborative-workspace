# API & Protocol Specification — Synapse Collab

## HTTP Endpoints

### 1. Health Check
- **Endpoint:** `GET /health`
- **Response:**
  ```json
  {
    "status": "healthy",
    "rooms": 2,
    "uptime": 128.4
  }
  ```

### 2. Code Execution
- **Endpoint:** `POST /api/run`
- **Content-Type:** `application/json`
- **Request Body:**
  ```json
  {
    "language": "javascript",
    "code": "console.log('Hello World!');"
  }
  ```
- **Supported Languages:** `javascript`, `python`
- **Response (200 OK):**
  ```json
  {
    "stdout": "Hello World!\n",
    "stderr": "",
    "exitCode": 0,
    "executionTimeMs": 42
  }
  ```
- **Error Response (Execution Timeout / 400 Bad Request):**
  ```json
  {
    "stdout": "",
    "stderr": "Error: Execution timed out (limit: 1000ms)",
    "exitCode": -1,
    "timedOut": true
  }
  ```

### 3. Room Snapshot & Replay
- **Endpoint:** `GET /api/rooms/:roomId/history`
- **Response:**
  ```json
  {
    "roomId": "default",
    "updatesCount": 142,
    "createdTimestamp": 1718000000,
    "snapshots": [ ... ]
  }
  ```

---

## WebSocket Protocol

WebSocket connection URL: `ws://localhost:3012/ws?room=<roomId>&username=<username>&color=<hexColor>`

### Message Frames
Binary frames carry Yjs synchronization packets conforming to `@y/protocols/sync`:
- `0x00`: Sync Step 1 (State Vector request)
- `0x01`: Sync Step 2 (Update delta payload)
- `0x02`: Incremental update broadcast

JSON frames carry non-CRDT control messages (e.g., room chat, execution trigger):
```json
{
  "type": "chat",
  "username": "DevUser",
  "color": "#4A90E2",
  "text": "Check out line 14!",
  "timestamp": 1718000100
}
```
