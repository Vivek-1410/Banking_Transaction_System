# Ledger — Transaction & Double-Entry Ledger System

A backend financial ledger system built with **Node.js, Express.js, MongoDB, and Mongoose**.

The system models real-world money transfers using **double-entry bookkeeping**, **MongoDB transactions**, **ledger-derived balances**, **idempotency**, and **system accounts for initial fund allocation**.

---

## Features

- User authentication with protected APIs
- Multiple accounts per user
- Account balance derived from immutable ledger entries
- Double-entry transaction model
- Debit and credit ledger entries
- MongoDB ACID transactions
- Idempotent transaction requests
- Initial fund allocation through a system account
- Account ownership validation
- Account status validation
- Insufficient-balance protection
- Transaction status tracking
- Email notifications
- RESTful API architecture
- Backend deployed on Render

---

## Architecture

```text
                    ┌──────────────────────┐
                    │       Client         │
                    │  Postman / Frontend  │
                    └──────────┬───────────┘
                               │
                               │ HTTP + JWT
                               ▼
                    ┌──────────────────────┐
                    │     Express API      │
                    │      Routes          │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │    Controllers       │
                    │                      │
                    │ Account Controller   │
                    │ Transaction Ctrl.   │
                    └──────────┬───────────┘
                               │
             ┌─────────────────┼─────────────────┐
             ▼                 ▼                 ▼
      ┌────────────┐    ┌────────────┐    ┌────────────┐
      │   User     │    │  Account   │    │ Transaction│
      │   Model    │    │   Model    │    │   Model    │
      └────────────┘    └────────────┘    └─────┬──────┘
                                                │
                                                ▼
                                         ┌────────────┐
                                         │   Ledger   │
                                         │   Model    │
                                         └─────┬──────┘
                                               │
                                               ▼
                                         ┌────────────┐
                                         │  MongoDB   │
                                         └────────────┘

                         ┌────────────────────┐
                         │   Email Service    │
                         └────────────────────┘
Core Design

The system does not store the account balance directly.

Instead:

Balance = Total Credits - Total Debits

Example:

CREDIT   10,000
DEBIT     2,500
----------------
Balance   7,500

This makes the ledger the source of truth for account balances.

Transaction Flow

A normal user-to-user transfer follows this flow:

1. Validate request
        ↓
2. Validate account IDs
        ↓
3. Validate amount
        ↓
4. Check idempotency key
        ↓
5. Find sender & receiver accounts
        ↓
6. Verify sender ownership
        ↓
7. Verify account status
        ↓
8. Calculate sender balance
        ↓
9. Start MongoDB transaction
        ↓
10. Create Transaction (PENDING)
        ↓
11. Create DEBIT ledger entry
        ↓
12. Create CREDIT ledger entry
        ↓
13. Mark Transaction COMPLETED
        ↓
14. Commit MongoDB transaction
        ↓
15. Send email notifications
Double-Entry Ledger

Every successful transfer creates two ledger entries.

For example, User A sends ₹1,000 to User B:

User A Account
    DEBIT   ₹1,000

User B Account
    CREDIT  ₹1,000

Both entries reference the same transaction.

Transaction
     │
     ├── DEBIT  → Sender Account
     │
     └── CREDIT → Receiver Account

This ensures every transfer has a corresponding debit and credit.

MongoDB Transaction

The debit, credit, and transaction status update happen inside a single MongoDB session.

START TRANSACTION

    Create Transaction (PENDING)

    Create DEBIT Ledger Entry

    Create CREDIT Ledger Entry

    Mark Transaction COMPLETED

COMMIT

If any database operation fails:

ROLLBACK

Therefore, the system avoids states such as:

Debit created
Credit failed
Transaction completed
Idempotency

Each transaction requires a unique:

idempotencyKey

If the same request is sent multiple times:

Request 1
    ↓
Transaction created
    ↓
PENDING
    ↓
COMPLETED

Request 2 with same idempotencyKey
    ↓
Existing transaction detected
    ↓
"Transaction already processed"

During a long-running transaction:

Request 1
    ↓
PENDING
    ↓
Processing...

Request 2
    ↓
Same idempotencyKey
    ↓
"Transaction is already in progress"

This protects the system against duplicate money transfers caused by retries, network failures, or repeated client requests.

Initial Funds

New accounts can receive their initial funds through a dedicated system account.

System Account
      │
      │ DEBIT
      ▼
User Account
      │
      │ CREDIT
      ▼
   Balance

The system account is identified using:

systemAccount: true

Initial funding follows the same ledger principle:

System Account → DEBIT
User Account   → CREDIT

This keeps initial funds inside the same transaction and ledger architecture instead of directly modifying balances.

Security & Validation

The API validates:

JWT authenticated user
Account ownership
Account existence
Account status
Valid MongoDB ObjectIds
Positive transaction amounts
Sufficient sender balance
Sender/receiver account difference
Unique idempotency keys

A user cannot transfer money from another user's account even if they know the account ID.

Authenticated User
        │
        ▼
Sender Account
        │
        ├── Owner matches user? ── YES → Continue
        │
        └── NO → 403 Forbidden
Main Data Models
User

Stores application users and authentication-related information.

User
 ├── name
 ├── email
 └── authentication data
Account

Represents a financial account owned by a user.

Account
 ├── user
 ├── currency
 ├── status
 └── systemAccount
Transaction

Represents the business-level transfer.

Transaction
 ├── fromAccount
 ├── toAccount
 ├── amount
 ├── status
 ├── idempotencyKey
 ├── createdAt
 └── updatedAt

Possible transaction states:

PENDING
COMPLETED
FAILED
REVERSED
Ledger

Represents individual accounting entries.

Ledger
 ├── account
 ├── amount
 ├── transaction
 └── type

Ledger types:

CREDIT
DEBIT
Account Balance

Balance is calculated from ledger history:

balance =
    totalCredits -
    totalDebits;

MongoDB aggregation is used to calculate:

Total CREDIT
       -
Total DEBIT
       =
Current Balance

No separate mutable balance field is required.

API Structure
/api/auth
/api/accounts
/api/transactions

Example account operations:

POST   /api/accounts
GET    /api/accounts
GET    /api/accounts/balance/:accountId

Example transaction operations:

POST   /api/transactions
POST   /api/transactions/initial-funds

Protected endpoints require authentication.

Example Transaction
Request
{
  "fromAccount": "SENDER_ACCOUNT_ID",
  "toAccount": "RECEIVER_ACCOUNT_ID",
  "amount": 1000,
  "idempotencyKey": "unique-request-id"
}
Result
Transaction
     │
     ├── DEBIT  Sender     ₹1,000
     │
     └── CREDIT Receiver   ₹1,000

Both ledger entries belong to the same transaction ID.

Failure Handling

If any operation inside the MongoDB transaction fails:

Create Transaction
       ↓
Create Debit
       ↓
Create Credit
       ↓
Error
       ↓
Abort Transaction
       ↓
Rollback all database changes

Email notifications are sent after the database transaction is committed, so external email failures do not cause the financial transaction itself to be rolled back.

Project Structure
ledger/
│
├── controllers/
│   ├── account.controller.js
│   └── transaction.controller.js
│
├── models/
│   ├── user.model.js
│   ├── account.model.js
│   ├── transaction.model.js
│   └── ledger.model.js
│
├── routes/
│   ├── account.routes.js
│   ├── transaction.routes.js
│   └── auth.routes.js
│
├── services/
│   └── email.service.js
│
├── middleware/
│   └── auth.middleware.js
│
├── app.js
├── server.js
└── package.json
Technology Stack
Technology	Purpose
Node.js	Backend runtime
Express.js	REST API
MongoDB	Database
Mongoose	ODM & database transactions
JWT	Authentication
Nodemailer / Email Service	Transaction notifications
Render	Backend deployment
Deployment

The backend is deployed on Render and exposes the REST APIs for client applications.

Client
  │
  │ HTTPS
  ▼
Render
  │
  ▼
Node.js + Express
  │
  ▼
MongoDB
Key Engineering Concepts

This project demonstrates:

REST API design
JWT authentication
Authorization
MongoDB aggregation
ACID transactions
Database sessions
Double-entry bookkeeping
Immutable ledger-based balance calculation
Idempotent APIs
Transaction state management
Rollback and failure handling
Ownership validation
Separation of controllers, models and services
Asynchronous email processing
Future Improvements

Possible production-level improvements:

Unique database index on idempotencyKey
Rate limiting
Transaction history APIs
Pagination
Refresh-token authentication
Audit logs
Transaction reversal/refund workflow
Background job queue for emails
Optimistic/concurrent balance protection
Request tracing and structured logging
Automated unit and integration tests
Monitoring and alerting
Summary

Ledger is a transaction processing backend that models financial transfers using double-entry accounting and an immutable ledger rather than directly modifying account balances.

The combination of:

JWT Authentication
        +
Authorization
        +
Ledger-Based Balances
        +
Double-Entry Accounting
        +
MongoDB ACID Transactions
        +
Idempotent APIs
        +
System Accounts

provides a foundation for building reliable financial transaction workflows.
