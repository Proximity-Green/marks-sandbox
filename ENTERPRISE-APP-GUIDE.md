# Enterprise App Development Guide

Learnings extracted from the Proximity Green Xero Documents app and the Workshop17 admin system rebuild, combined with enterprise best practices. Use this as a checklist and reference when building production-grade web applications.

---

## Project Context

**Goal:** Rebuild the Workshop17 coworking space management system (my.workshop17.co.za) as a modern SvelteKit + Supabase application under the Proximity Green organisation.

**Existing system features (to replicate and improve):**
- Administrative dashboard with real-time activity feeds
- Proposals pipeline (accepted proposals list)
- Leads management with product categories (Dedicated Offices, Bespoke Office Solutions, Events, Memberships, Meeting)
- Lead tracking with location, contact info, timestamps
- Onboarding schedule with user assignments and status
- Organisation management
- Member management
- Xero accounting integration (invoices, quotes, purchase orders)

**Tech stack:**
- Frontend: SvelteKit 2 + Svelte 5 + Tailwind CSS v4 + TypeScript
- Auth: Supabase Auth (Google SSO) + email whitelist
- Database: Supabase (Postgres) with RLS
- API: Cloudflare Workers (TypeScript)
- External: Xero API, Mailgun
- Hosting: GitHub Pages (static adapter) / Cloudflare Pages

---

## 1. Domain Model

Based on the existing Workshop17 system, here are the core entities:

```
Organisations (tenants/clients)
├── Contacts (people at each org)
├── Proposals (quotes/deals)
│   └── Proposal Line Items
├── Memberships (active agreements)
│   └── Membership Line Items
├── Invoices (via Xero)
└── Notes

Leads (sales pipeline)
├── Lead Activities
├── Lead Status History
└── Notes

Locations (Workshop17 sites)
├── Offices / Desks
├── Meeting Rooms
└── Event Spaces

Members (individual people)
├── Organisation Memberships
├── Bookings
└── Access History

Users (internal staff)
├── Roles & Permissions
├── Assigned Tasks
└── Activity Log

Schedule / Tasks
├── Onboarding tasks
├── Assigned to users
└── Due dates & status

Products / Services
├── Dedicated Offices
├── Bespoke Office Solutions
├── Events
├── Memberships
├── Meeting Rooms
└── Day Use
```

---

## 2. Router Pattern for Many Endpoints

The current worker is a single file with chained `if` statements. For a system with dozens of endpoints, use a proper router pattern.

### File Structure

```
worker/src/
├── index.ts              # Entry point — router dispatch
├── router.ts             # Route registration and matching
├── middleware/
│   ├── auth.ts           # Token validation, getTokenData()
│   ├── cors.ts           # CORS headers (locked to known origins)
│   ├── validate.ts       # Request body validation
│   └── error.ts          # Consistent error responses
├── routes/
│   ├── auth.ts           # /auth/connect, /auth/callback, /auth/status
│   ├── organisations.ts  # CRUD for orgs
│   ├── contacts.ts       # CRUD for contacts
│   ├── leads.ts          # Lead pipeline endpoints
│   ├── proposals.ts      # Proposal management
│   ├── memberships.ts    # Membership management
│   ├── documents.ts      # /create, /list (Xero invoices/quotes/POs)
│   ├── schedule.ts       # Onboarding tasks and assignments
│   ├── email.ts          # /email, /email-custom
│   ├── admin.ts          # /invite, /admin/sync, user management
│   └── reference.ts      # /currencies, /tracking, /accounts
└── services/
    ├── xero.ts           # Xero API wrapper
    ├── supabase.ts       # Supabase helpers
    └── email.ts          # Mailgun wrapper
```

### Router Implementation

```typescript
// router.ts
type Handler = (req: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;

interface Route {
  method: string;
  path: string;
  handler: Handler;
  auth?: boolean; // default true
}

const routes: Route[] = [];

export function get(path: string, handler: Handler, opts?: { auth?: boolean }) {
  routes.push({ method: 'GET', path, handler, auth: opts?.auth ?? true });
}

export function post(path: string, handler: Handler, opts?: { auth?: boolean }) {
  routes.push({ method: 'POST', path, handler, auth: opts?.auth ?? true });
}

export function put(path: string, handler: Handler, opts?: { auth?: boolean }) {
  routes.push({ method: 'PUT', path, handler, auth: opts?.auth ?? true });
}

export function del(path: string, handler: Handler, opts?: { auth?: boolean }) {
  routes.push({ method: 'DELETE', path, handler, auth: opts?.auth ?? true });
}

export function match(method: string, pathname: string): Route | null {
  return routes.find(r => r.method === method && r.path === pathname) || null;
}

// index.ts
import { match } from './router';
import { handleCors } from './middleware/cors';
import { authenticate } from './middleware/auth';
import { errorResponse } from './middleware/error';

// Register all routes
import './routes/auth';
import './routes/organisations';
import './routes/leads';
// ... etc

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (request.method === 'OPTIONS') return handleCors(request, env);

    const url = new URL(request.url);
    const route = match(request.method, url.pathname);
    if (!route) return errorResponse('Not found', 404, request, env);

    if (route.auth !== false) {
      const tokenData = await authenticate(request, env);
      if (!tokenData) return errorResponse('Not authenticated', 401, request, env);
    }

    try {
      return await route.handler(request, env, ctx);
    } catch (err) {
      console.error(`${request.method} ${url.pathname} failed:`, err);
      return errorResponse('Internal error', 500, request, env);
    }
  }
};
```

### Adding a New Endpoint

With this pattern, adding an endpoint is just:

```typescript
// routes/leads.ts
import { get, post, put, del } from '../router';
import { getTokenData } from '../middleware/auth';
import { jsonResponse } from '../middleware/cors';
import { supabaseRequest } from '../services/supabase';

get('/leads', async (req, env) => {
  const tokenData = await getTokenData(req, env);
  const leads = await supabaseRequest(env, 'leads', {
    method: 'GET',
    query: 'select=*,lead_activities(*)&order=created_at.desc',
  });
  return jsonResponse({ leads }, 200, env, req);
});

post('/leads', async (req, env) => {
  const body = await req.json();
  // validate body...
  const lead = await supabaseRequest(env, 'leads', {
    method: 'POST',
    body,
  });
  return jsonResponse({ lead }, 201, env, req);
});

put('/leads/:id', async (req, env) => {
  // update lead...
});

del('/leads/:id', async (req, env) => {
  // soft delete lead...
});
```

---

## 3. Authentication & Authorisation

### Learnings
- Google SSO + email whitelist is a fast, secure auth model for internal apps
- Two separate auth systems (Xero OAuth + Supabase Auth) creates confusion
- The `/invite` endpoint had no auth check — every endpoint must verify identity

### Best Practices
- **Single auth system** — pick one identity provider and flow everything through it
- **Every endpoint must authenticate** — no exceptions, even admin/internal ones
- **Session tokens belong in HttpOnly cookies**, not URLs or localStorage
- **RBAC from day one** — Workshop17 has admin users and assigned tasks, so roles matter

```typescript
// roles for Workshop17
type Role = 'admin' | 'manager' | 'sales' | 'operations' | 'viewer';

// Check in middleware
function requireRole(...roles: Role[]) {
  return async (req: Request, env: Env) => {
    const user = await getUser(req, env);
    if (!roles.includes(user.role)) {
      return errorResponse('Forbidden', 403, req, env);
    }
  };
}
```

---

## 4. Database Security (Row Level Security)

### Learnings
- RLS was enabled but every policy was `using (true)` — no security at all
- Anyone with the anon key could read/write/delete everything
- Supabase anon key was duplicated and used for raw REST calls

### Best Practices
- **Never ship `using (true)` policies** — at minimum restrict to authenticated users
- **Scope data to tenants** — Workshop17 has multiple locations, data should be scoped
- **Separate read and write policies**
- **Use the Supabase client for all queries** — never bypass with raw REST
- **Service role key stays server-side only**

```sql
-- Example: proper RLS
create policy "Authenticated users can read leads"
  on leads for select
  using (auth.uid() is not null);

create policy "Sales and admin can create leads"
  on leads for insert
  with check (
    auth.uid() is not null
    and exists (
      select 1 from user_roles
      where user_id = auth.uid()
      and role in ('admin', 'manager', 'sales')
    )
  );
```

---

## 5. Input Validation & Injection Prevention

### Learnings
- Search input interpolated into Supabase filter strings — injection risk
- Note content rendered via `{@html}` without sanitisation — XSS
- Worker accepted all client input without server-side validation

### Best Practices
- **Never interpolate user input into queries** — use parameterised queries
- **Never use `{@html}` with user content** — use `textContent` or DOMPurify
- **Validate on the server** — client validation is UX, server validation is security
- **Whitelist valid values** for enums, validate types and ranges, set max lengths

```typescript
// Bad
const filter = `name.ilike.%${search}%`;

// Good
query.ilike('name', `%${search}%`);
```

---

## 6. Frontend Architecture

### Learnings
- Utility functions duplicated 3-4 times across components
- `setTimeout` hack used instead of proper Svelte reactivity
- No form validation, inconsistent error handling

### Best Practices

```
app/src/lib/
├── components/          # Reusable UI (SearchSelect, Notes, Tags, StatusBadge, Toast)
├── stores/              # State management (auth, ui, notifications)
├── utils/               # Shared functions (timeAgo, fmt, sanitize, getUser)
├── api/                 # API client grouped by domain
│   ├── client.ts        # Base fetch wrapper with auth
│   ├── leads.ts         # Lead API functions
│   ├── proposals.ts     # Proposal API functions
│   ├── organisations.ts # Org API functions
│   └── documents.ts     # Xero document API functions
├── types/               # Shared TypeScript interfaces
└── constants.ts         # Product types, statuses, roles
```

- **Use `$derived`** for computed values — never `setTimeout`
- **Every async operation needs**: loading, error, empty, and success states
- **Toast/notification system** — not `alert()`
- **Form validation** — validate before submit, inline errors, disable until valid

---

## 7. Dashboard Pattern

The Workshop17 admin dashboard has three columns: Accepted Proposals, Leads, Schedule. This is a common pattern for operational dashboards.

### Implementation Approach

```svelte
<!-- routes/admin/+page.svelte -->
<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
  <DashboardColumn title="Accepted Proposals" badge={proposals.length}>
    {#each proposals as p}
      <ProposalCard proposal={p} />
    {/each}
  </DashboardColumn>

  <DashboardColumn title="Leads">
    {#each leads as lead}
      <LeadCard lead={lead} />
    {/each}
  </DashboardColumn>

  <DashboardColumn title="Schedule">
    {#each tasks as task}
      <ScheduleCard task={task} />
    {/each}
  </DashboardColumn>
</div>
```

### Key Patterns
- **Real-time updates** — use Supabase realtime subscriptions for live dashboard
- **Category badges** — colour-coded by product type (Dedicated Offices = red, Events = green, etc.)
- **Relative timestamps** — "5 hours ago", "2 days ago" using shared `timeAgo()`
- **User avatars/badges** — show assigned user on schedule items
- **Click-through** — every item links to its detail view
- **Pagination or virtual scroll** — for lists that grow beyond 50 items

---

## 8. Lead Categories (Product Types)

From the existing system:

```typescript
// constants.ts
export const PRODUCT_TYPES = [
  { key: 'dedicated_office', label: 'Dedicated Offices', color: 'red' },
  { key: 'bespoke_office', label: 'Bespoke Office Solutions', color: 'blue' },
  { key: 'event', label: 'Events', color: 'green' },
  { key: 'membership', label: 'Memberships', color: 'purple' },
  { key: 'meeting', label: 'Meeting', color: 'orange' },
  { key: 'day_use', label: 'Day Use', color: 'teal' },
] as const;

export type ProductType = typeof PRODUCT_TYPES[number]['key'];
```

---

## 9. Security Checklist

Run through this for every feature before shipping:

- [ ] **Authentication** — endpoint requires auth? Token validated server-side?
- [ ] **Authorisation** — user allowed to perform this action on this resource?
- [ ] **Input validation** — all user input validated server-side? Types, ranges, lengths?
- [ ] **Output encoding** — no raw HTML rendering of user content? XSS-safe?
- [ ] **SQL injection** — parameterised queries only? No string interpolation?
- [ ] **CORS** — locked to known origins?
- [ ] **Secrets** — no keys in client code? Environment variables only?
- [ ] **Rate limiting** — protected against abuse?
- [ ] **HTTPS** — enforced with HSTS?
- [ ] **CSP headers** — Content Security Policy set?
- [ ] **Error messages** — no stack traces or internal details leaked to clients?
- [ ] **Audit logging** — who did what is recorded?

---

## 10. Code Quality

- **TypeScript everywhere** — frontend and backend, strict mode, no `any`
- **Tests at minimum:** unit tests for utils/business logic, integration tests for API, E2E for critical flows
- **CI pipeline:** lint, type-check, test, build on every PR
- **Pre-commit hooks** — lint-staged
- **Shared utilities extracted** — never duplicate `timeAgo`, `fmt`, `getUser`, etc.

---

## 11. Data Architecture

- **Cache strategy** — ref data: 30min TTL, transactional: no cache
- **Paginate everything** — default 50 rows, never unbounded
- **Database aggregations** — `SELECT DISTINCT` for filter options, not client-side
- **Audit trail via triggers** — can't be bypassed by application code
- **Soft deletes** — `deleted_at` column, not hard deletes
- **Optimistic updates** — update UI immediately, reconcile with server

---

## 12. Deployment & Operations

- **Environment separation** — dev, staging, production
- **Health check endpoint** — `/health` verifying database and Xero connectivity
- **Structured logging** — JSON with correlation IDs
- **Error monitoring** — Sentry or similar
- **Backup strategy** — automated with tested restore
- **Rollback plan** — ability to revert deployments
- **Secret rotation** — rotatable without downtime

---

## 13. Migration Plan (Workshop17 → Proximity Green)

### Phase 1: Foundation
- [ ] Router pattern for worker (support many endpoints)
- [ ] Fix RLS policies
- [ ] Fix XSS and injection issues
- [ ] Extract shared utilities
- [ ] Set up CI/CD

### Phase 2: Core Features
- [ ] Organisations CRUD
- [ ] Contacts CRUD
- [ ] Leads pipeline with categories and activities
- [ ] Dashboard with three-column layout
- [ ] Real-time updates via Supabase

### Phase 3: Operations
- [ ] Proposals (create, accept, track)
- [ ] Memberships management
- [ ] Schedule / onboarding task management
- [ ] User assignments and notifications

### Phase 4: Integrations
- [ ] Xero invoices, quotes, POs (already built)
- [ ] Email notifications (Mailgun — already built)
- [ ] PDF generation and download
- [ ] Catalog item management (already built)

### Phase 5: Polish
- [ ] Reporting / analytics dashboards
- [ ] Bulk operations
- [ ] Export (CSV, PDF)
- [ ] Mobile responsive optimisation
- [ ] Performance optimisation
