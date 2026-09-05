const express = require("express")
const router = express.Router()

const authMiddleware = require("../middleware/auth.middleware")

const accountController = require("../controller/account.controller")


router.post("/", authMiddleware.authMiddleware, accountController.createAccountController)

module.exports = router