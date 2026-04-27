const mongoose = require("mongoose");

const EntrySchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    slot: { type: String, required: true },
    primary: { type: String, required: true },
    backup: { type: String, required: true },
    weekend: { type: Boolean, required: true }
  },
  { _id: false }
);

const SwapEntrySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    message: { type: String, required: true }
  },
  { _id: false }
);

const RosterSnapshotSchema = new mongoose.Schema({
  year: { type: Number, required: true },
  month: { type: Number, required: true },
  entries: { type: [EntrySchema], default: [] },
  swapLog: { type: [SwapEntrySchema], default: [] }
});

RosterSnapshotSchema.index({ year: 1, month: 1 }, { unique: true });

module.exports = mongoose.model("RosterSnapshot", RosterSnapshotSchema);
