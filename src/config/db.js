const mongoose = require("mongoose");

async function connectToDB() {
    console.log("7. Trying to connect to MongoDB...");

    try {
        await mongoose.connect(process.env.MONGO_URI);

        console.log("8. Database connected");
    } catch (error) {
        console.log("9. Database connection error:", error);
    }
}

module.exports = connectToDB;