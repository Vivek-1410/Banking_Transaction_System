const accountModel = require("../models/account.model");
const transactionModel = require("../models/transaction.model");
const ledgerModel = require("../models/ledger.model");
const emailService = require("../services/email.service");

const mongoose = require("mongoose");

/**
 * Create a new Transaction
 *
 * 10 STEP TRANSFER FLOW:
 * 1. Validate Request
 * 2. Validate Idempotency Key
 * 3. Check account status
 * 4. Derive Sender balance from ledger
 * 5. Create Transaction (PENDING)
 * 6. Create Debit Ledger Entry
 * 7. Create Credit Ledger Entry
 * 8. Mark Transaction Completed
 * 9. Commit MongoDB Session
 * 10. Send Email Notification
 */

async function createTransactionController(req, res) {

    const {
        fromAccount,
        toAccount,
        amount,
        idempotencyKey
    } = req.body;


    // ------------------------------------------------
    // 1. VALIDATE REQUEST
    // ------------------------------------------------

    if (!fromAccount || !toAccount || !amount || !idempotencyKey) {
        return res.status(400).json({
            message:
                "fromAccount, toAccount, amount and idempotencyKey are required fields"
        });
    }


    // Validate account IDs

    if (
        !mongoose.Types.ObjectId.isValid(fromAccount) ||
        !mongoose.Types.ObjectId.isValid(toAccount)
    ) {
        return res.status(400).json({
            message: "Invalid account ID"
        });
    }


    // Convert amount to number

    const transactionAmount = Number(amount);

    if (
        !Number.isFinite(transactionAmount) ||
        transactionAmount <= 0
    ) {
        return res.status(400).json({
            message: "Amount must be a positive number"
        });
    }


    // ------------------------------------------------
    // Prevent same account transfer
    // ------------------------------------------------

    if (fromAccount === toAccount) {
        return res.status(400).json({
            message: "Sender and receiver accounts must be different"
        });
    }


    // ------------------------------------------------
    // 2. CHECK IDEMPOTENCY
    // ------------------------------------------------

    const transactionAlreadyExists =
        await transactionModel.findOne({
            idempotencyKey
        });

    if (transactionAlreadyExists) {

        if (transactionAlreadyExists.status === "COMPLETED") {

            return res.status(200).json({
                message: "Transaction already processed",
                transaction: transactionAlreadyExists
            });

        } else if (transactionAlreadyExists.status === "PENDING") {

            return res.status(400).json({
                message: "Transaction is already in progress",
                transaction: transactionAlreadyExists
            });

        } else if (transactionAlreadyExists.status === "FAILED") {

            return res.status(400).json({
                message: "Transaction has failed previously",
                transaction: transactionAlreadyExists
            });

        } else if (transactionAlreadyExists.status === "REVERSED") {

            return res.status(400).json({
                message: "Transaction has been reversed",
                transaction: transactionAlreadyExists
            });
        }
    }


    // ------------------------------------------------
    // 3. GET ACCOUNTS + USER DETAILS
    // ------------------------------------------------

    const fromuserAccount = await accountModel
        .findOne({
            _id: fromAccount
        })
        .populate("user", "email name");

    const touserAccount = await accountModel
        .findOne({
            _id: toAccount
        })
        .populate("user", "email name");


    if (!fromuserAccount || !touserAccount) {

        return res.status(400).json({
            message: "Invalid fromAccount or toAccount"
        });
    }


    // ------------------------------------------------
    // CHECK SENDER OWNERSHIP
    // ------------------------------------------------

    if (
        fromuserAccount.user._id.toString() !==
        req.user._id.toString()
    ) {

        return res.status(403).json({
            message: "You are not authorized to use this account"
        });
    }


    // ------------------------------------------------
    // 3. CHECK ACCOUNT STATUS
    // ------------------------------------------------

    if (
        fromuserAccount.status !== "ACTIVE" ||
        touserAccount.status !== "ACTIVE"
    ) {

        return res.status(400).json({
            message:
                "Both accounts must be ACTIVE to perform a transaction"
        });
    }


    // ------------------------------------------------
    // 4. DERIVE SENDER BALANCE
    // ------------------------------------------------

    const balanceResult =
        await ledgerModel.aggregate([

            {
                $match: {
                    account: new mongoose.Types.ObjectId(fromAccount)
                }
            },

            {
                $group: {

                    _id: "$account",

                    credit: {
                        $sum: {
                            $cond: [
                                {
                                    $eq: ["$type", "CREDIT"]
                                },
                                "$amount",
                                0
                            ]
                        }
                    },

                    debit: {
                        $sum: {
                            $cond: [
                                {
                                    $eq: ["$type", "DEBIT"]
                                },
                                "$amount",
                                0
                            ]
                        }
                    }
                }
            }
        ]);


    const senderBalance =
        (balanceResult[0]?.credit || 0) -
        (balanceResult[0]?.debit || 0);


    if (senderBalance < transactionAmount) {

        return res.status(400).json({

            message:
                "Insufficient balance in sender's account",

            currently:
                "Current balance: " + senderBalance,

            required:
                "Requested amount: " + transactionAmount
        });
    }


    // ------------------------------------------------
    // 5-9. DATABASE TRANSACTION
    // ------------------------------------------------

    const session =
        await mongoose.startSession();

    try {

        session.startTransaction();


        // ------------------------------------------------
        // 5. CREATE TRANSACTION - PENDING
        // ------------------------------------------------

        const transaction =
            await transactionModel.create(
                [
                    {
                        fromAccount,
                        toAccount,
                        amount: transactionAmount,
                        idempotencyKey,
                        status: "PENDING"
                    }
                ],
                { session }
            );


        const createdTransaction = transaction[0];


        // ------------------------------------------------
        // 6. CREATE DEBIT LEDGER ENTRY
        // ------------------------------------------------

        const debitLedger =
            await ledgerModel.create(
                [
                    {
                        account: fromAccount,
                        amount: transactionAmount,
                        transaction:
                            createdTransaction._id,
                        type: "DEBIT"
                    }
                ],
                { session }
            );


        const debitLedgerEntry = debitLedger[0];


        // ------------------------------------------------
        // 7. CREATE CREDIT LEDGER ENTRY
        // ------------------------------------------------

        const creditLedger =
            await ledgerModel.create(
                [
                    {
                        account: toAccount,
                        amount: transactionAmount,
                        transaction:
                            createdTransaction._id,
                        type: "CREDIT"
                    }
                ],
                { session }
            );


        const creditLedgerEntry = creditLedger[0];


        // ------------------------------------------------
        // 8. MARK TRANSACTION COMPLETED
        // ------------------------------------------------

        createdTransaction.status = "COMPLETED";

        await createdTransaction.save({
            session
        });


        // ------------------------------------------------
        // 9. COMMIT TRANSACTION
        // ------------------------------------------------

        await session.commitTransaction();


        // ------------------------------------------------
        // 10. SEND EMAIL
        // ------------------------------------------------

        await emailService.sendTransactionEmail(
            touserAccount.user.email,
            touserAccount.user.name,
            transactionAmount,
            fromAccount
        );


        await emailService.sendTransactionEmail(
            fromuserAccount.user.email,
            fromuserAccount.user.name,
            transactionAmount,
            toAccount
        );


        // ------------------------------------------------
        // RESPONSE
        // ------------------------------------------------

        return res.status(201).json({

            message:
                "Transaction completed successfully",

            transaction: createdTransaction,

            debitLedgerEntry,

            creditLedgerEntry
        });


    } catch (error) {

        // ------------------------------------------------
        // ROLLBACK
        // ------------------------------------------------

        await session.abortTransaction();

        console.error(
            "Transaction failed:",
            error
        );


        return res.status(500).json({

            message:
                "Transaction failed",

            error:
                error.message
        });


    } finally {

        // ------------------------------------------------
        // CLOSE SESSION
        // ------------------------------------------------

        await session.endSession();
    }
}


async function createInitialFundsTransactionController(req, res) {

    console.log("\n========== INITIAL FUNDS START ==========");

    try {

        // 1. Request body
        console.log("STEP 1: Request body:", req.body);

        const { toAccount, amount, idempotencyKey } = req.body;

        if (!toAccount || !amount || !idempotencyKey) {
            console.log("ERROR: Missing required fields");

            return res.status(400).json({
                message: "toAccount, amount and idempotencyKey are required fields"
            });
        }

        console.log("STEP 2: Request validation passed");


        // 2. Receiver account
        console.log("STEP 3: Finding receiver account...");

        const toUserAccount = await accountModel
            .findOne({ _id: toAccount })
            .populate("user", "email name");

        console.log("STEP 4: Receiver account:", toUserAccount);

        if (!toUserAccount) {
            console.log("ERROR: Receiver account not found");

            return res.status(400).json({
                message: "Invalid toAccount"
            });
        }


        // 3. System account
        console.log("STEP 5: Finding system account...");
        console.log("Current authenticated user:", req.user);

        const fromUserAccount = await accountModel
            .findOne({
                systemAccount: true,
                user: req.user._id
            })
            .populate("user", "email name");

        console.log("STEP 6: System account:", fromUserAccount);

        if (!fromUserAccount) {
            console.log("ERROR: System account not found");

            return res.status(400).json({
                message: "System account not found for the user"
            });
        }


        // 4. Start MongoDB session
        console.log("STEP 7: Starting MongoDB session...");

        const session = await mongoose.startSession();

        console.log("STEP 8: Session created");

        try {

            session.startTransaction();

            console.log("STEP 9: MongoDB transaction started");


            // 5. Create transaction
            console.log("STEP 10: Creating transaction...");

            const transaction = new transactionModel({
                fromAccount: fromUserAccount._id,
                toAccount: toUserAccount._id,
                amount,
                idempotencyKey,
                status: "PENDING"
            });

            console.log("STEP 11: Transaction object created:", transaction);


            // 6. Credit receiver
            console.log("STEP 12: Creating CREDIT ledger entry...");

            const creditLedgerEntry = await ledgerModel.create(
                [{
                    account: toUserAccount._id,
                    amount,
                    transaction: transaction._id,
                    type: "CREDIT"
                }],
                { session }
            );

            console.log("STEP 13: CREDIT ledger created:", creditLedgerEntry);


            // 7. Debit system account
            console.log("STEP 14: Creating DEBIT ledger entry...");

            const debitLedgerEntry = await ledgerModel.create(
                [{
                    account: fromUserAccount._id,
                    amount,
                    transaction: transaction._id,
                    type: "DEBIT"
                }],
                { session }
            );

            console.log("STEP 15: DEBIT ledger created:", debitLedgerEntry);


            // 8. Save transaction
            console.log("STEP 16: Marking transaction COMPLETED...");

            transaction.status = "COMPLETED";

            await transaction.save({ session });

            console.log("STEP 17: Transaction saved");


            // 9. Commit
            console.log("STEP 18: Committing MongoDB transaction...");

            await session.commitTransaction();

            console.log("STEP 19: MongoDB transaction COMMITTED");


            // 10. Email
            console.log("STEP 20: Sending receiver email...");

            const senderMail = fromUserAccount.user.email;
            const receiverMail = toUserAccount.user.email;

            await emailService.sendTransactionEmail(
                receiverMail,
                toUserAccount.user.name,
                amount,
                fromUserAccount._id
            );

            console.log("STEP 21: Receiver email sent");


            console.log("STEP 22: Sending sender email...");

            await emailService.sendTransactionEmail(
                senderMail,
                fromUserAccount.user.name,
                amount,
                toUserAccount._id
            );

            console.log("STEP 23: Sender email sent");


            // 11. Response
            console.log("STEP 24: Sending response");

            return res.status(201).json({
                message: "Initial funds transaction completed successfully",
                transaction,
                debitLedgerEntry,
                creditLedgerEntry
            });

        } catch (error) {

            console.error("\n❌ TRANSACTION ERROR:");
            console.error(error);
            console.error("Message:", error.message);
            console.error("Stack:", error.stack);

            if (session.inTransaction()) {
                await session.abortTransaction();
                console.log("MongoDB transaction aborted");
            }

            return res.status(500).json({
                message: "Initial funds transaction failed",
                error: error.message
            });

        } finally {

            await session.endSession();

            console.log("MongoDB session ended");
        }

    } catch (error) {

        console.error("\n❌ CONTROLLER ERROR:");
        console.error(error);
        console.error("Message:", error.message);
        console.error("Stack:", error.stack);

        return res.status(500).json({
            message: "Controller error",
            error: error.message
        });
    }
}


module.exports = {
    createTransactionController,
    createInitialFundsTransactionController
};