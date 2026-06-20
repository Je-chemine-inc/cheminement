# Code style & conventions

Two sections. **(a)** is what the codebase does *today* — match it when editing inside an existing legacy module. **(b)** is the target for *new* code. **Where (a) and (b) conflict, follow (b) in new files; match (a) only when editing inside an existing legacy module.**

---

## (a) Detected conventions (as they exist today)

### Language & tooling
- **TypeScript strict** (`tsconfig.json: strict: true`, `noEmit: true`). Path alias `@/* → src/*`.
- **pnpm** is canonical (the `pnpm` block in `package.json` + freshest lockfile). Stale `bun.lock` and `package-lock.json` are committed but unused — ignore them (see [debt-map](../quality/debt-map.md)).
- **ESLint flat config** = `eslint-config-next` core-web-vitals + typescript presets, **zero custom rules**. `@typescript-eslint/no-explicit-any` is therefore active (and locally suppressed ~23 times). ⚠ **Lint is advisory, not a gate**: `next build` (Next 16) does **not** run ESLint, and `pnpm lint` currently reports ~84 pre-existing errors — so a clean lint run is not achievable today (see [debt-map](../quality/debt-map.md)). Don't add new lint errors in files you touch.
- Type honesty is mostly good: **0 `@ts-ignore` in production code** (2 `@ts-expect-error` in tests), but **~91 `any`** cluster in `admin/admins` routes + `lib/api-client.ts`.

### Files & naming
- Components are **PascalCase** `.tsx`, organized by **domain folder** under `src/components/` (`admin`, `appointments`, `billing`, `dashboard`, `inbox`, `payments`, `sections`, `ui`, …); some folders use a barrel `index.ts`.
- API routes are App Router `route.ts` files exporting `GET/POST/PATCH/PUT/DELETE`. Dynamic segments `[id]`, `[kind]`, `[slug]`.
- Lib modules are kebab-case (`appointment-routing.ts`, `payment-settlement.ts`). Tests are co-located **`*.spec.ts`** (never `.test.*`).
- Mongoose models are PascalCase singular (`User.ts`, `Appointment.ts`), one model per file, registered with the hot-reload-safe idiom `mongoose.models.X || mongoose.model<IX>("X", schema)`.
- Mixed default vs named exports for components (most `ui` primitives are named; some feature components default-export).

### Styling
- **Tailwind 4** (CSS-first config in `src/app/globals.css`, no `tailwind.config`) + **shadcn/ui "new-york"** + Radix primitives + **class-variance-authority (CVA)** for variants. Compose classes with the single **`cn()`** helper (`src/lib/utils.ts` = `twMerge(clsx(...))`).
- Authoritative design tokens are **OKLCH CSS variables** in `globals.css` (`--primary` is a muted blue; headings use `font-serif font-light`). `src/theme.ts` and `src/config/colors.ts` are **not** the live palette — don't edit them expecting visual change.
- Two shadcn generations coexist (older `forwardRef`+`displayName` vs newer functional `data-slot`); a hand-rolled CSS `@keyframes`/`animate-*` library + `ScrollReveal` coexist with framer-motion.

### State, data, forms
- **Plain React hooks** (`useState`/`useEffect`/`useRef`). No Redux/Zustand/Jotai, no SWR/React Query. Context only from `SessionProvider`, `NextIntlClientProvider`, and shadcn's own.
- Data fetching is split between a thin `apiClient` singleton (`src/lib/api-client.ts`) and **raw `fetch()`** — no unified data layer or caching (except the hand-rolled `useMotifs` module cache).
- **No form library and no client-side schema validation library** (no react-hook-form, no zod in components). Forms are controlled inputs with manual, ad-hoc validation. Feedback is via **inline state-driven banners** (track an explicit `messageType` — do **not** string-match localized text); a couple of components still use `window.alert`.
- **i18n is universal**: `useTranslations` from next-intl in ~101 files; all copy in `messages/{en,fr}.json`. FR and EN are kept in **lockstep**.

### Server / API conventions
- Each route inlines `getServerSession(authOptions)` then a role gate (`role !== "admin"` → 403, etc.) and an inline ownership check. No `requireAuth` helper exists.
- Concurrency safety = single-document atomic `findOneAndUpdate` "claims" (no multi-doc transactions). Idempotency via unique indexes (`StripeWebhookEvent.eventId`, per-appointment uniqueness) and dedup boolean flags.
- Appointment dates are written via `parseAppointmentDate` (UTC-noon). Contact fields are AES-256-GCM encrypted via the Mongoose plugins.
- Long-running side effects (email fan-out) are wrapped in `after()` so the serverless container stays alive for SMTP.

---

## (b) Target conventions for new code

- **Strict TypeScript, no new `any`.** Type inputs/outputs at boundaries. Use `@ts-expect-error <reason>` (never `@ts-ignore`) only as a last resort. Don't add to the legacy `any` count.
- **Validate at every trust boundary** — user input, network responses, stored data. Today there is no zod; for new non-trivial input validation, validate explicitly and return `400` with a clear shape on failure (mirror existing `ValidationError → 400` patterns). Never trust the client for role/ownership — check server-side.
- **Keep components presentational; put logic in hooks/services.** Do not add to the god-files; extract new business logic into a `src/lib/*` module with a `*.spec.ts`, and call it from a thin route/handler. Prefer Server Components for new read-only pages where practical.
- **No new module-level singletons for app state.** Local React state or a documented service; don't introduce a global mutable store ad hoc.
- **Bilingual lockstep is mandatory**: every user-facing string lives in **both** `messages/en.json` and `messages/fr.json` under the same key. Thread `lang` into both `buildEmailHtml` and `buildEmailText` for emails. When i18n-ing a component whose styling matches message text, add an explicit `messageType` state.
- **Accessible, designed empty/error/loading states** are part of scope for any new UI (the app hand-rolls these per page — follow the neighbouring page's pattern).
- **Tests**: new logic gets a `*.spec.ts`; a bug fix gets a **failing regression test first**. Pure functions go in `src/lib`; route guards/handlers get a route spec (see existing `route.spec.ts` / `route.auth.spec.ts`). Money, auth, and routing changes are not "done" without a test.
- **Money / state-machine changes**: respect the documented invariants (`cascadeAttempts` ≠ `refusedBy`; receipts only when `payment.status === "paid"`; `parseAppointmentDate` for dates; the encryption-hook ordering). See [debt-map](../quality/debt-map.md) and [CUJs](../product/critical-user-journeys.md).
- **Conventional Commits**, one logical change per commit. Never weaken a gate to pass; propose gate changes separately.
