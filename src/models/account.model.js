const mongoose = require("mongoose")

const accountSchema = mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        required: [true, "Account must be associated with user"],
        index: true
    },
    status: {
        type: String,
        enum: {
            values: ["ACTIVE", "FROZEN", "CLOSED"],
            message: "Status must be active, frozen or closed",
        },
        default: "ACTIVE"
    },
    currency: {
        type: String,
        required: [true, "Currency is required to create an account"],
        default: "INR"
    }
},{
    timestamps: true
})

accountSchema.index({user: 1, status: 1})

const accountModel = mongoose.model("account", accountSchema)

module.exports = accountModel