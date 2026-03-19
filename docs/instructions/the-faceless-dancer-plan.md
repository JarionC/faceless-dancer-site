# The Faceless Dancer — Product + Technical Design Plan

## 1. Overview

**The Faceless Dancer** is a dark-themed, one-page DeFi-style web experience centered on a live stream of a single dancing character. The character’s body-part graphics, background graphics, and music can be influenced by coin holders through a wallet-authenticated request system.

The landing page should feel polished and modern, with a strong call to action near the top, optional live video playback, project information, social links, and a request workflow that lets eligible holders submit assets for use in the stream.

This application is intended to run on **one box** with a lightweight architecture:
- Frontend: light JavaScript framework
- Backend: Node.js + Express
- Database: lightweight relational DB
- Optional local object/file storage on disk

The project should be designed for:
- fast initial delivery
- clean modularity
- easy reconfiguration through environment variables
- low operational overhead
- future expansion without a rewrite

---

## 2. Core Product Goals

### Primary goals
- Present a **sleek dark-mode one-page site** with strong branding.
- Show the **live stream** near the top when enabled.
- Explain the project concept clearly and visually.
- Allow holders of the coin to **connect wallet** and **prove eligibility** through wallet signature.
- Let eligible users submit time-bound asset requests for the stream.
- Let admins approve or reject requests and assign time slots.
- Show approved time slots on a public schedule board.

### Secondary goals
- Keep the stack lightweight enough for a single server.
- Keep the upload and request system safe and validated.
- Make the UI feel premium, not like an internal tool.
- Make all major settings configurable with environment defaults.

---

## 3. Recommended Stack

## Frontend
**Recommendation:** `Preact + Vite`

Why:
- much lighter than full React
- React-like developer experience
- easy component model for a polished single-page app
- good ecosystem support
- simple build and deployment

Alternative:
- `SvelteKit` if preferred, but Preact is the simplest fit for a light one-page app with modular widgets.

### Styling
**Recommendation:**
- Tailwind CSS for fast dark-mode styling
- minimal animation library only if needed
- custom CSS variables for theme control

### Wallet integration
- `viem` for EVM wallet interactions
- optional `wagmi` if more wallet UX abstraction is desired
- signature-based auth flow from frontend to backend

## Backend
**Recommendation:** `Node.js + Express`

Why:
- easy deployment on same box
- simple REST API surface
- minimal overhead
- strong ecosystem for upload handling, auth, validation, and scheduling

## Database
**Recommendation:** `SQLite` with `better-sqlite3`

Why:
- extremely lightweight
- perfect for low to moderate write volume
- no separate DB service needed
- excellent for a single-box app
- easy backups

If scale grows later, the data access layer should be structured so SQLite can be swapped to Postgres.

## File storage
**Recommendation:** local disk storage on the same box initially
- uploaded assets stored under organized directories
- metadata stored in SQLite
- strict validation and size limits

Future upgrade path:
- S3-compatible object storage without changing the domain model much

## Live stream playback
Support two modes:
- embedded player for HLS playback
- optional RTMP-related configuration upstream, but browser playback should use **HLS**, not raw RTMP

Important note:
Browsers do not natively play RTMP. If the live source is RTMP, the server/media pipeline should convert or expose it as HLS for playback in the site.

---

## 4. High-Level Architecture

```text
[ Browser / Preact SPA ]
        |
        | HTTPS REST API
        v
[ Node + Express App ]
   |- auth module (wallet signature)
   |- request module
   |- upload module
   |- schedule module
   |- admin module
   |- config module
   |- stream config module
        |
        +--> [ SQLite ]
        |
        +--> [ local uploads directory ]
```

### Runtime model
Single Node process can serve:
- frontend static assets
- API endpoints
- uploaded files only when safe/appropriate

Recommended reverse proxy in front:
- Nginx or Caddy

Responsibilities of reverse proxy:
- TLS termination
- compression
- caching headers for static files
- request body size rules
- optional basic rate limiting

---

## 5. One-Page Site Information Architecture

## Section 1 — Hero / Top fold
Purpose:
- instantly communicate the concept
- display title/logo/tagline
- show CTA
- optionally show live stream player near the top

Content:
- logo
- project name: **The Faceless Dancer**
- one-line tagline
- short supporting paragraph
- primary CTA: `Connect Wallet` or `Request Your Slot`
- secondary CTA: `View Schedule`
- optional live player card
- live badge/status

Suggested layout:
- two-column desktop layout
- stacked mobile layout
- left side: title, tagline, CTA, short concept statement
- right side: stream/video card

## Section 2 — What It Is
Purpose:
- explain the concept fast

Content:
- short description of the livestream experience
- how holder submissions affect the dancer
- brief “how it works” cards:
  1. Hold the coin
  2. Verify wallet
  3. Upload approved assets
  4. Request a time slot
  5. Admin confirms
  6. Your assets go live

## Section 3 — Visual / Creative System
Purpose:
- explain configurable elements

Example configurable asset categories:
- head graphic
- face graphic
- torso graphic
- arms graphic
- legs graphic
- accessory graphic
- background graphic
- music track

This should be represented as elegant cards or a stylized character breakdown.

## Section 4 — Request Access / Holder Portal
Purpose:
- wallet-gated interaction area

States:
- disconnected
- connected, not eligible
- connected, eligible
- connected, eligible, submission in progress

Actions:
- connect wallet
- sign verification message
- check coin holder eligibility
- open request form

## Section 5 — Submission Form
Purpose:
- collect holder request data cleanly

Inputs:
- selected asset target(s)
- validated file upload(s)
- desired time window
- optional notes
- wallet address display
- availability feedback
- submission button

## Section 6 — Public Schedule Board
Purpose:
- show confirmed or reserved time slots

Views:
- agenda list
- day/week board
- simple timeline blocks

This only needs to show **admin-confirmed** slots.

## Section 7 — Project Info / Token Utility / Socials
Purpose:
- close the page with credibility and links

Content:
- project description
- utility explanation
- social icons/links
- contract address if desired
- footer links

---

## 6. Visual Design Direction

## Mood
- default dark palette
- polished DeFi landing page feel
- cinematic but restrained
- slightly futuristic
- premium glow effects, not noisy clutter

## Base visual system
- near-black background
- charcoal or slate panel surfaces
- subtle gradients
- glassmorphism only in moderation
- soft shadow and blur layers
- thin borders with low-opacity accent tint
- large bold headline
- clean mono or semi-mono accents for wallet and schedule data

## Suggested color roles
Use environment/config-driven CSS variables.

- `--bg-primary`: page background
- `--bg-secondary`: panel background
- `--bg-elevated`: modal / card layer
- `--text-primary`: main text
- `--text-secondary`: subdued text
- `--accent-primary`: primary brand glow
- `--accent-secondary`: secondary highlight
- `--success`: availability / approved
- `--warning`: pending
- `--danger`: rejected / invalid

## UI design notes
- rounded cards
- large CTA buttons
- prominent live player frame
- animated hover edges
- tasteful micro-interactions
- no giant walls of text
- section spacing generous
- social row should feel intentional, not tacked on

---

## 7. Live Stream Player Requirements

## Goal
Show a live stream player near the top when enabled.

## Functional requirements
- player is optional via config toggle
- show poster/placeholder when stream disabled or offline
- support HLS playback URL
- show live/offline badge
- optional mute on load
- optional autoplay based on browser policy

## Recommended frontend behavior
- if `LIVE_PLAYER_ENABLED=true`, render player section
- if `LIVE_STREAM_URL` is present, initialize HLS player
- if stream unavailable, show fallback visual and CTA

## Notes
If the actual ingest is RTMP, the public web player should receive an HLS endpoint or similar browser-compatible stream source.

---

## 8. Wallet Verification and Holder Gating

## Auth model
Use wallet signature login.

Flow:
1. user connects wallet
2. frontend asks backend for nonce/challenge
3. user signs challenge
4. frontend submits signed message to backend
5. backend verifies signature
6. backend checks token holding rule
7. backend creates session or signed auth token

## Eligibility model
User is eligible if wallet satisfies configured hold requirement.

Configurable examples:
- minimum token balance
- NFT ownership
- allowlist override
- admin bypass wallet list

## Session strategy
Recommended:
- HTTP-only session cookie or short-lived JWT + refresh pattern
- keep it simple

## Required backend modules
- nonce/challenge generator
- signature verification
- holder balance checker
- session issuance

## Chain access
Backend needs an RPC endpoint configured through env.

---

## 9. Submission / Request Workflow

## User goal
A verified holder can request a stream customization slot by submitting approved assets and selecting a desired time window.

## Core form fields
- wallet address
- asset category or categories
- one or multiple files depending on asset type
- requested time range
- optional notes
- agreement checkbox

## Asset type rules
The selected asset type determines allowed upload format and count.

### Example asset rules
- `background`
  - allowed: PNG
  - count: 1 or multiple depending on mode
- `body_part_pack`
  - allowed: PNG
  - count: multiple
- `music`
  - allowed: MP3
  - count: 1
- `mixed_scene`
  - allowed: multiple PNG + optional MP3 if enabled by config

These rules should be config-driven and enforced both frontend and backend.

## Validation requirements
### Frontend validation
- required field checks
- file count checks
- file extension checks
- file size checks
- time range sanity
- disable submit if invalid

### Backend validation
- MIME sniffing, not extension only
- file count limits
- per-file size limits
- max total upload size
- allowed asset mapping validation
- notes length limit
- duplicate or overlapping slot check
- holder eligibility re-check before accept

## Time range input
Recommended UX:
- choose date
- choose start time
- choose end time
- show slot availability feedback

Optional enhancement:
- small availability calendar picker with blocked regions

## Request statuses
- `draft`
- `submitted`
- `pending_review`
- `approved`
- `rejected`
- `scheduled`
- `completed`
- `cancelled`

For simpler initial version, use:
- `submitted`
- `approved`
- `rejected`
- `scheduled`
- `completed`

---

## 10. Schedule Board

## Purpose
Publicly show confirmed slots that have been approved by admin.

## Display requirements
- only show approved/scheduled slots
- show date, time, and short label
- optionally show wallet short-form or display name if allowed
- show category badge(s)

## Views
Start with:
- weekly board or agenda list

Recommended MVP:
- agenda list grouped by date
- optional mini calendar strip for navigation

## Availability logic
- admin-confirmed slots are treated as unavailable
- pending requests do not block the board publicly unless desired
- time overlap rules defined in backend

---

## 11. Admin Console Requirements

This can be a protected route in the same app.

## Admin functions
- admin login via config-protected wallet list or password auth
- review submitted requests
- inspect uploaded assets
- approve or reject request
- assign or adjust scheduled time slot
- mark slot confirmed
- manage stream/player config
- manage social links
- manage site copy if desired later

## Admin views
### Request queue
- request ID
- wallet
- submission timestamp
- asset types
- requested range
- notes preview
- current status

### Request detail
- full metadata
- file preview/download links
- validation notes
- approve/reject controls
- assign slot controls

### Schedule manager
- view confirmed schedule
- add or edit blocked/taken slots
- sync with public board

## Security
- admin route must be protected
- avoid exposing raw uploaded assets publicly unless intended
- log admin actions

---

## 12. Data Model

## Tables

### `users`
- `id`
- `wallet_address` unique
- `display_name` nullable
- `eligibility_status`
- `last_verified_at`
- `created_at`
- `updated_at`

### `auth_nonces`
- `id`
- `wallet_address`
- `nonce`
- `expires_at`
- `used_at`
- `created_at`

### `requests`
- `id`
- `user_id`
- `status`
- `requested_start_at`
- `requested_end_at`
- `approved_start_at` nullable
- `approved_end_at` nullable
- `notes`
- `admin_notes`
- `created_at`
- `updated_at`

### `request_assets`
- `id`
- `request_id`
- `asset_type`
- `original_filename`
- `stored_filename`
- `mime_type`
- `file_size_bytes`
- `storage_path`
- `created_at`

### `schedule_slots`
- `id`
- `request_id` nullable
- `title`
- `start_at`
- `end_at`
- `status`
- `is_public`
- `created_by_admin`
- `created_at`
- `updated_at`

### `admin_users`
If using non-wallet admin auth.
- `id`
- `username`
- `password_hash`
- `role`
- `created_at`

### `site_settings`
- `key`
- `value`
- `updated_at`

### `audit_logs`
- `id`
- `actor_type`
- `actor_id`
- `action`
- `entity_type`
- `entity_id`
- `metadata_json`
- `created_at`

---

## 13. API Design (MVP)

## Public endpoints
- `GET /api/site-config`
- `GET /api/social-links`
- `GET /api/schedule`
- `GET /api/stream-status`

## Auth endpoints
- `POST /api/auth/nonce`
- `POST /api/auth/verify`
- `POST /api/auth/logout`
- `GET /api/auth/me`

## Holder request endpoints
- `GET /api/request-config`
- `POST /api/requests`
- `GET /api/requests/me`
- `GET /api/availability?start=...&end=...`

## Admin endpoints
- `GET /api/admin/requests`
- `GET /api/admin/requests/:id`
- `POST /api/admin/requests/:id/approve`
- `POST /api/admin/requests/:id/reject`
- `POST /api/admin/requests/:id/schedule`
- `GET /api/admin/schedule`
- `POST /api/admin/schedule`
- `PATCH /api/admin/settings`

---

## 14. Frontend Component Plan

## App shell components
- `PageLayout`
- `TopNav`
- `HeroSection`
- `LivePlayerCard`
- `CTAGroup`
- `ProjectOverviewSection`
- `ConfigurablePartsSection`
- `HolderPortalSection`
- `RequestFormSection`
- `ScheduleBoardSection`
- `SocialLinksSection`
- `Footer`

## Wallet/auth components
- `ConnectWalletButton`
- `WalletStatusBadge`
- `EligibilityGate`
- `SignaturePromptPanel`

## Request flow components
- `RequestForm`
- `AssetTypeSelector`
- `FileUploadField`
- `TimeRangePicker`
- `AvailabilityIndicator`
- `NotesTextarea`
- `SubmissionReviewPanel`

## Schedule components
- `ScheduleAgenda`
- `ScheduleWeekView`
- `SlotCard`
- `AvailabilityLegend`

## Admin components
- `AdminShell`
- `RequestQueueTable`
- `RequestDetailPanel`
- `AssetPreviewList`
- `ScheduleEditor`
- `SettingsPanel`

---

## 15. Backend Module Plan

Suggested folder-level module boundaries:

```text
server/
  config/
  db/
  modules/
    auth/
    users/
    eligibility/
    uploads/
    requests/
    schedule/
    stream/
    socials/
    admin/
    audit/
  middleware/
  utils/
  app.js
  server.js
```

## Module responsibilities
### `config`
- load env
- apply defaults
- validate required settings
- expose typed config object

### `db`
- DB bootstrap
- migrations
- query helpers

### `auth`
- nonce issuing
- signature verification
- session handling

### `eligibility`
- token ownership checks
- allowlist logic
- configurable gating rules

### `uploads`
- file validation
- storage path generation
- safe filename generation
- MIME/type enforcement

### `requests`
- request creation
- state transitions
- linking uploads to requests

### `schedule`
- overlap detection
- availability computation
- public schedule serialization

### `stream`
- stream enabled/offline config
- live player metadata

### `socials`
- social links config retrieval

### `admin`
- request moderation
- schedule management
- settings management

### `audit`
- append-only admin/user action logs

---

## 16. File Upload Rules and Safety

## Required protections
- sanitize filenames
- store with generated filenames, not original names
- validate by MIME and magic bytes when possible
- reject unknown or malformed files
- enforce per-type file limits
- enforce max total payload size
- keep uploads outside public static root unless intentionally exposed
- virus scanning optional but recommended later

## Supported initial formats
- PNG for graphics
- MP3 for music

## Example config values
- max PNG size
- max MP3 size
- max assets per request
- max total upload bytes
- allowed mixed upload modes

---

## 17. Environment Variables

All variable values should be configurable by environment, with sensible defaults where possible.

## Core app
- `NODE_ENV`
- `PORT`
- `APP_BASE_URL`
- `SESSION_SECRET`

## Frontend/site
- `SITE_NAME`
- `SITE_TAGLINE`
- `SITE_DESCRIPTION`
- `SITE_LOGO_URL`
- `THEME_BG_PRIMARY`
- `THEME_BG_SECONDARY`
- `THEME_TEXT_PRIMARY`
- `THEME_TEXT_SECONDARY`
- `THEME_ACCENT_PRIMARY`
- `THEME_ACCENT_SECONDARY`

## Stream
- `LIVE_PLAYER_ENABLED`
- `LIVE_STREAM_URL`
- `LIVE_STREAM_POSTER_URL`
- `LIVE_STATUS_TEXT`
- `LIVE_AUTOPLAY_ENABLED`
- `LIVE_MUTED_BY_DEFAULT`

## Wallet / blockchain
- `CHAIN_ID`
- `RPC_URL`
- `TOKEN_CONTRACT_ADDRESS`
- `MIN_TOKEN_BALANCE`
- `ELIGIBILITY_MODE`
- `SIGN_MESSAGE_TEMPLATE`

## Uploads
- `UPLOAD_ROOT_DIR`
- `MAX_UPLOAD_TOTAL_BYTES`
- `MAX_PNG_BYTES`
- `MAX_MP3_BYTES`
- `MAX_FILES_PER_REQUEST`
- `ALLOWED_ASSET_TYPES_JSON`

## Database
- `DATABASE_PATH`

## Socials
- `SOCIAL_X_URL`
- `SOCIAL_TELEGRAM_URL`
- `SOCIAL_DISCORD_URL`
- `SOCIAL_INSTAGRAM_URL`
- `SOCIAL_WEBSITE_URL`

## Admin
- `ADMIN_MODE`
- `ADMIN_PASSWORD_HASH`
- `ADMIN_ALLOWED_WALLETS`

## Schedule defaults
- `DEFAULT_SLOT_MINUTES`
- `MIN_REQUEST_LEAD_HOURS`
- `MAX_REQUEST_WINDOW_DAYS`
- `PUBLIC_TIMEZONE`

---

## 18. UX Notes for the Holder Request Flow

## Desired user flow
1. user lands on page
2. sees live player and concept
3. clicks connect wallet
4. signs message
5. sees eligibility state
6. opens request form
7. selects asset type
8. upload inputs dynamically adapt to rules
9. selects desired time range
10. sees availability feedback
11. adds notes
12. submits request
13. receives confirmation status
14. later sees approved slot on schedule board

## UX principles
- keep the form compact but elegant
- avoid exposing technical chain details unless needed
- be explicit about upload limits
- show errors inline and clearly
- show selected files in a review state before submit
- show timezone everywhere time matters

---

## 19. Suggested Delivery Phases

## Phase 1 — foundation
- repo setup
- config system
- frontend shell
- Express API scaffold
- SQLite schema and migrations
- site sections with placeholder content

## Phase 2 — auth + eligibility
- wallet connect
- nonce/signature auth
- holder check
- authenticated session state

## Phase 3 — request system
- request config endpoint
- upload validation
- request creation flow
- file storage
- status tracking

## Phase 4 — admin + schedule
- admin auth
- request review interface
- approval/rejection
- schedule assignment
- public schedule board

## Phase 5 — polish
- visual refinement
- animation pass
- responsive QA
- stream player improvements
- audit logs and final hardening

---

## 20. MVP Scope Recommendation

To ship quickly, the MVP should include:
- one polished landing page
- optional live player
- social links
- wallet signature auth
- simple token holder verification
- asset upload form with PNG/MP3 validation
- request submission
- admin approval/rejection
- public confirmed schedule board

Defer until later:
- advanced media processing pipeline
- drag-and-drop timeline editing
- automatic slot pricing or auctions
- heavy analytics
- multi-admin RBAC
- cloud storage abstraction unless needed early

---

## 21. Open Implementation Decisions

These should be resolved before coding begins:
- exact wallet ecosystem: EVM only or multi-chain
- exact coin verification logic
- whether mixed PNG + MP3 submissions are allowed in one request
- whether approved assets are retained permanently or cleaned later
- whether uploaded assets should be previewable publicly
- whether admin auth is wallet-based or password-based
- whether stream playback source will always be HLS in the browser

---

## 22. Recommended Initial Repo Structure

```text
/
  client/
    src/
      components/
      sections/
      hooks/
      lib/
      styles/
      pages/
    index.html
    vite.config.js
  server/
    config/
    db/
    modules/
    middleware/
    utils/
    app.js
    server.js
  shared/
    constants/
    types/
    schemas/
  uploads/
  scripts/
  .env.example
  package.json
  README.md
  AGENTS.md
```

---

## 23. Final Recommendation

Build this as a **single deployable Node app** with:
- **Preact + Vite** frontend
- **Express** backend
- **SQLite** database
- **local disk uploads**
- **wallet signature auth**
- **config-driven modules**

That gives the project:
- low cost
- fast iteration
- clean one-box deployment
- good enough structure to scale modestly before re-architecting

The architecture should prioritize:
- modularity
- strict validation
- good UX
- environment-driven configuration
- a premium dark-mode presentation

