# Contributing to Synapse Collab

Thank you for your interest in contributing to **Synapse Collab**!

## How to Contribute

1. **Fork the Repository** on GitHub.
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/Anjelo-Sherin/day-12-collaborative-workspace.git
   ```
3. **Create a Feature Branch**:
   ```bash
   git checkout -b feature/my-cool-feature
   ```
4. **Install Dependencies and Test**:
   ```bash
   npm install
   npm test
   ```
5. **Make your changes** and verify all tests pass:
   ```bash
   npm run build
   npm test
   ```
6. **Commit & Push**:
   ```bash
   git commit -m "feat: add support for typescript execution"
   git push origin feature/my-cool-feature
   ```
7. **Open a Pull Request** describing your changes and link any relevant issues.

## Guidelines
- Follow existing JavaScript modular standards.
- Write unit tests under `tests/` for any new CRDT, network, or sandbox functionality.
- Ensure no secrets or environment tokens are committed.
