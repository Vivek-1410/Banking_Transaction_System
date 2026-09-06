const mongoose = require("mongoose")

const tokenBlacklistSchema = mongoose.Schema({
    token: {
        type: String,
        required: [true, "Token is required for blacklisting"],
        unique: [true, "Token already exists in the blacklist"]
    }
},{
    timestamps: true
})

tokenBlacklistSchema.index({createdAt: 1, expireAfterSeconds: 360*60*24*3})

const tokenBlacklistModel = mongoose.model("tokenBlacklist", tokenBlacklistSchema)

module.exports = tokenBlacklistModel