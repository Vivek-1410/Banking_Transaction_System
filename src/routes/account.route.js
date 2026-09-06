const express = require("express")
const router = express.Router()

const authMiddleware = require("../middleware/auth.middleware")

const accountController = require("../controller/account.controller")


router.post("/", authMiddleware.authMiddleware, accountController.createAccountController)

router.get("/", authMiddleware.authMiddleware, accountController.getUserAccountsController)

router.get("/balance/:accountId", authMiddleware.authMiddleware, accountController.getUserAccountsBalanceController)


module.exports = router