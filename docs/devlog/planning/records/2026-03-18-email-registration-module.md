# Email Registration Module

## Background

The current auth system already supports email-first registration and email/username dual-path login. However three critical capabilities are missing that make the email system incomplete for production:

1. **Email verification** — users can register with fake/typo emails; no confirmation flow
2. **Password reset** — no account recovery if password is forgotten
3. **Login rate limiting** — no brute-force protection

This devlog covers the three-phase plan and Phase 1 implementation.

---

## Design

### Current State (pre-this-work)

| Capability | Status |
|------------|--------|
| Email registration (auto-generates username) | ✅ |
| Email + username dual-path login | ✅ |
| Bcrypt password hashing | ✅ |
| JWT 24h token | ✅ |
| Email verification | ❌ |
| Password reset | ❌ |
| Login rate limiting | ❌ |
| Refresh tokens | ❌ |

### Three-Phase Plan

#### Phase 1 — Email Verification (this record)

- `User.EmailVerified bool` field (default false)
- `EmailToken` model: stores short-lived tokens for verify/reset purposes
- SMTP email sending (`config/email.go`) — skips silently when SMTP not configured (dev mode)
- Register: after user creation, if email provided → create EmailToken + send verification email
- `GET /api/auth/verify-email?token=xxx` — public endpoint, marks user verified
- `POST /api/auth/resend-verification` — authenticated, resends if still unverified
- Frontend: `email_verified` added to UserProfile type; unverified banner shown in header
- Backward compat: old username-only users unaffected; EmailVerified defaults false, no email = no verification flow

#### Phase 2 — Password Reset + Login Rate Limiting

- `POST /api/auth/forgot-password` — sends reset email (no user enumeration: always returns 200)
- `POST /api/auth/reset-password` — verifies token, updates password, invalidates token
- Redis sliding-window rate limiter middleware: 5 failures / 15 min window → 15 min lockout
- Key format: `login_attempts:{sha256(identifier)}`
- Frontend: "Forgot password?" link on login form → email input modal

#### Phase 3 — Refresh Tokens + Session Management

- Access token: JWT 15 min expiry (shortened from 24h), stored in memory
- Refresh token: random 64-char hex, 7-day expiry, HttpOnly cookie + DB
- `RefreshToken` model: UserID, Token, ExpiresAt, RevokedAt, UserAgent, IP
- `POST /api/auth/refresh` — issues new access token from valid refresh token
- `POST /api/auth/logout` — revokes refresh token
- Frontend: silent token refresh on 401; explicit logout invalidates refresh token

---

## Phase 1 Implementation

### New / Modified Files

#### `backend/models/user.go`
- Added `EmailVerified bool` (GORM default false)

#### `backend/models/email_token.go` (new)
```go
type EmailToken struct {
    gorm.Model
    UserID    uint       // FK to users
    Token     string     // 64-char hex, unique
    Purpose   string     // "verify" | "reset"
    ExpiresAt time.Time
    UsedAt    *time.Time // nil = unused
}
```

#### `backend/config/config.yaml`
- Added `email:` section with smtp_host, smtp_port, smtp_user, smtp_password, from_address, verify_url_base
- Default smtp_host = "" → email sending disabled in dev (logs to stdout instead)

#### `backend/config/email.go` (new)
- `LoadEmailConfig()` — reads from Viper + env var overrides (SMTP_HOST, SMTP_USER, SMTP_PASSWORD, VERIFY_URL_BASE)
- `SendEmail(cfg, to, subject, textBody, htmlBody)` — STARTTLS SMTP; no-ops silently when smtp_host is empty
- Template helpers: `VerificationEmailBody()`, `ResetEmailBody()` (Phase 2)

#### `backend/config/migrate.go`
- Added `&models.EmailToken{}` to AutoMigrate list

#### `backend/controllers/auth_controller.go`
- `Register`: after `DB.Create(&user)` success, if email path → `createAndSendVerificationToken(user)`
- `VerifyEmail(c *gin.Context)`: public handler, looks up non-expired unused token, sets `EmailVerified=true`, marks token used
- `ResendVerification(c *gin.Context)`: authenticated handler, checks user not already verified, deletes old unused verify tokens, creates new token, sends email

#### `backend/router/router.go`
New public routes under `/api/auth`:
- `GET /verify-email`
- `POST /resend-verification` (auth required, moved to protected group)

#### `frontend/src/types/user.ts`
- Added `email_verified?: boolean` to `UserProfile`

#### `frontend/src/services/userService.ts`
- Added `resendVerification()` — POST `/api/auth/resend-verification`

#### `frontend/src/App.tsx`
- Reads `currentUser.email_verified` after profile fetch
- Shows dismissible yellow banner when `email != null && !email_verified`
- Banner includes "Resend verification email" button → calls `resendVerification()`

#### `frontend/src/components/ProfilePage.tsx`
- Email field is now editable from the account settings modal
- Save profile request includes `email`
- Added `Alpha Vantage (data)` label to provider UI so non-LLM data keys can appear in the same API key surface

### Env Vars Added

| Variable | Purpose | Default |
|----------|---------|---------|
| `SMTP_HOST` | SMTP server hostname | "" (disable) |
| `SMTP_USER` | SMTP auth username | "" |
| `SMTP_PASSWORD` | SMTP auth password | "" |
| `VERIFY_URL_BASE` | Base URL for verification links | "http://localhost" |

### Backward Compatibility

- Existing users: `EmailVerified = false`, no email = no banner, no impact
- Username-only users: unchanged flow, banner only shows if email is set
- AutoMigrate adds `email_verified` column with `DEFAULT false` — zero downtime migration

---

## Open Issues

- Phase 2 (forgot-password, rate limiting) — not yet implemented
- Phase 3 (refresh tokens) — not yet implemented
- SMTP configuration needs to be set in `docker-compose.yml` / `.env.production` before verification emails work in deployment
- Consider using a transactional email service (Resend, SendGrid) instead of raw SMTP for better deliverability in production
- Email-change verification regression has been fixed after review:
  - changing `users.email` now resets `email_verified=false`
  - stale unused verification tokens are deleted
  - a fresh verification token/email is issued for the new address
  - profile APIs now include `email_verified`

## Follow-up Solution

Implemented:

1. `UpdateProfile` now detects real email changes and:
   - sets `email_verified = false`
   - deletes stale unused verify tokens
   - creates/sends a fresh verification token for the new address
2. `email_verified` is now included in:
   - `GET /api/user/profile`
   - `PUT /api/user/profile`
   so the frontend banner reflects the actual account state after login and after profile edits
