const mongoose = require("mongoose");

const accessTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    trim: true
    // Store exactly as entered — e.g. "123456"
  },
  label: {
    type: String,
    default: ""   // e.g. "Customer - John"
  },
  status: {
    type: String,
    enum: ["approved", "revoked"],
    default: "approved"
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("AccessToken", accessTokenSchema);
