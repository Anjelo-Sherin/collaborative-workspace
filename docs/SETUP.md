# Setup & Local Development Guide — Synapse Collab

## Prerequisites

- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher
- **Python**: 3.8+ (optional, required only for Python sandboxed code execution)

---

## Installation

1. **Navigate to the project root:**
   ```bash
   cd day-12-collaborative-workspace
   ```

2. **Install project dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   ```bash
   cp .env.example .env
   ```
   Default settings in `.env.example`:
   ```env
   PORT=3012
   NODE_ENV=development
   SANDBOX_TIMEOUT_MS=1000
   DATA_DIR=./data
   ```

---

## Build & Run

1. **Build client bundle using esbuild:**
   ```bash
   npm run build
   ```
   This bundles `client/app.js` and dependencies into `public/bundle.js`.

2. **Start the application:**
   ```bash
   npm start
   ```

3. **Open in browser:**
   Open [http://localhost:3012](http://localhost:3012) in multiple tabs or windows to simulate multiple simultaneous collaborators.

---

## Running Automated Tests

Run the full test suite with the built-in Node.js test runner:
```bash
npm test
```
All 17 tests verify CRDT convergence, awareness, persistence, API endpoints, and sandboxed code execution.
