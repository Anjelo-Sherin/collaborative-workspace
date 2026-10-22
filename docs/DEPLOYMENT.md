# Deployment Guide — Synapse Collab

This document outlines deployment strategies for running Synapse Collab in production using Docker, Docker Compose, or Cloud Platforms (Render, Railway, Fly.io, Hugging Face Spaces).

---

## 1. Docker Deployment

### Building the Docker Image
```bash
docker build -t synapse-collab:latest .
```

### Running the Container
```bash
docker run -d \
  --name synapse-workspace \
  -p 8012:8012 \
  -v $(pwd)/data:/app/data \
  --restart unless-stopped \
  synapse-collab:latest
```

---

## 2. Docker Compose (Recommended)

Using the bundled `docker-compose.yml`:
```bash
docker compose up -d --build
```

To inspect logs:
```bash
docker compose logs -f app
```

To stop:
```bash
docker compose down
```

---

## 3. Cloud Platform Deployment (e.g., Render / Fly.io / Railway)

### Environment Variables
Configure the following in your cloud provider's dashboard:

| Variable | Recommended Value | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables production runtime mode |
| `PORT` | `8012` (or provider `$PORT`) | Port binding |
| `STORAGE_DIR` | `/app/data/rooms` | Persistent volume path |

### Persistent Disk
Ensure a persistent volume is mounted to `/app/data` so that room documents, whiteboard sketches, and session replay histories survive container restarts.

### WebSocket Proxy Configuration
If placing behind an Nginx reverse proxy or Cloudflare:
- Ensure `Upgrade` and `Connection: "Upgrade"` headers are preserved.
- Increase proxy read/send timeouts (recommended: `3600s`) to prevent idle connection termination.
