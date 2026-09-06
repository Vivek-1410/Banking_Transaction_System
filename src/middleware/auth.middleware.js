const userModel = require("../models/user.model")
const blackListModel = require("../models/blackList.model")

const jwt = require("jsonwebtoken")

async function authMiddleware(req, res, next) {
    const token = req.cookies.token || req.headers.authorization?.split(" ")[1]

    if(!token) {
        return res.status(401).json({
            message: "Unauthorized access, token is missing"
        })
    }

    const isBlacklisted = await blackListModel.findOne({ token })

    if(isBlacklisted) {
        return res.status(401).json({
            message: "Unauthorized access, token is blacklisted"
        })
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY)

        const user = await userModel.findById(decoded.userID)
 
        req.user = user

        return next()

    } catch (err) {
        return res.status(401).json({
            message: "Unauthorized access, token is invalid"
        }) 
    }
}

async function systemUserAuthMiddleware(req, res, next) {
    const token = req.cookies.token || req.headers.authorization?.split(" ")[1]

    if(!token) {
        return res.status(401).json({
            message: "Unauthorized access, token is missing"
        })
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY)

        const user = await userModel.findById(decoded.userID).select("+systemUser")

        if(!user.systemUser) {
            return res.status(403).json({
                message: "Forbidden access, user is not a system user"
            })
        }

        req.user = user

        return next()

    } catch (err) {
        return res.status(401).json({
            message: "Unauthorized access, token is invalid"
        })
    }
}

module.exports = {
    authMiddleware,
    systemUserAuthMiddleware
}