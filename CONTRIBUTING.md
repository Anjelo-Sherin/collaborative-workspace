# Contributing to Synapse Collab

Contributions, bug reports, and suggestions are warmly welcomed! Please review the guidelines below before submitting pull requests.

---

## 1. Development Workflow

1. **Fork** the repository and clone your fork locally.
2. Create a new descriptive topic branch:
   ```bash
   git checkout -b feat/add-python-autocomplete
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Build client assets:
   ```bash
   npm run build
   ```
5. Run the local dev server:
   ```bash
   npm run dev
   ```

---

## 2. Code Quality & Testing

- Before committing, run all automated tests:
  ```bash
  npm test
  ```
- Ensure any new features include unit/integration tests in the `tests/` directory.
- Verify CRDT convergence properties when modifying document data structures.
- Keep dependency additions minimal and justified.

---

## 3. Submitting Pull Requests

1. Commit your changes with clear, semantic commit messages:
   - `feat:` for new capabilities.
   - `fix:` for bug fixes.
   - `docs:` for documentation updates.
   - `test:` for test additions or modifications.
2. Push your branch to GitHub and open a Pull Request targeting `main`.
3. Provide a clear PR description detailing what was changed and how it was tested.
