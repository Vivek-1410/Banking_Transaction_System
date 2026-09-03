const mongoose = require("mongoose")

const userSchema = mongoose.Schema({
    email: {
        type: String,
        required: [true, "Email is required for creating user."],
        trim: true,
        lowercase: true,
        match: [/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/, "Invalid Email address"],
        unique: [true, "Email already exists"]
    },
    name: {
        type: String,
        
    }
})