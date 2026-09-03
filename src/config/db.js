const mongoose = require("mongoose")


function connectToDB() {
    mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("Database connected");
    })
    .catch((err) => {
        console.log("Error");
        process.exit(1)
    })
}

module.exports = connectToDB