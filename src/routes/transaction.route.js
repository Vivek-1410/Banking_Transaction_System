const express = require("express")

const router = express.Router()

const authMiddleware = require("../middleware/auth.middleware")

const transactionController = require("../controller/transaction.controller")

router.post("/", authMiddleware.authMiddleware, transactionController.createTransactionController)

router.post("/system/initial-funds", authMiddleware.systemUserAuthMiddleware, transactionController.createInitialFundsTransactionController)

module.exports = router

