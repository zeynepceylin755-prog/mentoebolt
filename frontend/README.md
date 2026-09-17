# Mentora Frontend (Phase 5F.8 B)

The existing React workspace, made runnable. This package contains only the
frontend code; the backend lives in `../backend` and remains authoritative.

## Setup
```bash
cd frontend
npm install
cp .env.example .env   # then set VITE_API_BASE_URL
npm run dev            # http://localhost:5173
```

## Configuration

The backend URL comes ONLY from `VITE_API_BASE_URL`. No host is hardcoded. When
unset, the app uses the same-origin `/api/v1` path so it can run behind a reverse
proxy without a rebuild.

## Auth

The Student Journey panel uses a development access token entered by hand. This
is a development-only mechanism: it uses the real backend authentication
contract (Bearer token) and never hardcodes a JWT. Production session management
is out of scope for this phase.

