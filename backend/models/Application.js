// models/Application.js
const mongoose = require("mongoose");

const ApplicationSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee",
    required: true
  },
  from: { type: Date, required: true },
  to: { type: Date, required: true },
  type: {
    type: String,
    enum: ["leave", "compoff"],
    required: true
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Application", ApplicationSchema);
