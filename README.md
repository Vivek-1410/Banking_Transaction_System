# Ledger — Transaction & Double-Entry Ledger Backend

A production-oriented backend system for managing accounts, balances, transactions, and ledger entries using Node.js, Express, MongoDB, and Mongoose.

The system is designed around a ledger-first architecture where account balances are derived from immutable CREDIT and DEBIT ledger entries rather than being stored and directly modified as a balance field.

It supports:

- User authentication using JWT
- Account creation and management
- Account balance calculation from ledger entries
- Normal user-to-user transactions
- System-initiated initial fund transactions
- Double-entry ledger records
- MongoDB ACID transactions
- Idempotent transaction requests
- Sender account ownership validation
- Account status validation
- Transaction status management
- Email notifications
- Protected routes
- System-user authorization
- Deployment on Render


## 1. Architecture

The backend follows a layered REST API architecture.

```text
                         CLIENT
                           |
                           | HTTP Request
                           v
                    +--------------+
                    |    Express   |
                    |    Routes    |
                    +--------------+
                           |
                           v
                    +--------------+
                    | Middleware   |
                    |              |
                    | JWT Auth     |
                    | System Auth  |
                    +--------------+
                           |
                           v
                    +--------------+
                    | Controllers  |
                    |              |
                    | Account      |
                    | Transaction  |
                    | Auth         |
                    +--------------+
                           |
              +------------+------------+
              |            |            |
              v            v            v
        +-----------+ +-----------+ +-----------+
        |   User    | |  Account  | | Ledger    |
        |   Model   | |   Model   | |   Model   |
        +-----------+ +-----------+ +-----------+
              |            |            |
              +------------+------------+
                           |
                           v
                    +--------------+
                    |   MongoDB    |
                    +--------------+

                           |
                           v
                    +--------------+
                    | Email Service|
                    +--------------+

HIGH LEVEL FLOW
Request
   |
   v
Route
   |
   v
Authentication Middleware
   |
   v
Controller
   |
   +---- Validate Request
   |
   +---- Validate Authorization
   |
   +---- Validate Account
   |
   +---- Check Idempotency
   |
   +---- Calculate Balance
   |
   +---- MongoDB Transaction
   |       |
   |       +---- Transaction PENDING
   |       +---- DEBIT Ledger
   |       +---- CREDIT Ledger
   |       +---- Transaction COMPLETED
   |
   +---- Commit
   |
   +---- Send Email
   |
   v
Response

2. Core Design Principle

The system follows a ledger-first approach.

Instead of storing:

Account
----------------
balance: 10000

the system stores individual financial events:

Ledger
---------------------------------
Account A   CREDIT   10000
Account A   DEBIT     2000
Account A   CREDIT    5000

The balance is calculated as:

Balance = Total Credits - Total Debits

For example:

Credits = 15000
Debits  = 2000

Balance = 15000 - 2000
        = 13000

This provides a complete transaction history and makes financial state auditable.

3. Double-Entry Ledger

Every normal transaction creates two ledger entries.

For example:

User A -> User B
Amount = 1000

The system creates:

User A Account
-------------------------
DEBIT   1000


User B Account
-------------------------
CREDIT  1000

Conceptually:

                Transaction
                     |
             +-------+-------+
             |               |
             v               v
          DEBIT           CREDIT
          1000             1000
             |               |
             v               v
        Sender Account   Receiver Account

This guarantees that a successful transfer always has both sides represented in the ledger.

4. Data Models
User

The user represents an authenticated application user.

Typical fields:

User
-------------------------
_id
name
email
password
systemUser
createdAt
updatedAt

systemUser identifies whether the user is allowed to perform system-level operations.

Account

An account belongs to a user.

Account
-------------------------
_id
user
currency
status
systemAccount
createdAt
updatedAt

Important fields:

user

Reference to the owner of the account.

currency

Currency associated with the account.

status

Used to determine whether transactions are allowed.

Example:

ACTIVE
INACTIVE
systemAccount

Used to identify an account belonging to the system user.

Example:

systemAccount: true

Normal user accounts:

systemAccount: false
Transaction

Represents a transfer between two accounts.

Transaction
-------------------------
_id
fromAccount
toAccount
amount
idempotencyKey
status
createdAt
updatedAt

Possible transaction states:

PENDING
COMPLETED
FAILED
REVERSED
Ledger

Represents an immutable financial event.

Ledger
-------------------------
_id
account
amount
transaction
type
createdAt
updatedAt

Possible ledger types:

CREDIT
DEBIT
5. Authentication Architecture

Authentication is handled using JWT.

The client sends a token using either:

Cookie

or:

Authorization: Bearer <token>

The authentication middleware:

Extracts the token.
Verifies the token using the JWT secret.
Extracts the user ID.
Finds the corresponding user.
Attaches the user to:
req.user

Example:

req.user = user;

Controllers can then use:

req.user._id

to identify the authenticated user.

6. Authorization

Authentication answers:

Who are you?

Authorization answers:

Are you allowed to perform this operation?

For example, when transferring money:

Authenticated User
        |
        v
Sender Account
        |
        v
Does account.user == req.user._id ?
        |
     +--+--+
     |     |
    YES    NO
     |     |
     v     v
 Allow   Reject

If a user tries to use another user's account:

403 Forbidden

is returned.

7. Account Creation Flow

When an authenticated user creates an account:

POST /api/accounts

The backend:

Gets the authenticated user from req.user.
Reads the requested currency.
Creates the account.
Associates the account with the authenticated user.

Example:

const account = await accountModel.create({
    user: req.user._id,
    currency: req.body.currency
});

The user does not manually provide the owner ID.

8. Get User Accounts

Endpoint:

GET /api/accounts

The backend only returns accounts belonging to the authenticated user.

Conceptually:

accountModel.find({
    user: req.user._id
});

This prevents users from retrieving another user's accounts.

9. Balance Calculation

Endpoint:

GET /api/accounts/balance/:accountId

The backend first validates the account ID.

Then:

Find account
      |
      v
Does account exist?
      |
     YES
      |
      v
Does account belong to req.user?
      |
   +--+--+
   |     |
  YES    NO
   |     |
   v     v
Calculate 403
balance

Balance is derived from the ledger.

MongoDB aggregation calculates:

Total CREDIT
-
Total DEBIT
=
Current Balance

Example:

CREDIT = 15000
DEBIT  = 5000

Balance = 10000

There is no need to maintain a separate mutable balance field.

10. Normal Transaction Flow

Endpoint:

POST /api/transactions

Request:

{
    "fromAccount": "sender_account_id",
    "toAccount": "receiver_account_id",
    "amount": 1000,
    "idempotencyKey": "unique-request-id"
}

The transaction follows the following flow.

Step 1 — Validate Request

Required fields:

fromAccount
toAccount
amount
idempotencyKey

Account IDs are validated using:

mongoose.Types.ObjectId.isValid()

Amount must be:

finite
positive
numeric

The sender and receiver cannot be the same account.

Step 2 — Idempotency Check

The system searches for an existing transaction using:

idempotencyKey

If the transaction already exists:

COMPLETED
    -> Transaction already processed

PENDING
    -> Transaction already in progress

FAILED / REVERSED
    -> Transaction cannot be processed again

This prevents accidental duplicate transactions.

11. Why Idempotency Matters

Consider a client sending:

POST /transactions

The request succeeds, but the client does not receive the response because of a network problem.

The client retries the same request.

Without idempotency:

Request 1 -> DEBIT 1000
Request 2 -> DEBIT 1000

Total = 2000

With idempotency:

Request 1
   |
   v
idempotencyKey = ABC
   |
   v
Transaction created


Request 2
   |
   v
idempotencyKey = ABC
   |
   v
Existing transaction found
   |
   v
Do not process again

This makes transaction requests safely retryable.

12. Account Ownership Validation

Before processing the transaction:

fromUserAccount.user._id.toString()
===
req.user._id.toString()

must be true.

Otherwise:

403 Forbidden

is returned.

This ensures that a user cannot simply provide someone else's account ID as fromAccount and transfer money from that account.

13. Account Status Validation

Both accounts must be active.

Sender Account  -> ACTIVE
Receiver Account -> ACTIVE

If either account is inactive:

Transaction rejected
14. Balance Validation

Before creating the transaction, the backend calculates the sender's balance from the ledger.

Sender Balance
=
Total Credits
-
Total Debits

Then:

Sender Balance >= Transaction Amount

must be true.

Otherwise:

400 Bad Request

is returned with:

Insufficient balance
15. MongoDB ACID Transaction

The actual financial operation is performed inside a MongoDB session.

const session = await mongoose.startSession();

session.startTransaction();

Inside the transaction:

Create Transaction
       |
       v
Create DEBIT ledger
       |
       v
Create CREDIT ledger
       |
       v
Mark Transaction COMPLETED
       |
       v
Commit

If any operation fails:

Abort transaction

Therefore, the system avoids partial transfers such as:

DEBIT created
CREDIT failed

Instead:

DEBIT
CREDIT
TRANSACTION

are committed together.

16. Normal Transaction Lifecycle
             Request
                |
                v
          Validate Input
                |
                v
       Check Idempotency
                |
                v
        Find Both Accounts
                |
                v
      Check Account Ownership
                |
                v
       Check Account Status
                |
                v
        Calculate Balance
                |
                v
       Start DB Transaction
                |
                v
     Transaction = PENDING
                |
                v
       Create DEBIT Ledger
                |
                v
      Create CREDIT Ledger
                |
                v
    Transaction = COMPLETED
                |
                v
             COMMIT
                |
                v
          Send Emails
                |
                v
            Response
17. Initial Funds Flow

The system also supports a system-initiated transaction.

Endpoint:

POST /api/transactions/initial-funds

Request:

{
    "toAccount": "user_account_id",
    "amount": 10000,
    "idempotencyKey": "unique-request-id"
}

The request is authenticated using the system-user authorization middleware.

18. System Account

A dedicated system account is used as the source of initial funds.

Example:

System Account
systemAccount: true

The system account is associated with a system user.

Initial funding therefore becomes:

SYSTEM ACCOUNT
      |
      | DEBIT
      | 10000
      v
USER ACCOUNT
      |
      | CREDIT
      | 10000

This keeps initial funds consistent with the same double-entry ledger model used for normal transactions.

19. System User Authorization

System-level operations are protected separately from normal authentication.

The system authorization middleware:

Extracts JWT.
Verifies JWT.
Finds user.
Checks:
user.systemUser

Only a system user can access system-level transaction operations.

20. Initial Funds Transaction

The initial funds flow is:

System User Authentication
          |
          v
Validate Request
          |
          v
Check Idempotency
          |
          v
Find Receiver Account
          |
          v
Find System Account
          |
          v
Check Account Status
          |
          v
Start MongoDB Transaction
          |
          v
Create Transaction PENDING
          |
          v
Create CREDIT for User
          |
          v
Create DEBIT for System
          |
          v
Mark COMPLETED
          |
          v
Commit
          |
          v
Send Email
          |
          v
Response
21. Example Normal Transaction

Suppose:

Alice Account = 5000
Bob Account   = 1000

Alice sends:

1500

The ledger becomes:

Alice
-------------------------
Existing balance   5000
DEBIT              1500
Remaining balance  3500


Bob
-------------------------
Existing balance   1000
CREDIT             1500
New balance        2500

Transaction:

{
    "fromAccount": "alice_account",
    "toAccount": "bob_account",
    "amount": 1500,
    "status": "COMPLETED"
}
22. Example Initial Funds Transaction

System adds:

10000

to a user account.

Ledger:

SYSTEM ACCOUNT
-------------------------
DEBIT   10000


USER ACCOUNT
-------------------------
CREDIT  10000

Result:

User Balance = 10000
23. Email Notifications

After a successful database commit, transaction emails are sent to:

Receiver
Sender

The important design decision is that emails are sent after:

await session.commitTransaction();

This prevents an email from being sent for a transaction that ultimately rolls back.

24. API Structure

Example API structure:

/api
 |
 +-- /auth
 |     |
 |     +-- register
 |     +-- login
 |
 +-- /accounts
 |     |
 |     +-- POST /
 |     +-- GET /
 |     +-- GET /balance/:accountId
 |
 +-- /transactions
       |
       +-- POST /
       +-- POST /initial-funds

Protected routes require authentication.

25. Security Model

The backend implements several authorization boundaries.

Authentication

JWT verifies the identity of the user.

Account Ownership

Users can only perform transactions using accounts they own.

Balance Validation

Users cannot spend more than their derived ledger balance.

Account Status

Inactive accounts cannot participate in transactions.

System Authorization

Only system users can initiate system-level funding.

Input Validation

Invalid IDs and invalid amounts are rejected before database operations.

Idempotency

Duplicate requests using the same idempotency key are not processed again.

26. Failure Handling

If a database operation fails during a transaction:

session.abortTransaction()

is executed.

Example:

Transaction created
       |
       v
DEBIT created
       |
       v
CREDIT fails
       |
       v
ABORT
       |
       v
Everything rolled back

This prevents inconsistent ledger state.

27. Transaction Consistency

The core invariant is:

Every successful transaction must have:

1 Transaction
+
1 DEBIT ledger entry
+
1 CREDIT ledger entry

For a successful transaction:

Total Debit = Total Credit

For example:

DEBIT  = 10000
CREDIT = 10000

This provides a simple accounting invariant that can be used for reconciliation and auditing.

28. Why Ledger Instead of Balance Field?

A traditional implementation might use:

account.balance -= amount;
receiver.balance += amount;

This can make auditing difficult.

The ledger approach instead records:

DEBIT
CREDIT
DEBIT
CREDIT
...

The complete financial history remains available.

Benefits:

Auditable transaction history
Easier reconciliation
Clear financial events
Reduced reliance on mutable state
Natural support for reversals
Better traceability
Double-entry accounting model
29. Concurrency Considerations

The system uses MongoDB transactions to keep multiple writes atomic.

Example:

Transaction A
    |
    +-- DEBIT
    +-- CREDIT
    +-- COMPLETE


Transaction B
    |
    +-- DEBIT
    +-- CREDIT
    +-- COMPLETE

MongoDB sessions ensure that the individual transaction's writes are committed together.

The idempotency key additionally protects against repeated client requests.

30. Recommended Production Improvement

The current balance-check flow is:

Calculate balance
       |
       v
Start transaction
       |
       v
Create ledger entries

For a production financial system with heavy concurrency, this can be strengthened further using concurrency control / atomic balance reservation techniques.

Possible future improvements include:

MongoDB atomic conditional updates
Optimistic concurrency
Account version numbers
Transaction retry handling
Distributed locks where appropriate
Serializable-style application logic
Stronger idempotency guarantees with unique indexes
Background email jobs
Transaction reconciliation
Audit logging
31. Deployment

The backend is deployed on Render.

Deployment architecture:

Client
  |
  v
Render
  |
  v
Node.js / Express API
  |
  v
MongoDB
  |
  +---- Email Service

Environment variables are used for sensitive configuration.

Example:

PORT
MONGO_URI
JWT_SECRET_KEY
EMAIL_USER
EMAIL_PASSWORD

Secrets are not stored directly in the source code.

32. Technology Stack
Backend
Node.js
Express.js
Database
MongoDB
Mongoose
Authentication
JSON Web Tokens (JWT)
HTTP cookies / Authorization header
Transactions
MongoDB Sessions
MongoDB ACID Transactions
Email
Nodemailer / Email Service
Deployment
Render
33. Project Structure

Example structure:

project/
|
├── controllers/
│   ├── auth.controller.js
│   ├── account.controller.js
│   └── transaction.controller.js
|
├── models/
│   ├── user.model.js
│   ├── account.model.js
│   ├── transaction.model.js
│   └── ledger.model.js
|
├── middleware/
│   └── auth.middleware.js
|
├── routes/
│   ├── auth.routes.js
│   ├── account.routes.js
│   └── transaction.routes.js
|
├── services/
│   └── email.service.js
|
├── app.js
├── server.js
├── package.json
└── .env
34. Running Locally

Clone the repository:

git clone <repository-url>

Install dependencies:

npm install

Create a .env file:

PORT=3000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET_KEY=your_jwt_secret
EMAIL_USER=your_email
EMAIL_PASSWORD=your_email_password

Start the server:

npm start

Development mode:

npm run dev
35. Transaction Example
Request
POST /api/transactions
Authorization: Bearer <JWT>
Content-Type: application/json
{
    "fromAccount": "sender_account_id",
    "toAccount": "receiver_account_id",
    "amount": 1000,
    "idempotencyKey": "d53262b8-555a-45b9-a914-aab00ccf428f"
}
Successful Response
{
    "message": "Transaction completed successfully",
    "transaction": {
        "fromAccount": "sender_account_id",
        "toAccount": "receiver_account_id",
        "amount": 1000,
        "status": "COMPLETED"
    },
    "debitLedgerEntry": {
        "account": "sender_account_id",
        "amount": 1000,
        "type": "DEBIT"
    },
    "creditLedgerEntry": {
        "account": "receiver_account_id",
        "amount": 1000,
        "type": "CREDIT"
    }
}
36. Idempotency Example

First request:

idempotencyKey = ABC123

Result:

Transaction -> COMPLETED

Same request again:

idempotencyKey = ABC123

Result:

Transaction already processed

No additional ledger entries are created.

37. Error Responses
Missing Token
401 Unauthorized
{
    "message": "Unauthorized access, token is missing"
}
Invalid Token
401 Unauthorized
Unauthorized Account
403 Forbidden
{
    "message": "You are not authorized to use this account"
}
Insufficient Balance
400 Bad Request
{
    "message": "Insufficient balance in sender's account"
}
Invalid Account
400 Bad Request
{
    "message": "Invalid account ID"
}
38. Design Invariants

The following invariants are maintained by the application:

1. Users can only spend from accounts they own.

2. Only ACTIVE accounts can participate in transactions.

3. Sender balance must be sufficient.

4. Successful transfers contain both DEBIT and CREDIT entries.

5. DEBIT amount equals CREDIT amount.

6. Transaction and ledger entries are committed atomically.

7. Duplicate idempotency keys do not create duplicate transactions.

8. System funding requires system-user authorization.

9. Account balances are derived from ledger events.

10. Email notifications are sent only after successful database commit.
39. Future Roadmap

Potential future versions can add:

[ ] Transaction history API
[ ] Pagination
[ ] Account statement generation
[ ] Transaction reversal
[ ] Refund workflow
[ ] Scheduled transactions
[ ] Recurring transactions
[ ] Webhook notifications
[ ] Background email queue
[ ] Redis-based idempotency
[ ] Rate limiting
[ ] Request tracing
[ ] Structured logging
[ ] Monitoring
[ ] Reconciliation jobs
[ ] Audit log
[ ] Admin dashboard
[ ] Multi-currency support
[ ] Currency conversion
[ ] Stronger concurrency control
[ ] Automated integration tests
[ ] Load testing
40. Project Objective

The objective of this project is to demonstrate how a financial transaction backend can be designed around:

Authentication
      +
Authorization
      +
Ledger-based accounting
      +
Double-entry transactions
      +
ACID database operations
      +
Idempotency
      +
Concurrency awareness
      +
Auditability

Rather than treating a transaction as a simple database update, the system models it as a consistent financial operation composed of multiple related events.

41. Key Engineering Highlights

The project demonstrates practical backend engineering concepts including:

REST API design
JWT authentication
Authorization middleware
Resource ownership validation
MongoDB data modeling
Mongoose references and population
Aggregation pipelines
Ledger-based balance calculation
Double-entry accounting
ACID transactions
MongoDB sessions
Idempotent APIs
Transaction state management
Failure rollback
Email notifications
System-user authorization
Input validation
Secure environment configuration
Cloud deployment

### One important correction before you publish this README

Your current implementation is **good for the version you've built**, but I would **not yet claim "production-grade financial system"** in the README. A better positioning is:

> **Production-oriented ledger backend**

because there are still a few things we'd want to add before calling it truly production-grade:

1. **Unique index on `idempotencyKey`** — the application-level `findOne()` check alone isn't enough under concurrent requests.
2. **Concurrency-safe balance handling** — two simultaneous transfers can potentially both observe the same balance before either commits.
3. **Transaction retry handling** for transient MongoDB transaction errors.
4. **Rate limiting** on authentication and transaction endpoints.
5. **Automated tests**, especially transaction rollback/idempotency/concurrency tests.
6. **Structured logging and monitoring**.
7. **Background email queue** so email failure doesn't make an already-committed transaction look like a failed request.
8. **Reconciliation/audit functionality**.

Those additions would make the project much stronger for a resume because they move it from **"CRUD banking API"** toward **"transaction-processing system."**

For your resume, I would eventually describe the project around these keywords:

> **Double-entry ledger, ACID transactions, idempotency, JWT authorization, concurrency control, immutable financial events, atomic rollback, ledger-derived balances, and cloud deployment.**

That is considerably more screening-friendly than simply listing Node.js, Express, and MongoDB.
