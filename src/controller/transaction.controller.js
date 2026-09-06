const accountModel = require("../models/account.model");
const transactionModel = require("../models/transaction.model");
const ledgerModel = require("../models/ledger.model");
const emailService = require("../services/email.service");

const mongoose = require("mongoose");


async function createTransactionController(req, res) {

    console.log("\n========== NORMAL TRANSACTION START ==========");

    try {

        const {
            fromAccount,
            toAccount,
            amount,
            idempotencyKey
        } = req.body;

        console.log("STEP 1: Request:", req.body);
        console.log("Authenticated user:", req.user?._id);

        if (!fromAccount || !toAccount || !amount || !idempotencyKey) {
            return res.status(400).json({
                message:
                    "fromAccount, toAccount, amount and idempotencyKey are required fields"
            });
        }

        if (
            !mongoose.Types.ObjectId.isValid(fromAccount) ||
            !mongoose.Types.ObjectId.isValid(toAccount)
        ) {
            return res.status(400).json({
                message: "Invalid account ID"
            });
        }

        const transactionAmount = Number(amount);

        if (
            !Number.isFinite(transactionAmount) ||
            transactionAmount <= 0
        ) {
            return res.status(400).json({
                message: "Amount must be a positive number"
            });
        }

        if (fromAccount === toAccount) {
            return res.status(400).json({
                message:
                    "Sender and receiver accounts must be different"
            });
        }


        console.log("STEP 2: Checking idempotency...");

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
            }

            if (transactionAlreadyExists.status === "PENDING") {
                return res.status(400).json({
                    message: "Transaction is already in progress",
                    transaction: transactionAlreadyExists
                });
            }

            return res.status(400).json({
                message: "Transaction cannot be processed again",
                transaction: transactionAlreadyExists
            });
        }


        console.log("STEP 3: Finding accounts...");

        const fromUserAccount = await accountModel
            .findById(fromAccount)
            .populate("user", "email name");

        const toUserAccount = await accountModel
            .findById(toAccount)
            .populate("user", "email name");

        if (!fromUserAccount || !toUserAccount) {
            return res.status(400).json({
                message: "Invalid fromAccount or toAccount"
            });
        }

        console.log("Sender account:", fromUserAccount);
        console.log("Receiver account:", toUserAccount);


        console.log("STEP 4: Checking sender ownership...");

        if (
            !fromUserAccount.user ||
            fromUserAccount.user._id.toString() !==
            req.user._id.toString()
        ) {
            return res.status(403).json({
                message:
                    "You are not authorized to use this account"
            });
        }


        console.log("STEP 5: Checking account status...");

        if (
            fromUserAccount.status !== "ACTIVE" ||
            toUserAccount.status !== "ACTIVE"
        ) {
            return res.status(400).json({
                message:
                    "Both accounts must be ACTIVE to perform a transaction"
            });
        }


        console.log("STEP 6: Calculating sender balance...");

        const balanceResult =
            await ledgerModel.aggregate([

                {
                    $match: {
                        account:
                            new mongoose.Types.ObjectId(fromAccount)
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

        console.log("Sender balance:", senderBalance);

        if (senderBalance < transactionAmount) {
            return res.status(400).json({
                message:
                    "Insufficient balance in sender's account",
                currently: senderBalance,
                required: transactionAmount
            });
        }


        console.log("STEP 7: Starting MongoDB transaction...");

        const session = await mongoose.startSession();

        try {

            session.startTransaction();


            console.log("STEP 8: Creating transaction...");

            const transactionArray =
                await transactionModel.create(
                    [{
                        fromAccount,
                        toAccount,
                        amount: transactionAmount,
                        idempotencyKey,
                        status: "PENDING"
                    }],
                    { session }
                );

            const transaction = transactionArray[0];

            console.log(
                "Transaction created:",
                transaction._id
            );


            console.log("STEP 9: Creating DEBIT ledger...");

            const debitLedgerArray =
                await ledgerModel.create(
                    [{
                        account: fromAccount,
                        amount: transactionAmount,
                        transaction: transaction._id,
                        type: "DEBIT"
                    }],
                    { session }
                );

            const debitLedgerEntry =
                debitLedgerArray[0];

            // await (() => {
            //     return new Promise((resolve, reject) => {
            //         setTimeout(() => {
            //             console.log(
            //                 "Simulating a delay before creating CREDIT ledger..."
            //             );
            //             resolve();
            //         }, 1000);   
            // })()




            console.log("STEP 10: Creating CREDIT ledger...");

            const creditLedgerArray =
                await ledgerModel.create(
                    [{
                        account: toAccount,
                        amount: transactionAmount,
                        transaction: transaction._id,
                        type: "CREDIT"
                    }],
                    { session }
                );

            const creditLedgerEntry =
                creditLedgerArray[0];


            console.log("STEP 11: Completing transaction...");

            transaction.status = "COMPLETED";

            await transaction.save({
                session
            });


            console.log("STEP 12: Committing transaction...");

            await session.commitTransaction();

            console.log("MongoDB transaction committed");


            console.log("STEP 13: Sending receiver email...");

            await emailService.sendTransactionEmail(
                toUserAccount.user.email,
                toUserAccount.user.name,
                transactionAmount,
                fromAccount
            );


            console.log("STEP 14: Sending sender email...");

            await emailService.sendTransactionEmail(
                fromUserAccount.user.email,
                fromUserAccount.user.name,
                transactionAmount,
                toAccount
            );


            console.log("STEP 15: Sending response...");

            return res.status(201).json({
                message:
                    "Transaction completed successfully",

                transaction,

                debitLedgerEntry,

                creditLedgerEntry
            });

        } catch (error) {

            console.error("TRANSACTION ERROR:");
            console.error(error);

            if (session.inTransaction()) {
                await session.abortTransaction();
            }

            return res.status(500).json({
                message: "Transaction failed",
                error: error.message
            });

        } finally {

            await session.endSession();

            console.log("MongoDB session ended");
        }

    } catch (error) {

        console.error("CONTROLLER ERROR:");
        console.error(error);

        return res.status(500).json({
            message: "Controller error",
            error: error.message
        });
    }
}


async function createInitialFundsTransactionController(req, res) {

    console.log("\n========== INITIAL FUNDS START ==========");

    try {

        const {
            toAccount,
            amount,
            idempotencyKey
        } = req.body;

        console.log("STEP 1: Request:", req.body);
        console.log("Authenticated system user:", req.user?._id);

        if (!toAccount || !amount || !idempotencyKey) {
            return res.status(400).json({
                message:
                    "toAccount, amount and idempotencyKey are required fields"
            });
        }

        if (!mongoose.Types.ObjectId.isValid(toAccount)) {
            return res.status(400).json({
                message: "Invalid account ID"
            });
        }

        const transactionAmount = Number(amount);

        if (
            !Number.isFinite(transactionAmount) ||
            transactionAmount <= 0
        ) {
            return res.status(400).json({
                message: "Amount must be a positive number"
            });
        }


        console.log("STEP 2: Checking idempotency...");

        const transactionAlreadyExists =
            await transactionModel.findOne({
                idempotencyKey
            });

        if (transactionAlreadyExists) {

            if (transactionAlreadyExists.status === "COMPLETED") {
                return res.status(200).json({
                    message: "Initial funds transaction already processed",
                    transaction: transactionAlreadyExists
                });
            }

            if (transactionAlreadyExists.status === "PENDING") {
                return res.status(400).json({
                    message: "Transaction is already in progress",
                    transaction: transactionAlreadyExists
                });
            }

            return res.status(400).json({
                message: "Transaction cannot be processed again",
                transaction: transactionAlreadyExists
            });
        }


        console.log("STEP 3: Finding receiver account...");

        const toUserAccount = await accountModel
            .findById(toAccount)
            .populate("user", "email name");

        if (!toUserAccount) {
            return res.status(400).json({
                message: "Invalid toAccount"
            });
        }

        console.log("Receiver account:", toUserAccount);


        console.log("STEP 4: Finding system account...");

        const fromUserAccount = await accountModel
            .findOne({
                systemAccount: true,
                user: req.user._id
            })
            .populate("user", "email name");

        console.log("System account:", fromUserAccount);

        if (!fromUserAccount) {
            return res.status(400).json({
                message:
                    "System account not found for the user"
            });
        }


        if (fromUserAccount.status !== "ACTIVE") {
            return res.status(400).json({
                message: "System account is not ACTIVE"
            });
        }

        if (toUserAccount.status !== "ACTIVE") {
            return res.status(400).json({
                message: "Receiver account is not ACTIVE"
            });
        }


        console.log("STEP 5: Starting MongoDB transaction...");

        const session = await mongoose.startSession();

        try {

            session.startTransaction();


            console.log("STEP 6: Creating transaction...");

            const transaction =
                new transactionModel({
                    fromAccount:
                        fromUserAccount._id,

                    toAccount:
                        toUserAccount._id,

                    amount:
                        transactionAmount,

                    idempotencyKey,

                    status: "PENDING"
                });


            console.log("STEP 7: Creating CREDIT ledger...");

            const creditLedgerArray =
                await ledgerModel.create(
                    [{
                        account:
                            toUserAccount._id,

                        amount:
                            transactionAmount,

                        transaction:
                            transaction._id,

                        type: "CREDIT"
                    }],
                    { session }
                );

            const creditLedgerEntry =
                creditLedgerArray[0];


            console.log("STEP 8: Creating DEBIT ledger...");

            const debitLedgerArray =
                await ledgerModel.create(
                    [{
                        account:
                            fromUserAccount._id,

                        amount:
                            transactionAmount,

                        transaction:
                            transaction._id,

                        type: "DEBIT"
                    }],
                    { session }
                );

            const debitLedgerEntry =
                debitLedgerArray[0];


            console.log("STEP 9: Completing transaction...");

            transaction.status = "COMPLETED";

            await transaction.save({
                session
            });


            console.log("STEP 10: Committing transaction...");

            await session.commitTransaction();

            console.log("MongoDB transaction committed");


            console.log("STEP 11: Sending receiver email...");

            await emailService.sendTransactionEmail(
                toUserAccount.user.email,
                toUserAccount.user.name,
                transactionAmount,
                fromUserAccount._id
            );


            console.log("STEP 12: Sending system email...");

            await emailService.sendTransactionEmail(
                fromUserAccount.user.email,
                fromUserAccount.user.name,
                transactionAmount,
                toUserAccount._id
            );


            console.log("STEP 13: Sending response...");

            return res.status(201).json({
                message:
                    "Initial funds transaction completed successfully",

                transaction,

                debitLedgerEntry,

                creditLedgerEntry
            });

        } catch (error) {

            console.error("INITIAL FUNDS TRANSACTION ERROR:");
            console.error(error);

            if (session.inTransaction()) {
                await session.abortTransaction();
            }

            return res.status(500).json({
                message:
                    "Initial funds transaction failed",
                error:
                    error.message
            });

        } finally {

            await session.endSession();

            console.log("MongoDB session ended");
        }

    } catch (error) {

        console.error("INITIAL FUNDS CONTROLLER ERROR:");
        console.error(error);

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