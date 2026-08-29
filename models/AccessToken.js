const mongoose = require("mongoose");

const accessTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  label: {
    type: String,
    default: ""          // e.g. "John's PC" — just a friendly name
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
