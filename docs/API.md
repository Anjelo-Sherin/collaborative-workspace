# API Reference — Synapse Collab

## 1. REST Endpoints

### Health Check
Retrieves system operational status, active room counts, and server uptime.

- **URL**: `/api/health`
- **Method**: `GET`
- **Response**: `200 OK`

```json
{
  "status": "ok",
  "uptimeSeconds": 1420,
  "activeRooms": 3,
  "timestamp": "2026-10-22T20:00:00.000Z"
}
```

---

### List Rooms
Returns all active in-memory and persisted storage rooms with client presence counts and metadata.

- **URL**: `/api/rooms`
- **Method**: `GET`
- **Response**: `200 OK`

```json
{
  "rooms": [
    {
      "roomId": "demo-workspace",
      "connectedClients": 2,
      "codeLength": 542,
      "whiteboardElements": 10,
      "chatMessages": 4,
      "createdAt": "2026-10-22T18:50:00.000Z",
      "lastActive": "2026-10-22T20:05:00.000Z",
      "updatedAt": "2026-10-22T20:05:01.000Z"
    }
  ]
}
```

---

### Fetch Room Session Replay History
Retrieves recorded historical snapshots and checkpoints for a specific room.

- **URL**: `/api/room/:id/replay`
- **Method**: `GET`
- **Parameters**: `id` (string) — The unique room identifier.
- **Response**: `200 OK`

```json
{
  "roomId": "demo-workspace",
  "snapshots": [
    {
      "id": 1,
      "timestamp": 1792695600000,
      "author": "Grace Hopper",
      "action": "add_whiteboard_diagram",
      "codeSnippet": "// Welcome to Synapse Collab...",
      "codeLength": 542,
      "strokeCount": 8,
      "updateBase64": "AQX..."
    }
  ]
}
```

---

### Execute Sandboxed Code
Submits code to be compiled or interpreted inside an isolated process with strict time and memory bounds.

- **URL**: `/api/run`
- **Method**: `POST`
- **Content-Type**: `application/json`

#### Request Body
```json
{
  "language": "javascript",
  "code": "console.log('Result:', [1, 2, 3].map(x => x * 2));",
  "stdin": "",
  "timeoutMs": 4000
}
```

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `language` | string | Yes | Target language (`javascript`, `python`, `typescript`) |
| `code` | string | Yes | Source code string to execute |
| `stdin` | string | No | Optional standard input buffer to stream into process |
| `timeoutMs` | number | No | Execution timeout budget (default `4000`, min `500`, max `10000`) |

#### Response `200 OK` (Execution Success)
```json
{
  "success": true,
  "exitCode": 0,
  "stdout": "Result: [ 2, 4, 6 ]\n",
  "stderr": "",
  "durationMs": 38,
  "timedOut": false,
  "language": "javascript"
}
```

#### Response `200 OK` (Timeout Termination)
```json
{
  "success": false,
  "exitCode": null,
  "stdout": "",
  "stderr": "[Execution Timed Out]: Process exceeded 4000ms time limit and was terminated.",
  "durationMs": 4002,
  "timedOut": true,
  "language": "javascript"
}
```

---

## 2. WebSocket Synchronization Protocol

- **Endpoint**: `/ws`
- **Query Parameters**:
  - `room` (string, default: `default`): Target room channel name.
  - `user` (string, default: `Anonymous`): Initial collaborator display name.
  - `color` (string, default: `#3b82f6`): Hex color assigned to the user for cursors and pointer markers.

### Message Framing
Binary frames use the standard Yjs synchronization message format:
- `Byte 0 = 0`: **Sync Message** (`SyncStep1`, `SyncStep2`, `Update`).
- `Byte 0 = 1`: **Awareness Message** (User presence, cursor positions, canvas pointer coordinates).
- `Byte 0 = 2`: **Authentication / Custom Handshake**.

JSON text frames are accepted for client registration and real-time room chat:
```json
{
  "type": "chat_message",
  "user": "Alan Turing",
  "color": "#3b82f6",
  "text": "Concurrent edits merged flawlessly with zero merge conflicts!"
}
```
