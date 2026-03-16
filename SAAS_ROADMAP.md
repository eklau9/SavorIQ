# SavorIQ — SaaS Registration & Onboarding Roadmap

> This document describes the full self-service registration flow for business owners
> and how Ed (admin/operator) manages the platform behind the scenes.

---

## Two Roles

| Role | Access | How They Log In |
| :--- | :--- | :--- |
| **Admin (Ed)** | All locations, sync, search, quotas, tenant management | `X-Access-Key` header (existing) |
| **Business Owner** | Their ONE store only — dashboard, reviews, guests, intercepts | Email + password (Supabase Auth) |

---

## Owner Registration Flow (Self-Service)

```
1. Owner visits landing page (e.g., savoriq.com)
2. Clicks "Get Started" → Sign Up with email/password
3. Enters business name + city
4. System auto-discovers their Google & Yelp pages
5. Owner confirms: "Yes, that's my store"
6. Stripe Checkout → Selects plan → Pays
7. Reviews auto-sync in background
8. Owner lands on their dashboard — ready to use
```

---

## Build Phases

### Phase 1: Auth System
- **What**: Supabase Auth for email/password signup and login
- **Backend**: JWT token validation middleware, role field (`admin` vs `owner`)
- **Mobile**: Login/signup screens, token storage, auto-redirect
- **Testing**: Use incognito window to sign up as a test owner

### Phase 2: Role-Based UI
- **What**: Owners see only their store — no search, no switching, no admin tools
- **Backend**: Middleware that maps authenticated user → their `restaurant_id`
- **Mobile**: Hide admin-only features (restaurant switcher, Operator Tools, search)
- **Testing**: Log in as test owner — verify restricted UI

### Phase 3: Onboarding Flow
- **What**: After signup, owner enters business name + city → system finds Google/Yelp → confirms → auto-syncs
- **Backend**: Reuse existing `/api/sync/search` and `/api/sync/apify-reviews` endpoints
- **Mobile**: Multi-step wizard screens (business info → confirm listing → syncing progress)
- **Testing**: Go through full wizard as test owner

### Phase 4: Stripe Billing
- **What**: Payment before dashboard access. Subscription management.
- **Backend**: Stripe Checkout Sessions, Webhooks for payment events, plan storage in DB
- **Mobile**: Paywall screen between onboarding and dashboard
- **Plans** (define later): e.g., Basic ($X/mo), Pro ($X/mo)
- **Testing**: Use Stripe test mode (fake card: `4242 4242 4242 4242`)

### Phase 5: Tenant Lockdown (RLS)
- **What**: Row-level security in Supabase — even raw DB access can't cross tenants
- **Backend**: Supabase RLS policies per table, tied to the authenticated user's restaurant_id
- **Testing**: Try to query another tenant's data via API — verify it's blocked

### Phase 6: Error Alerting
- **What**: "Report Issue" button in the app → sends Ed a notification
- **Backend**: `/api/support/report` endpoint → posts to Slack webhook or sends email
- **Mobile**: Simple form: description + optional screenshot
- **Testing**: Submit a test report, verify it arrives in Slack/email

---

## How to Test as a Business Owner

Once Phase 1 (Auth) is built:

1. **Open an incognito/private browser window** (this keeps your admin session separate)
2. Go to `http://localhost:8081` (or production URL)
3. You'll see the **login/signup screen** (instead of the dashboard)
4. Sign up with a test email (e.g., `testowner@example.com`)
5. Go through the onboarding flow as if you're a business owner
6. Verify you can ONLY see the store assigned to that account
7. Verify admin features are hidden (no switcher, no Operator Tools)

**Your admin session** stays untouched in your regular browser — you can compare side-by-side.

---

## Current State (What's Already Done)

- ✅ Data isolation via `restaurant_id` on every table
- ✅ API scoping via `X-Restaurant-ID` header
- ✅ Restaurant switcher in mobile app
- ✅ Review sync (Google + Yelp via Apify)
- ✅ Sentiment analysis pipeline
- ✅ Admin quota dashboard
- ❌ User accounts / auth
- ❌ Role-based UI restrictions
- ❌ Self-service onboarding wizard
- ❌ Stripe billing
- ❌ Row-level security
- ❌ Error alerting
