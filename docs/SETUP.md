# Setup & Installation Guide — Synapse Collab

This document provides complete instructions for setting up, installing, running, and verifying Synapse Collab on macOS, Linux, and Windows.

---

## 1. Prerequisites

- **Node.js**: v18.0.0 or higher (v20+ or v24 recommended)
- **npm**: v9.0.0 or higher
- **Python 3**: Python 3.8+ (optional, required if executing Python code inside the sandbox)
- **Modern Web Browser**: Google Chrome, Mozilla Firefox, Microsoft Edge, or Safari with WebSockets enabled

Verify installed toolchains:
```bash
node -v
npm -v
python3 --version
```

---

## 2. Installation Steps

### Step 1: Clone Repository
```bash
git clone https://github.com/Anjelo-Sherin/day-12-collaborative-workspace.git
cd day-12-collaborative-workspace
```

### Step 2: Install Node Dependencies
```bash
npm install
```

### Step 3: Configure Environment
Copy the example environment configuration:
```bash
cp .env.example .env
```
*(Default settings configure the service to run on port `8012` with local storage persistence in `data/rooms/`)*

### Step 4: Build Frontend Assets
Compile and bundle the client application with esbuild:
```bash
npm run build
```

---

## 3. Starting the Application

### Local Development Mode (Auto-Reloading)
```bash
npm run dev
```

### Production Server Mode
```bash
npm start
```

Access the application in your browser:
```
http://localhost:8012
```

To join a specific room or share with a collaborator:
```
http://localhost:8012/?room=team-sync
```

---

## 4. Running the Automated Test Suite

Run the full end-to-end test suite containing 17 unit and integration tests across CRDT convergence, persistence, sandboxed execution, and room manager logic:

```bash
npm test
```
*(Tests complete in under 2 seconds with 0 external network dependencies).*
