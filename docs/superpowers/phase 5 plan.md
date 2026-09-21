# Phase 4 — Commercialization Development Plan

## 1. Overview

This phase converts Nova AI from a quota/access-tier based chatbot into a prepaid commercial product.

The original business brief described subscription plans such as Free / Pro / Enterprise. During architecture decisions, this model was intentionally simplified for v1.

The v1 commercial model is:

> **Prepaid Credits + Credit Purchases + Usage-based Billing + Payment Gateway + Chat Sharing**

There is no recurring subscription system in v1.

A future subscription system may later be layered on top of the same credit and usage architecture.

---

# 2. Current Project State

The current codebase already contains several concepts that partially overlap with the new commercial model.

### Existing authentication and authorization

The backend currently has:

```text
User
 ├── role: user | admin
 └── accessTier: free | commercial
```

The admin role is used by `JwtAuthGuard` + `RolesGuard`.

The frontend also currently has separate user and admin routes/login flows.

The `accessTier` concept was introduced to control access to commercial models.

### Existing model access control

Models currently have:

```text
visibility:
  public
  commercial
  private
```

`ModelAccessService` combines model visibility with the user's `accessTier`.

### Existing quota system

The project currently contains:

```text
Quota
QuotaRule
```

with token limits and rolling quota usage.

Quota rules currently distinguish:

```text
free
commercial
```

### Existing usage system

The project already has `UsageRecord` containing:

```text
promptTokens
completionTokens
totalTokens
estimatedCost
searchCredits
status
attempts
messageId
conversationId
modelId
providerId
```

Usage records are already created/finalized around streaming.

### Existing model pricing

Models currently have:

```text
inputPricePer1k
outputPricePer1k
```

and these values represent USD-based pricing.

### Existing Web Search integration

Web Search is already integrated into the Chat flow and usage records contain a `searchCredits` field.

### Existing reasoning support

Reasoning capability/configuration and reasoning streaming already exist in the project.

Therefore, Phase 4 should extend and migrate the existing systems rather than introducing parallel implementations.

---

# 3. Target Commercial Model

The target v1 architecture is:

```text
User
 │
 ├── Wallet
 │     └── Credit Balance
 │
 ├── Payments
 │     └── Credit Purchases
 │
 └── Usage
       ├── LLM Usage
       └── Web Search Usage
```

The core commercial flow is:

```text
User
  │
  │ Buy Credits
  ▼
Credit Purchase
  │
  ▼
Payment
  │
  ▼
Fake Zibal
  │
  ▼
Callback + Verify
  │
  ▼
Payment SUCCESS
  │
  ▼
Credits Granted
```

Chat usage then consumes credits:

```text
Chat Request
    │
    ▼
LLM Streaming
    │
    ├── Input Tokens
    ├── Output Tokens
    └── Reasoning Tokens
    │
    ▼
Usage Calculation
    │
    ▼
Credit Cost
    │
    ▼
Wallet Deduction
```

Web Search follows the same commercial billing abstraction:

```text
Web Search
    │
    ▼
Fixed Cost
    │
    ▼
Credit Cost
    │
    ▼
Wallet Deduction
```

---

# 4. Business Decisions Already Closed

The following decisions are considered fixed for this phase.

## 4.1 Credit

Credits are the primary usage/accounting unit.

Credits may be fractional.

Example:

```text
100 Credits
94.35 Credits
5.7 Credits
```

## 4.2 Credit Price

The value of one Credit is configured at deployment level.

Example:

```text
CREDIT_PRICE_TOMAN=100
```

The Admin UI must display the current value as read-only.

The Admin must not be able to modify this value from the application UI.

The value should not be modeled as an editable database setting.

---

## 4.3 Credit Expiration

Credits never expire in v1.

---

## 4.4 Credit Packages

Users can purchase predefined packages.

Example:

```text
100 Credits
500 Credits
1000 Credits
```

Custom credit quantity may also be supported.

There are no package discounts in v1.

For the initial implementation:

```text
package price = credits × current credit price
```

---

## 4.5 Model Pricing

Each model has independently configurable:

```text
Input price / 1M tokens
Output price / 1M tokens
```

Admin can modify these prices.

Credit cost is derived from:

```text
model token price
+
credit price
```

Admin does not manually maintain a second model-level credit price.

---

## 4.6 Reasoning Billing

Reasoning usage is tracked separately when the provider reports it.

For billing:

```text
billable output tokens =
    output tokens
    +
    reasoning tokens
```

Reasoning is billed using the model's output-token price.

If the provider does not report reasoning usage:

```text
reasoningTokens = 0
```

No independent reasoning price exists in v1.

---

## 4.7 Web Search Pricing

Web Search has a fixed price per search operation.

Initial configuration:

```text
WEB_SEARCH_PRICE_TOMAN=1000
```

The system does not differentiate based on:

* number of URLs
* extraction operations
* number of results
* search provider internals
* token usage inside search

All Web Search operations use the same price in v1.

---

## 4.8 Billing and Streaming

Usage is calculated by the backend during streaming.

If the server successfully completes the generation, the usage becomes billable.

If the client disconnects after the server has completed generation:

```text
generation completed
→ usage is persisted
→ assistant message is persisted
→ client may recover the message
```

The user must not be charged again during recovery.

---

## 4.9 Recover vs Regenerate

These are different operations.

### Recover / Refresh

```text
Existing generation
→ fetch persisted message
→ no new generation
→ no new charge
```

### Regenerate

```text
New generation
→ new provider request
→ new usage
→ new charge
```

---

## 4.10 Server-side Failure

If the server/provider generation fails before successful completion:

```text
generation incomplete
→ no user credit deduction
```

Existing reliability mechanisms should continue to preserve the appropriate message state.

---

## 4.11 Credit Exhaustion During Streaming

A stream receives a maximum additional allowance of:

```text
5 Credits
```

If the generation exceeds the user's available balance plus this allowance:

```text
stop generation
save partial message
notify user
```

Any cost beyond the amount that can be charged is ignored.

The resulting partial assistant message remains persisted.

---

## 4.12 Payment Idempotency

Duplicate payment callbacks/events must never:

* grant credits twice
* create duplicate successful business effects
* corrupt payment state

The payment flow must be idempotent.

---

## 4.13 Payment History

Payment history is required.

A separate full credit ledger is intentionally out of scope for v1.

---

# 5. Phase Structure

The implementation is divided into five major phases.

```text
Phase 1
Commercial Foundation & Migration
        │
        ├───────────────┐
        ▼               ▼
Phase 2             Phase 3
Payment             LLM Billing
        │               │
        └───────┬───────┘
                ▼
             Phase 4
        Web Search Billing
                │
                ▼
             Phase 5
       Sharing + Audit + UX
```

Phase 1 establishes the contracts required by the remaining phases.

Phase 2 and Phase 3 can be developed in parallel after Phase 1 contracts are stable.

Phase 4 depends primarily on the billing contracts from Phase 1.

Phase 5 integrates the completed commercial capabilities.

---

# Phase 1 — Commercial Foundation & Legacy Model Migration

## Goal

Establish the Credit-based commercial foundation and remove/replace the parts of the previous quota/access-tier architecture that no longer represent the v1 business model.

This phase is primarily a backend/domain migration with the necessary frontend contract changes.

---

## 1.1 Remove the User Access Tier

The existing:

```text
User.accessTier
```

is no longer part of the v1 business model.

The distinction:

```text
free
commercial
```

must not continue to determine user entitlement.

The Admin API for manually changing a user's access tier should be removed.

The corresponding frontend Admin Users functionality should also be removed.

The remaining user authorization concept is:

```text
role:
  user
  admin
```

The `admin` role remains because administrative access is still required.

---

## 1.2 Replace Model Access Semantics

The existing:

```text
public
commercial
private
```

visibility model was designed around the previous access-tier architecture.

It must be reviewed and migrated to a model that does not depend on `User.accessTier`.

The target architecture should distinguish between:

* models available to normal users
* models restricted to administrative/private use

The exact final visibility vocabulary should be kept minimal and should not introduce subscription tiers.

---

## 1.3 Remove Token Quota as the Primary Billing Mechanism

The existing:

```text
Quota
QuotaRule
tokenLimit
tokenUsed
```

system was designed for monthly token quotas.

It should no longer determine whether a normal user may consume the product.

The Chat request path must eventually use Credit balance instead.

Existing quota code should be removed or isolated only where required for migration compatibility.

Do not maintain two competing commercial limits:

```text
Token Quota
+
Credit Wallet
```

for the same user in v1.

---

## 1.4 Introduce Credit Wallet

Create a minimal wallet model containing the user's current Credit balance.

The wallet must support fractional Credit values.

Avoid JavaScript floating-point arithmetic for financial/accounting operations.

The implementation should use a deterministic fixed-precision representation, such as integer subunits or a PostgreSQL decimal/numeric representation with explicit rounding rules.

---

## 1.5 Credit Configuration

Introduce deployment-level configuration:

```text
CREDIT_PRICE_TOMAN
WEB_SEARCH_PRICE_TOMAN
```

These values are not editable through Admin APIs.

The application should expose the effective Credit price to the Admin UI as read-only information.

---

## 1.6 Migrate Model Pricing

Replace the current USD / 1K-token model pricing semantics with the new v1 business pricing:

```text
input price / 1M tokens
output price / 1M tokens
```

The model entity and Admin DTO/UI must be updated accordingly.

Historical usage must retain the actual charged cost rather than being recalculated using future model prices.

---

## 1.7 Adapt Existing Usage Records

Existing `UsageRecord` infrastructure should be reused.

The record should evolve from:

```text
estimatedCost in USD
searchCredits
```

toward the new commercial accounting representation.

It should be capable of recording at least:

```text
inputTokens
outputTokens
reasoningTokens
chargedCost
chargedCredits
status
messageId
modelId
providerId
```

The implementation must preserve the distinction between:

```text
provider-reported usage
```

and:

```text
actual amount charged to the user
```

---

## 1.8 Phase 1 Integration Contract

The phase must provide stable services/contracts similar to:

```text
WalletService
PricingService
UsagePricingService
```

Other phases must not directly manipulate wallet/database internals.

Example conceptual operations:

```text
getBalance(userId)

calculateLlmCost({
  modelId,
  inputTokens,
  outputTokens,
  reasoningTokens
})

calculateWebSearchCost()

deductCredits(...)

grantCredits(...)
```

The exact API should be decided during implementation planning.

---

## Phase 1 Acceptance Criteria

* No user `accessTier` is required for normal authorization.
* Admin role continues to work.
* Token quota is no longer the primary entitlement mechanism.
* Credit balance exists for users.
* Credit price is deployment-configured and read-only in Admin UI.
* Model pricing uses Toman / 1M input/output tokens.
* Existing usage infrastructure is migrated instead of duplicated.
* Reasoning usage can be stored separately.
* Historical usage is not recalculated when model pricing changes.
* Phase 2–4 can consume the commercial billing contracts without accessing persistence details directly.

---

# Phase 2 — Payment & Credit Purchase

## 1. Goal

Implement a realistic end-to-end Credit purchase flow using a Zibal-like payment gateway integration.

The implementation must simulate the behavior of a real external payment gateway rather than mocking payment inside the Nova backend.

The final development flow must be:

```text
User
  │
  │ selects Credit amount
  ▼
Nova Frontend
  │
  │ POST /credit-purchases
  ▼
Nova Backend
  │
  ├── create CreditPurchase
  ├── create Payment
  └── request payment from PaymentProvider
              │
              ▼
        Fake Zibal HTTP Service
              │
              └── returns trackId
  │
  ▼
Nova Backend returns payment URL
  │
  ▼
Browser redirects to Fake Zibal
  │
  ▼
Fake Zibal Payment Page
  │
  ├── Success
  ├── Failure
  ├── Cancellation
  └── Timeout
  │
  ▼
Fake Zibal redirects/calls Nova callback URL
  │
  ▼
Nova Callback Endpoint
  │
  ├── locate payment by provider trackId
  ├── do NOT trust callback success parameters
  └── call PaymentProvider.verify(trackId)
              │
              ▼
        Fake Zibal Verify API
              │
              ▼
        Verified Payment Result
  │
  ▼
Nova validates:
  ├── payment identity
  ├── payment amount
  ├── provider
  ├── transaction status
  └── current local payment state
  │
  ▼
Atomic database transaction
  ├── mark Payment SUCCESS
  └── grant Credits exactly once
  │
  ▼
User receives successful payment result
```

The core principle is:

> **The browser callback is a notification that the payment flow returned. It is not the source of truth. The provider verification result is the source of truth.**

---

# 2. Zibal Integration Model

The implementation should follow the structure of the Zibal IPG API.

The documented/observed standard flow is:

```text
POST /v1/request
        ↓
trackId
        ↓
GET /start/{trackId}
        ↓
user payment
        ↓
callback
        ↓
POST /v1/verify
        ↓
payment result
```

Zibal's official Node.js SDK exposes the same conceptual operations:

* `request(amount, extras)`
* `startURL(trackId)`
* `verify(trackId)`

and its request response includes `trackId` and a result code; the verify response contains payment information including the amount and result.

For Nova, the real Zibal API must be replaced in development by the Fake Zibal service.

---

# 3. Architecture

The architecture must have a provider boundary.

```text
                    Nova Backend
                         │
                  PaymentService
                         │
                  PaymentProvider
                         │
                ┌────────┴────────┐
                │                 │
          FakeZibalProvider    Future:
                │               ZibalProvider
                ▼
        Fake Zibal HTTP API
```

`PaymentService` must contain Nova's business rules.

`PaymentProvider` must contain gateway-specific communication.

`FakeZibalProvider` must only know how to communicate with the Fake Zibal API.

This means the following logic must NOT live inside the Fake Zibal client:

* Credit granting
* Payment ownership
* Nova payment state transitions
* Wallet updates
* Idempotency of Credit grants
* Nova database transactions

---

# 4. Domain Model

## 4.1 CreditPurchase

Represents the business intent to purchase Credits.

Example:

```text
CreditPurchase
-------------------------
id
userId
credits
pricePerCredit
amount
currency
status
paymentId
createdAt
completedAt
```

The purchase must snapshot the commercial values used at creation time.

For example, if:

```text
1 Credit = 100 Toman
```

and the user buys:

```text
500 Credits
```

the purchase should retain:

```text
credits = 500
pricePerCredit = 100
amount = 50,000
```

Future configuration changes must not alter historical purchases.

---

# 4.2 Payment

Represents the external money transaction.

Suggested fields:

```text
Payment
-------------------------
id
creditPurchaseId
userId
provider
status
amount
currency
providerTrackId
providerReference
providerStatus
providerRawData
createdAt
updatedAt
paidAt
```

The exact fields may be adjusted to match the existing project conventions.

The important distinction is:

```text
CreditPurchase
    =
what the user is buying

Payment
    =
how the money transaction is processed
```

---

# 5. Money Unit

Zibal expects payment amounts in Rial.

The Nova business configuration uses Toman.

Therefore the conversion boundary must be explicit.

Example:

```text
Nova:
50,000 Toman

        ↓ provider adapter

Zibal:
500,000 Rial
```

The conversion must happen inside the provider integration boundary.

Do not scatter:

```text
× 10
÷ 10
```

throughout PaymentService, controllers, or frontend code.

Nova's internal business amount should remain in its chosen canonical unit.

The provider adapter is responsible for converting to the provider's required unit.

---

# 6. Payment Creation Flow

## Step 1 — User selects Credits

The frontend displays configured packages and/or custom Credit quantity.

Example:

```text
100 Credits
500 Credits
1000 Credits
Custom
```

The frontend must not calculate the authoritative payment amount.

It may display an estimate.

The backend must calculate:

```text
credits × current credit price
```

---

## Step 2 — Create Credit Purchase

Frontend:

```http
POST /credit-purchases
```

Example request:

```json
{
  "credits": 500
}
```

The backend:

1. authenticates the user;
2. validates the requested Credit quantity;
3. reads the current Credit price;
4. calculates the authoritative amount;
5. creates the CreditPurchase;
6. creates a pending Payment;
7. requests a payment from the provider.

The backend must never accept the final payable amount from the client as authoritative input.

---

# 7. Zibal Request

The provider adapter should conceptually call:

```http
POST /v1/request
Content-Type: application/json
```

with data equivalent to:

```json
{
  "merchant": "MERCHANT_ID",
  "amount": 500000,
  "callbackUrl": "https://nova.example.com/payments/zibal/callback",
  "description": "Nova AI Credit Purchase",
  "orderId": "nova-purchase-id"
}
```

`mobile` may be included if the Nova project has a verified user phone number.

The Zibal API supports the merchant, amount and callback URL as core request parameters, with fields such as description, mobile and order ID available for additional transaction context.

The Fake Zibal service should implement the same contract.

---

# 8. Request Response

A successful request should return a structure equivalent to:

```json
{
  "result": 100,
  "message": "success",
  "trackId": 123456789
}
```

The official Zibal Node.js SDK documents `trackId`, `result`, `message`, and `statusMessage` in the request response.

Nova must:

1. verify the request result;
2. require a valid `trackId`;
3. persist the provider track ID;
4. keep the local Payment in `PENDING`;
5. construct the payment page URL.

The payment URL should be conceptually:

```text
{FAKE_ZIBAL_BASE_URL}/start/{trackId}
```

For real Zibal, the corresponding URL is:

```text
https://gateway.zibal.ir/start/{trackId}
```

The provider adapter must construct this URL rather than the frontend hardcoding it.

---

# 9. Payment Redirect

The backend returns the payment URL to the frontend.

Example:

```json
{
  "paymentId": "payment-id",
  "status": "PENDING",
  "paymentUrl": "http://fake-zibal:4001/start/123456789"
}
```

The frontend redirects the browser to this URL.

The frontend must not call Fake Zibal directly.

The flow is:

```text
Browser
   ↓
Nova
   ↓
Nova returns paymentUrl
   ↓
Browser
   ↓
Fake Zibal
```

---

# 10. Fake Zibal Payment Page

Fake Zibal must provide a real HTTP page.

Example:

```text
/start/:trackId
```

The page should display enough information to simulate a real payment page:

```text
Nova AI
Payment Amount
Merchant / Description
Transaction / Track ID

[ Pay Successfully ]
[ Fail Payment ]
[ Cancel ]
[ Simulate Timeout ]
```

The payment page is intentionally fake.

No real card data should be collected or processed.

---

# 11. Fake Zibal Transaction State

Fake Zibal should maintain its own transaction state.

Example:

```text
FakeZibalTransaction
-------------------------
trackId
merchant
amount
callbackUrl
orderId
status
createdAt
paidAt
referenceNumber
```

Possible internal states:

```text
CREATED
PAID
FAILED
CANCELLED
```

Optional:

```text
VERIFYING
```

is not required unless implementation needs it.

The important architectural rule is:

> Fake Zibal owns the simulated external payment state. Nova owns the application's payment state.

---

# 12. Successful Payment

When the user selects:

```text
Pay Successfully
```

Fake Zibal should:

1. mark its transaction as paid;
2. generate a fake provider reference number;
3. redirect the browser to the stored callback URL;
4. include provider callback parameters.

The callback should contain at least:

```text
trackId
status
success
```

The exact callback shape should mimic the relevant Zibal behavior used by the project.

Public integration examples show Zibal returning to the callback with `trackId`, `success`, and `status`, with successful payment commonly represented by a payment status of `2` before server-side verification.

---

# 13. Callback Must Not Grant Credits

This is a critical requirement.

When Nova receives:

```http
GET /payments/zibal/callback?trackId=123&status=2
```

it must NOT do:

```text
status == 2
    ↓
grant Credits
```

Instead:

```text
callback
   ↓
find local Payment
   ↓
call provider.verify(trackId)
   ↓
validate provider response
   ↓
grant Credits
```

The callback parameters are untrusted external input.

The provider verification response is the authoritative payment confirmation.

---

# 14. Callback Processing

## Step 1 — Validate Track ID

Nova must require:

```text
trackId
```

If missing:

```text
400 Bad Request
```

or an appropriate application-level failure response.

---

## Step 2 — Locate Local Payment

Search by:

```text
provider = ZIBAL
providerTrackId = trackId
```

If no payment exists:

```text
404 / unknown payment
```

Do not create a new Payment from callback data.

---

# 15. Already Completed Payment

If the Payment is already:

```text
SUCCESS
```

the callback must be treated as an idempotent repeat.

It must:

* not call Credit grant again;
* not change the successful Payment;
* return an appropriate successful/idempotent response.

This allows:

```text
callback #1
callback #2
callback #3
```

without corrupting the account.

---

# 16. Verify Payment

For a pending payment, Nova calls:

```http
POST /v1/verify
Content-Type: application/json
```

with:

```json
{
  "merchant": "MERCHANT_ID",
  "trackId": 123456789
}
```

The official Zibal SDK exposes verification by `trackId`, and the verification result includes payment information such as `amount`, `result`, and payment status information.

---

# 17. Verify Result

A successful verification should be represented by:

```text
result == 100
```

The provider result must be checked rather than assuming HTTP 200 means successful payment.

For example, Zibal integrations document:

```text
100 = successful operation
202 = payment failed / unpaid
203 = invalid trackId
```

and `201` can represent an already-processed verification.

The Fake Zibal must reproduce the important semantics needed by Nova rather than merely returning HTTP success/failure.

---

# 18. Amount Verification

This is mandatory.

Nova must compare:

```text
expected payment amount
```

against:

```text
verified provider amount
```

Example:

```text
Local Payment:
500,000 Rial

Verify response:
500,000 Rial
```

→ valid.

But:

```text
Local Payment:
500,000 Rial

Verify response:
400,000 Rial
```

→ invalid payment.

Nova must not grant the purchased Credits.

The amount comparison must use the canonical provider-unit amount stored when the Payment was created.

Do not trust:

* frontend amount
* callback amount
* current Credit price
* current package price

for verification of an already-created payment.

---

# 19. Payment Identity Verification

Nova should verify all relevant identities:

```text
provider = ZIBAL
trackId matches local Payment
merchant is configured correctly
verified amount matches expected amount
provider verification indicates successful payment
```

If the provider returns an order identifier, it should also be checked against the local purchase where applicable.

---

# 20. Atomic Credit Grant

After successful verification:

```text
BEGIN TRANSACTION

  lock/load Payment

  if Payment is already SUCCESS:
      return idempotently

  mark Payment SUCCESS

  grant purchased Credits

  persist provider reference/payment metadata

COMMIT
```

The Payment state transition and Credit grant must be part of the same database transaction.

This is the core protection against:

```text
duplicate callback
concurrent callbacks
retry after timeout
two requests processing same payment
```

---

# 21. Exactly-Once Business Effect

The implementation must guarantee:

```text
One successful payment
        ↓
One Credit grant
```

Not:

```text
One callback
        ↓
One grant
```

because a real external gateway may invoke the callback more than once.

The invariant is based on the Payment's persisted identity/state.

A useful constraint should exist at the database level where appropriate, for example a unique provider transaction identity:

```text
(provider, providerTrackId)
```

The exact database constraint should follow the project's ORM conventions.

---

# 22. Concurrent Callback Scenario

The Fake Zibal must be able to intentionally send duplicate callbacks.

Example:

```text
Callback A ─────┐
                ├── Nova
Callback B ─────┘
```

Both requests may arrive at almost the same time.

The implementation must guarantee:

```text
Payment = SUCCESS
Credit granted = exactly once
```

This should be tested with concurrent requests rather than only sequential duplicate callbacks.

---

# 23. Verify Retry

The callback handler must distinguish between:

### Provider says payment succeeded

```text
result = 100
```

→ finalize payment.

### Provider says payment failed

```text
result = 202
```

→ mark payment failed according to the local state model.

### Provider cannot currently be verified

For example:

```text
Fake Zibal unavailable
network timeout
temporary provider error
```

Do not grant Credits.

The payment should remain recoverable, typically as:

```text
PENDING
```

or an equivalent intermediate state.

Do not incorrectly mark it as `FAILED` merely because verification was temporarily unavailable.

A later retry/reconciliation mechanism can verify it.

For v1, a manual retry endpoint or controlled test flow is sufficient; a background reconciliation worker is not required unless the existing architecture already has one.

---

# 24. Payment State Machine

The local Payment state should represent the application lifecycle.

Recommended:

```text
PENDING
   │
   ├── provider request fails
   │        ↓
   │      FAILED
   │
   └── callback
          │
          ▼
       VERIFY
       /     \
      /       \
 SUCCESS      FAILED
   │            │
   ▼            ▼
SUCCESS       FAILED
```

Important:

A temporary verification/network failure should not automatically become a business-level failed payment.

It should remain recoverable.

---

# 25. Cancellation

If the user cancels the Fake Zibal payment:

```text
Fake Zibal
   ↓
callback
   ↓
Nova
```

Nova must not grant Credits.

The local payment may become:

```text
CANCELLED
```

if the callback/provider state confirms cancellation.

The purchase remains without a Credit grant.

---

# 26. Failed Payment

If the fake payment fails:

```text
Fake Zibal
   ↓
FAILED
   ↓
callback
```

Nova must:

```text
Payment = FAILED
Credits granted = 0
```

The user should be able to see the failed payment in payment history.

---

# 27. Timeout Scenario

Fake Zibal should support a deterministic timeout simulation.

Two useful cases:

### Case A — User never completes payment

Payment remains:

```text
PENDING
```

No Credits are granted.

### Case B — Nova cannot reach Fake Zibal during verification

Payment remains recoverable.

No Credits are granted until successful verification.

This allows the Agent to test the difference between:

```text
payment failed
```

and:

```text
payment status unknown
```

---

# 28. Provider Error Mapping

Do not expose raw Zibal-specific error codes throughout the Nova application.

The provider adapter should map provider responses into normalized concepts.

Example:

```text
Zibal result 100
    ↓
PaymentVerificationResult.SUCCESS

Zibal result 202
    ↓
PaymentVerificationResult.NOT_PAID

Zibal result 203
    ↓
PaymentVerificationResult.INVALID_TRANSACTION

network timeout
    ↓
PaymentVerificationResult.PROVIDER_UNAVAILABLE
```

The exact enum names are implementation details.

This allows Nova's PaymentService to remain provider-agnostic.

---

# 29. Fake Zibal API

The Fake Zibal should expose a minimal API that resembles the real integration.

## Request

```http
POST /v1/request
```

Input:

```json
{
  "merchant": "nova-dev",
  "amount": 500000,
  "callbackUrl": "http://nova-backend/payments/zibal/callback",
  "description": "Nova AI Credit Purchase",
  "orderId": "purchase-id"
}
```

Output:

```json
{
  "result": 100,
  "message": "success",
  "trackId": 123456789
}
```

---

## Start

```http
GET /start/:trackId
```

Returns the fake payment UI.

---

## Verify

```http
POST /v1/verify
```

Input:

```json
{
  "merchant": "nova-dev",
  "trackId": 123456789
}
```

Successful output should contain enough information to emulate Zibal verification:

```json
{
  "result": 100,
  "message": "success",
  "status": 1,
  "trackId": 123456789,
  "amount": 500000,
  "paidAt": "2026-09-19T20:00:00Z",
  "refNumber": "FAKE-123456"
}
```

The exact response shape should follow the relevant Zibal fields rather than inventing an unrelated gateway protocol. The official SDK documents verification fields including `paidAt`, `amount`, `result`, and status information.

---

# 30. Fake Zibal Test Controls

The simulator should support deterministic test scenarios.

The payment page can expose:

```text
[ Success ]
[ Fail ]
[ Cancel ]
[ Timeout ]
[ Duplicate Callback ]
[ Verify Failure ]
[ Amount Mismatch ]
```

Not every scenario needs to be exposed to normal users.

A development-only control panel or query/test mechanism may be used.

The important requirement is deterministic reproducibility.

---

# 31. Amount Mismatch Test

Fake Zibal should be capable of returning a verified amount different from the local Payment amount.

Example:

```text
Nova expected:
500,000 Rial

Fake Zibal verifies:
400,000 Rial
```

Expected behavior:

```text
Payment != SUCCESS
Credits = unchanged
Audit/error information = recorded
```

This test is important because it verifies that Nova does not blindly trust the provider's success status.

---

# 32. Duplicate Callback Test

Fake Zibal should support:

```text
POST/redirect callback
POST/redirect callback
```

or equivalent repeated callback delivery.

Expected:

```text
Payment SUCCESS
Credits granted once
```

---

# 33. Duplicate Verify Test

Calling:

```text
POST /v1/verify
```

multiple times for the same successful Fake Zibal transaction should reproduce the relevant "already processed / already verified" semantics where applicable.

Nova must remain idempotent regardless.

The official Zibal integrations document `201` as "processed before" for relevant payment operations.

---

# 34. Frontend Flow

The frontend should implement:

```text
Wallet
   ↓
Buy Credits
   ↓
Select package/custom amount
   ↓
Confirm purchase
   ↓
Create payment
   ↓
Redirect to paymentUrl
   ↓
Fake Zibal UI
   ↓
Return to Nova
   ↓
Payment result page
```

The frontend must not determine whether payment succeeded.

After returning from the provider, it should fetch/read the local Payment status from Nova.

---

# 35. Payment Result Page

Possible states:

```text
SUCCESS
FAILED
CANCELLED
PENDING
```

### SUCCESS

Display:

```text
Payment successful
Credits added: 500
Tracking ID: ...
New balance: ...
```

### FAILED

Display:

```text
Payment failed
```

with payment details.

### CANCELLED

Display:

```text
Payment cancelled
```

### PENDING

Display:

```text
Payment is being verified
```

and allow the user to revisit payment history.

Do not display success merely because the browser returned from the gateway.

---

# 36. Payment History

## User

The user can see:

```text
Date
Credit amount
Amount paid
Status
Provider
Tracking ID
```

Clicking a payment should display its details.

---

## Admin

Admin can see:

```text
User
Date
Credit amount
Amount
Status
Provider
Track ID
Provider reference
```

Admin should not be able to manually mark arbitrary payments as successful in v1.

Payment success must come from the provider verification flow.

---

# 37. Security Rules

The implementation must follow these rules.

### Never trust frontend amount

```text
client amount
     ≠
authoritative amount
```

Backend recalculates the amount.

### Never trust callback success

```text
callback success
     ≠
payment success
```

### Never grant Credits before verification

```text
request
     ≠
paid
```

### Never trust provider-reported amount without comparison

```text
verified amount
        ==
expected provider amount
```

### Never grant Credits outside an idempotent transaction

```text
Payment SUCCESS
+
Credit Grant
```

must be atomic.

---

# 38. Observability

The payment flow should produce structured logs around:

```text
purchase_created
payment_created
provider_request_started
provider_request_succeeded
provider_request_failed
payment_redirected
payment_callback_received
payment_verification_started
payment_verification_succeeded
payment_verification_failed
credit_grant_started
credit_grant_completed
duplicate_callback_detected
amount_mismatch_detected
```

Never log:

* card numbers
* sensitive payment credentials
* secrets
* merchant credentials

Provider track IDs and fake reference IDs may be logged where useful.

---

# 39. Testing Requirements

The Agent must implement integration/e2e tests for at least these scenarios.

### Happy path

```text
Create purchase
→ request
→ redirect
→ pay
→ callback
→ verify
→ SUCCESS
→ Credits granted
```

### Failed payment

```text
Create purchase
→ pay failure
→ callback
→ FAILED
→ no Credits
```

### Cancelled payment

```text
Create purchase
→ cancel
→ callback
→ CANCELLED
→ no Credits
```

### Duplicate callback

```text
callback
callback
callback
→ one Credit grant
```

### Concurrent duplicate callbacks

```text
callback A ─┐
            ├─→ one Credit grant
callback B ─┘
```

### Amount mismatch

```text
expected = 500,000
verified = 400,000
→ no Credits
```

### Verify failure

```text
callback
→ verify fails
→ no Credits
→ payment remains recoverable
```

### Provider unavailable

```text
callback
→ provider unavailable
→ no Credits
→ payment remains pending/recoverable
```

### Already successful payment

```text
Payment SUCCESS
→ callback again
→ no additional grant
```

### Invalid track ID

```text
callback unknown trackId
→ no Credit grant
```

### Request failure

```text
provider request fails
→ no usable payment URL
→ local purchase/payment handled consistently
```

---

# 40. Development Boundary

The Agent must not implement the following in this phase:

* Subscription plans
* Recurring billing
* Coupons
* Discounts
* Refund engine
* Multi-currency
* Credit expiration
* Credit ledger
* Complex invoicing
* Real card processing
* Real Zibal production integration
* Web Search billing
* LLM usage billing

Those belong to other phases or future work.

---

# 41. Expected End-to-End Demo

At the end of this phase, the following scenario must work from the browser:

```text
1. User opens Wallet.

2. User sees:
   Balance = 100 Credits

3. User chooses:
   Buy 500 Credits

4. Nova calculates:
   500 × current Credit price

5. Nova creates:
   CreditPurchase = 500 Credits
   Payment = PENDING

6. Nova calls Fake Zibal /v1/request.

7. Fake Zibal returns:
   trackId = 123456

8. Nova returns:
   paymentUrl

9. Browser opens:
   Fake Zibal payment page.

10. User clicks:
    Pay Successfully

11. Fake Zibal:
    marks transaction as PAID
    generates reference number
    redirects to Nova callback.

12. Nova receives:
    trackId + callback status.

13. Nova does NOT grant Credits yet.

14. Nova calls:
    Fake Zibal /v1/verify

15. Fake Zibal returns:
    result = 100
    amount = expected amount
    status = paid
    refNumber = ...

16. Nova atomically:
    Payment = SUCCESS
    +500 Credits

17. User returns to Nova.

18. Nova fetches local Payment.

19. UI displays:
    Payment successful
    +500 Credits
    new balance = 600

20. Replaying the callback:
    does not grant another 500 Credits.
```

This entire flow must work with the Fake Zibal process running as a separate HTTP service.

---

# 42. Definition of Done

Phase 2 is complete when:

* Credit purchase exists as a domain concept.
* Payment exists as a separate domain concept.
* Payment provider abstraction exists.
* Fake Zibal is a separate HTTP service.
* Fake Zibal implements request/start/verify.
* Fake Zibal provides a simulated payment page.
* Browser redirect works.
* Callback works.
* Callback does not itself grant Credits.
* Provider verification is mandatory.
* Verified amount is compared against the expected amount.
* Payment state is persisted.
* Successful payment grants Credits exactly once.
* Duplicate and concurrent callbacks are safe.
* Payment history is available.
* Success/failure/cancel/pending states are represented.
* Provider failures do not accidentally grant Credits.
* The frontend never decides payment success.
* The Nova business layer does not depend directly on Fake Zibal.
* Replacing Fake Zibal with a real provider implementation would not require rewriting CreditPurchase business logic.

---


# Phase 3 — LLM Usage Billing & Streaming

## Goal

Connect the existing Chat streaming pipeline to Credit billing while preserving the reliability behavior already implemented in the project.

This phase should modify the existing Chat/Usage flow rather than creating a second generation pipeline.

---

## 3.1 Usage Calculation

At generation completion, usage is determined from provider-reported data:

```text
inputTokens
outputTokens
reasoningTokens
```

Billing:

```text
inputCost =
  inputTokens × inputPrice

outputCost =
  (outputTokens + reasoningTokens) × outputPrice
```

The exact unit conversion must use the model's configured:

```text
Toman / 1M tokens
```

price.

---

## 3.2 Reasoning

Reasoning remains a separate usage field.

Billing treats it as output:

```text
reasoningTokens → output price
```

If absent:

```text
reasoningTokens = 0
```

No separate reasoning price is introduced.

---

## 3.3 Streaming Lifecycle

The existing stream should become conceptually:

```text
request
  ↓
validate user/model
  ↓
start generation
  ↓
stream chunks
  ↓
track usage
  ↓
persist assistant message
  ↓
finalize usage
  ↓
calculate charge
  ↓
deduct credits
```

The implementation must preserve the project's existing disconnect-resilience behavior.

---

## 3.4 Successful Server Completion + Client Disconnect

If the backend completes the generation but the client disconnects:

```text
server completed
       ↓
message persisted
       ↓
usage persisted
       ↓
credits charged
```

The frontend must expose a recovery path.

---

## 3.5 Recovery

The frontend should detect an interrupted/missing stream and provide:

```text
Refresh / Recover
```

The operation fetches the already-persisted message.

It must not create a new provider generation.

It must not create a second charge.

---

## 3.6 Regeneration

The existing retry/regenerate behavior must be explicitly separated from recovery.

```text
Recover
→ read persisted result
→ no charge

Regenerate
→ new generation
→ new usage
→ new charge
```

---

## 3.7 Server Failure

If generation fails before successful completion:

```text
generation incomplete
→ no final user charge
```

Existing failed-generation persistence behavior should be preserved where appropriate.

---

## 3.8 Credit Exhaustion

A generation may temporarily use up to:

```text
current balance + 5 Credits
```

If that boundary is exceeded:

```text
stop generation
save partial assistant message
finalize the chargeable amount
notify the user
```

Any amount beyond what can actually be charged is ignored.

The partial message remains available to the user.

---

## 3.9 Idempotent Usage Charging

Charging must not occur twice for the same completed generation.

The implementation should use an existing stable usage/message identity to prevent duplicate finalization.

This is particularly important for:

```text
disconnect
retry
refresh
duplicate completion handling
```

---

## Phase 3 Acceptance Criteria

* Normal LLM generation deducts Credits based on actual usage.
* Input and output pricing are applied correctly.
* Reasoning is billed as output.
* Provider absence of reasoning usage is handled as zero.
* Successful server completion is billable even if client disconnects.
* Persisted messages can be recovered without another charge.
* Regeneration creates a new billable generation.
* Incomplete server-side generations do not create a final charge.
* Credit exhaustion produces a persisted partial response.
* Duplicate finalization cannot double-charge a generation.

---

# Phase 4 — Web Search Billing

## Goal

Integrate Web Search into the same commercial Credit system using a deliberately simple fixed price.

---

## 4.1 Fixed Search Price

Every Web Search operation has the same configured price:

```text
WEB_SEARCH_PRICE_TOMAN
```

Initial example:

```text
1000 Toman
```

No pricing based on:

* URL count
* extraction count
* result count
* provider cost
* search token usage

---

## 4.2 Billing Flow

```text
Web Search requested
       ↓
Search executed
       ↓
Search operation succeeds
       ↓
Fixed Toman price
       ↓
Convert to Credits
       ↓
Deduct from wallet
```

Failure semantics must be defined so failed/unexecuted searches are not accidentally charged.

---

## 4.3 Existing Search Integration

The existing Web Search implementation and Chat tool-call flow should be retained.

The existing `searchCredits` field should be migrated to represent the new commercial semantics rather than maintaining a second search billing system.

---

## Phase 4 Acceptance Criteria

* Web Search uses one fixed price.
* Price is deployment-configured.
* Successful searches consume the corresponding Credits.
* Failed/unexecuted searches do not accidentally consume Credits.
* Web Search uses the same wallet/billing abstraction as LLM usage.
* Search internals do not affect user pricing.

---

# Phase 5 — Chat Sharing, Audit Logging & Commercial UX

## Goal

Complete the user-facing commercial experience and add immutable auditability for sensitive operations.

---

# 5.1 Chat Snapshot Sharing

A user can share a conversation by creating a frozen snapshot.

Flow:

```text
Conversation
    ↓
User clicks Share
    ↓
Create immutable snapshot
    ↓
Generate public share identifier
    ↓
Public share page
```

The snapshot represents exactly the conversation state at the moment of sharing.

If new messages are added later:

```text
Original conversation:
A B C

Share at T1

Later:
A B C D E
```

The public snapshot remains:

```text
A B C
```

---

## 5.2 Snapshot Requirements

A shared snapshot must not dynamically read the current conversation state.

The public page must use the persisted snapshot.

The snapshot must be immutable after creation.

---

## 5.3 Audit Logging

Introduce audit logging for sensitive operations.

At minimum:

```text
payment created
payment succeeded
payment failed
credit granted
credit deducted
model pricing changed
model access/configuration changed
special administrative access
```

Audit records should identify:

```text
actor
action
target
timestamp
result
relevant metadata
```

Audit records must not be editable through normal application flows.

---

# 5.4 Commercial User UX

The frontend should expose:

### Wallet

```text
Current Balance
Buy Credits
```

### Payment

```text
Credit Packages
Custom Credit Purchase
Payment Status
Payment History
Payment Details
```

### Chat

```text
Credit Balance
Insufficient Credit feedback
Partial generation feedback
Recover interrupted generation
Regenerate
Share
```

### Shared Chat

Public snapshot page must not require the owner's authenticated session.

---

# 5.5 Commercial Admin UX

Admin should have:

### Models

* model pricing
* input price
* output price
* enabled/disabled
* model access configuration

### Payment

* payment history
* transaction status
* tracking ID
* purchased Credits

### Audit

* audit event list
* filtering
* actor
* action
* target
* timestamp

### Credit Configuration

Display:

```text
Credit Price
100 Toman / Credit
```

as **read-only**.

The Admin must not receive an API that modifies the deployment-level Credit price.

---

# 5.6 Legacy Frontend Cleanup

The existing frontend contains:

```text
Quota UI
Access-tier UI
Admin user access-tier management
```

These must be removed or replaced.

The existing Admin navigation should no longer contain functionality for manually promoting users between:

```text
free
commercial
```

because that entitlement model no longer exists.

The existing User/Chat UI should replace quota-oriented information with Credit balance and billing information.

---

# 5.7 Phase 5 Acceptance Criteria

* Users can create frozen conversation snapshots.
* Later conversation messages do not appear in existing snapshots.
* Public snapshot URLs work without exposing the private conversation.
* Sensitive commercial operations generate audit records.
* Users can view their Credit balance and payment history.
* Admins can inspect payments and audit events.
* Credit price is visible but not editable in Admin.
* Legacy quota/access-tier UI is removed.

---

# 6. Cross-Phase Architecture Rules

## 6.1 No Parallel Billing Systems

Do not create separate billing logic for:

```text
LLM
Web Search
Payment
```

All usage must eventually flow through shared billing primitives.

---

## 6.2 Payment Is Not Credit

Keep these concepts separate:

```text
Payment
= external money transaction

Credit Purchase
= business intent to acquire Credits

Wallet
= current available Credits

Usage
= consumption of Credits
```

The absence of a full immutable Credit Ledger in v1 does not mean these concepts should be collapsed into one entity.

---

## 6.3 Usage Is Not Payment

An LLM usage record describes consumption.

A Payment describes money movement.

They must not be represented by the same entity.

---

## 6.4 Historical Pricing Must Be Stable

Changing a model's current price must not modify historical charges.

A completed usage record must contain enough information to reconstruct:

```text
what was consumed
what price was applied
what amount was charged
```

Similarly, a completed payment must retain:

```text
amount paid
Credits purchased
```

independently from future configuration.

---

# 7. Recommended Development Order

The recommended implementation order is:

```text
1. Phase 1
   Migration + Commercial Foundation

2. Phase 2
   Payment + Credit Purchase

3. Phase 3
   LLM Billing + Streaming

4. Phase 4
   Web Search Billing

5. Phase 5
   Sharing + Audit + UX
```

For parallel Agent development:

```text
                 Phase 1
                    │
          ┌─────────┼─────────┐
          │         │         │
          ▼         ▼         ▼
       Phase 2   Phase 3   Phase 4
          │         │         │
          └─────────┼─────────┘
                    ▼
                 Phase 5
```

Phase 2 and Phase 3 should not be started before the Phase 1 contracts are stable.

After that, their implementation can proceed in parallel.

---

# 8. Main Migration Risks

The most important implementation risks are not new feature development. They are migrations from the previous architecture.

### Risk 1 — Access Tier

Current:

```text
User.accessTier
        ↓
ModelAccessService
        ↓
Model.visibility
```

Target:

```text
User.role
        ↓
Model access policy
```

The commercial Credit balance must not become another hidden access tier.

---

### Risk 2 — Quota + Credit Double Restriction

Current:

```text
Token quota
```

Target:

```text
Credit balance
```

Avoid accidentally requiring both.

---

### Risk 3 — Existing Usage Records

Usage tracking already exists and is integrated deeply with Chat streaming.

Do not replace it with a new `BillingUsage` system.

Extend/migrate the existing `UsageRecord`.

---

### Risk 4 — Existing Search Credits

Web Search already has usage accounting.

Migrate the existing implementation instead of adding another independent charge path.

---

### Risk 5 — Model Pricing

Current pricing is USD / 1K.

New pricing is:

```text
Toman / 1M input
Toman / 1M output
```

The migration must be explicit so old assumptions do not remain hidden in Chat, Usage, Admin APIs, or frontend formatting.

---

### Risk 6 — Streaming Billing

The existing project already contains disconnect/retry/recovery logic.

Billing must be integrated into that lifecycle rather than added as a simple:

```text
after request → deduct credits
```

operation.

The identity of a generation/usage record must remain stable enough to prevent duplicate charging.

---

# 9. Definition of Done for Phase 4

The commercialized Nova AI system is complete when:

```text
User
 │
 ├── has Credits
 │
 ├── can buy Credits
 │       ↓
 │    Fake Zibal
 │       ↓
 │    Payment
 │       ↓
 │    Credits granted once
 │
 ├── can use LLM
 │       ↓
 │    token usage
 │       ↓
 │    Credit deduction
 │
 ├── can use Web Search
 │       ↓
 │    fixed Credit cost
 │
 ├── can recover completed interrupted generations
 │
 ├── can regenerate at a new cost
 │
 ├── can share frozen conversations
 │
 └── can inspect payment history

Admin
 │
 ├── manages model pricing
 ├── manages model availability/access
 ├── views payments
 ├── views audit events
 └── sees Credit price as read-only
```

And the following invariants hold:

```text
Duplicate payment
→ never grants Credits twice

Completed generation
→ charged exactly once

Recovered generation
→ no additional charge

Incomplete server generation
→ no final charge

Credit exhaustion
→ partial response is persisted

Regenerate
→ new generation + new charge

Shared snapshot
→ immutable

Model price change
→ does not rewrite historical charges
```

This architecture intentionally leaves recurring subscriptions, coupons, discounts, refunds automation, multi-currency billing, team billing, credit expiration, and complex search pricing outside v1.
