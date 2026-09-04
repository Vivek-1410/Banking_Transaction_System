const userModel = require("../models/user.model")
const jwt = require("jsonwebtoken")
const emailService = require("../services/email.service")

const userRegisterController = async (req, res) => {
    const {email, password, name} = req.body

    const alreadyExists = await userModel.findOne({
        email: email
    })

    if(alreadyExists) {
        return res.status(422).json({
            message: "User already exists with this email",
            status: "failed"
        })
    }

    const user = await userModel.create({
        email,
        password,
        name
    });

    const token = jwt.sign({userID: user._id}, process.env.JWT_SECRET_KEY, {expiresIn: "3d"})

    res.cookie("token", token)

    res.status(201).json({
        user: {
            _id: user._id,
            email: user.email,
            name: user.name
        },
        token
    })

    await emailService.sendRegistrationEmail(user.email, user.name)

    console.log("USER CREATED:", user);
}

const userLoginController = async (req, res) => {
    const {email, password} = req.body

    const user = await userModel.findOne({email}).select("+password")

    if(!user) {
        return res.status(401).json({
            message: "Email or Password is Invalid"
        })
    }

    const isValidpass = await user.comparePassword(password)

    if(!isValidpass) {
        return res.status(401).json({
            message: "Email or Password is Invalid"
        })
    }

    const token = jwt.sign({userID: user._id}, process.env.JWT_SECRET_KEY, {expiresIn: "3d"})

    res.cookie("token", token)

    res.status(201).json({
        user: {
            _id: user._id,
            email: user.email,
            name: user.name
        },
        token
    })


}

module.exports = {
    userRegisterController,
    userLoginController
}