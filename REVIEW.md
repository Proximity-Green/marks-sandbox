# Code Review — `sveltekit-upgrade` Branch

**Date:** 2026-04-05
**Reviewer:** Claude (automated)

---

## Architecture & Structure

The upgrade is a significant step forward: SvelteKit with TypeScript, Supabase for persistence, proper auth with Google SSO + email whitelist, and an admin panel. Good foundations. Here's what needs attention:

---

## Critical

### 1. XSS via `{@html}` — Notes component
**Files:** `app/src/lib/Notes.svelte:233`, `app/src/routes/admin/notes/+page.svelte:151`

`renderContent()` uses `{@html}` with user-supplied note content. The regex only wraps `@mentions`, but the rest of the content is injected raw. A note containing `<img onerror=alert(1)>` would execute.

**Fix:** Sanitize content before rendering, or use DOM APIs instead of `{@html}`.

### 2. Supabase anon key duplicated and hardcoded
**File:** `app/src/lib/api.ts:68-69`

The Supabase URL and anon key are duplicated from `supabase.ts` and used for raw REST calls bypassing the Supabase client. This creates two separate auth paths — one with RLS (via the client) and one without proper auth context (raw REST with anon key).

**Fix:** Use the Supabase client from `supabase.ts` for all queries. Remove the duplicated credentials.

### 3. RLS policies are wide open
**File:** `supabase-schema.sql:194-210`

Every table has `using (true)` policies. This means **any user with the anon key can read/write/delete everything** — all documents, contacts, audit logs, allowed_users (they could add themselves). This is the most critical security issue.

**Fix:** Replace `using (true)` with proper policies that check `auth.uid()` or `auth.jwt()` claims. At minimum, restrict writes to authenticated users and scope reads to the user's tenant.

### 4. SQL injection in Supabase search
**File:** `app/src/routes/admin/items/+page.svelte:175`

Search input is interpolated directly into the filter string:
```ts
const searchFilter = s ? `name.ilike.%${s}%,item_code.ilike.%${s}%...` : '';
```
A user could craft input to break out of the filter.

**Fix:** Use the Supabase client's `.ilike()` or `.or()` methods with parameterized values instead of string interpolation.

### 5. No auth check on `/invite` endpoint
**File:** `worker/src/index.js:802`

The invite endpoint doesn't call `getTokenData()`. Anyone can add users to the allowed list and send invite emails without being authenticated.

**Fix:** Add `getTokenData()` check at the top of the handler, same as other authenticated endpoints.

---

## High Priority

### 6. `timeAgo()` duplicated 4 times
**Files:** `Notes.svelte`, `notes/+page.svelte`, `invite/+page.svelte`, `changelog/+page.svelte`

Identical function. Extract to a shared utility in `$lib/utils.ts`.

### 7. `getUser()` duplicated 4 times
**Files:** `items/+page.svelte`, `invite/+page.svelte`, `tags/+page.svelte`, `Notes.svelte`

Same pattern. Should be a shared function in `$lib/stores.ts` or `$lib/utils.ts`.

### 8. `renderContent()` duplicated
**Files:** `Notes.svelte`, `notes/+page.svelte`

Extract to shared utility (after fixing the XSS issue).

### 9. No confirmation on destructive actions
- `notes/+page.svelte:62` — `deleteNote()` called directly, no confirm
- `invite/+page.svelte:100` — `removeUser()` no confirm for non-self users
- Tags has confirm, which is good — replicate this pattern

### 10. Worker is one giant file
**File:** `worker/src/index.js` (800+ lines)

All route handlers are chained `if` statements in a single function. Should be split into route handler modules (e.g. `routes/auth.js`, `routes/documents.js`, `routes/admin.js`).

### 11. Totals use `setTimeout` hack
**File:** `app/src/routes/create/+page.svelte:114-123`

`recalc()` uses `setTimeout` to work around Svelte reactivity. This is fragile and can show stale values. Use `$derived` instead:
```ts
let subtotal = $derived(lineItems.reduce((s, i) => s + (i.quantity * i.unitPrice), 0));
let tax = $derived(subtotal * 0.15);
let total = $derived(subtotal + tax);
```

---

## Medium Priority

### 12. No loading/error states for admin data mutations
Saving items, tags, notes — failures are silently caught or `alert()`-ed. Need consistent toast/notification pattern for error handling.

### 13. Changelog loads ALL records for filter options
**File:** `app/src/routes/admin/changelog/+page.svelte:74-81`

Fetches every row from `change_log` just to populate filter dropdowns. This will degrade as the table grows.

**Fix:** Use `SELECT DISTINCT` queries or maintain a separate lookup table.

### 14. CORS still reflects any origin
**File:** `worker/src/index.js` — `corsHeaders()`

Worker allows any origin. Should be locked to the SvelteKit app URL and GitHub Pages URL.

### 15. Mixed state between Xero session and Supabase auth
Two independent auth systems (Xero OAuth via worker + Supabase Google OAuth). A user can be logged into Supabase but not Xero, or vice versa. The UX handles this but the mental model is confusing. Consider documenting the expected flow or unifying session management.

### 16. No pagination on notes
**File:** `app/src/routes/admin/notes/+page.svelte:53`

Loads up to 500 notes at once. Should paginate like changelog does.

### 17. `isGoogleEmail()` always returns true
**File:** `app/src/routes/admin/invite/+page.svelte:44-51`

The function is supposed to validate Google emails but returns `true` for everything. The comment explains why, but the function name is misleading — remove it or rename to clarify intent.

---

## Low Priority

| Issue | Location |
|-------|----------|
| `fmt()` duplicated in create and items pages | Extract to `$lib/utils.ts` |
| No favicon for SvelteKit app | Only SVG asset exists in `src/lib/assets/` |
| `$derived()` vs `$derived.by()` inconsistency | `list/+page.svelte` uses `.by()`, changelog uses `()` returning a function |
| No TypeScript on worker | Still plain JS — consider migrating |
| `any` types scattered in admin pages | e.g. `items:56`, `changelog:79-80`, `tags:71` |
| No form validation on create page | Can submit empty line items |
| No automated tests | Zero test files across frontend and worker |
| No CI/CD pipeline | No GitHub Actions for build, lint, or deploy |

---

## Recommended Fix Order

1. **Lock down RLS policies** — active data exposure risk
2. **Fix XSS in `{@html renderContent()}`** — sanitize or use DOM API
3. **Add auth to `/invite` endpoint**
4. **Fix search filter injection** in items page
5. **Replace `setTimeout` recalc** with `$derived` for totals
6. **Extract duplicated utilities** (`timeAgo`, `getUser`, `fmt`, `renderContent`)
7. **Lock down CORS** to known origins
8. **Split worker** into route modules
