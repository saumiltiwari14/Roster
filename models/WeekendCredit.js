// models/WeekendCredit.js
const mongoose = require("mongoose");

const WeekendCreditSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee",
    required: true
  },
  date: { type: Date, required: true }
});

// ✅ Prevent duplicate credits
WeekendCreditSchema.index(
  { employeeId: 1, date: 1 },
  { unique: true }
);

module.exports = mongoose.model("WeekendCredit", WeekendCreditSchema);