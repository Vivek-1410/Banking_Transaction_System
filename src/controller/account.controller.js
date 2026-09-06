const accountModel = require("../models/account.model");
const ledgerModel = require("../models/ledger.model");

const mongoose = require("mongoose");


async function createAccountController(req, res) {

    const user = req.user;

    const account = await accountModel.create({
        user: user._id,
        currency: req.body.currency
    });

    return res.status(201).json({
        account
    });
}


async function getUserAccountsController(req, res) {

    const user = req.user;

    const accounts = await accountModel.find({
        user: user._id
    });

    return res.status(200).json({
        accounts
    });
}


async function getUserAccountsBalanceController(req, res) {

    const { accountId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(accountId)) {
        return res.status(400).json({
            message: "Invalid account ID"
        });
    }

    const account = await accountModel.findById(accountId);

    if (!account) {
        return res.status(404).json({
            message: "Account not found"
        });
    }

    if (account.user.toString() !== req.user._id.toString()) {
        return res.status(403).json({
            message: "You can only check the balance of your own account"
        });
    }

    const balanceResult = await ledgerModel.aggregate([
        {
            $match: {
                account: new mongoose.Types.ObjectId(accountId)
            }
        },
        {
            $group: {
                _id: "$account",

                credit: {
                    $sum: {
                        $cond: [
                            { $eq: ["$type", "CREDIT"] },
                            "$amount",
                            0
                        ]
                    }
                },

                debit: {
                    $sum: {
                        $cond: [
                            { $eq: ["$type", "DEBIT"] },
                            "$amount",
                            0
                        ]
                    }
                }
            }
        }
    ]);

    const balance =
        (balanceResult[0]?.credit || 0) -
        (balanceResult[0]?.debit || 0);

    return res.status(200).json({
        accountId,
        balance
    });
}


module.exports = {
    createAccountController,
    getUserAccountsController,
    getUserAccountsBalanceController
};