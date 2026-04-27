const mongoose = require("mongoose");

const EmployeeSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  compOff: { type: Number, default: 0 },

  // ✅ NEW FIELD
  shiftPreferences: [
    {
      shift: {
        type: String,
        enum: ["morning", "middle", "late"],
        required: true
      },
      from: {
        type: Date,
        required: true
      },
      to: {
        type: Date,
        required: true
      }
    }
  ]
});

module.exports = mongoose.model("Employee", EmployeeSchema);
