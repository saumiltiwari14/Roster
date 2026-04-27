const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const express = require("express");
const cors = require("cors");
const connectDB = require("./db");
const Employee = require("./models/Employee");
const Application = require("./models/Application");
const RosterSnapshot = require("./models/RosterSnapshot");
const {
  SLOTS,
  buildAbsencesMap,
  validSlotSet,
  loadMergedRoster
} = require("./rosterEngine");
const {
  creditWeekendDay,
  syncWeekendCreditsForMonth
} = require("./weekendCreditSync");

const app = express();

/** Strip Services route prefix so existing `/api/*` routes match (see vercel.json experimentalServices). */
const BACKEND_ROUTE_PREFIX = "/_/backend";
app.use((req, _res, next) => {
  if (typeof req.url === "string" && req.url.startsWith(BACKEND_ROUTE_PREFIX)) {
    req.url = req.url.slice(BACKEND_ROUTE_PREFIX.length) || "/";
  }
  next();
});

app.set("trust proxy", 1);

/* ===========================
   ✅ MIDDLEWARES
=========================== */
app.use(cors());
app.use(express.json());

/* ===========================
   ✅ SERVE FRONTEND
=========================== */
const publicPath = path.join(__dirname, "..", "public");
app.use(express.static(publicPath));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

app.get("/api/health", async (req, res) => {
  try {
    await connectDB();
    const employees = await Employee.countDocuments();
    res.json({ ok: true, mongo: true, employees });
  } catch (err) {
    res.status(503).json({
      ok: false,
      mongo: false,
      error: err.message || "Database unavailable"
    });
  }
});

/* ===========================
   ✅ ROSTER (+ leave overlay, IST meta, optional custom snapshot)
=========================== */
app.get("/api/roster", async (req, res) => {
  try {
    await connectDB();

    const now = new Date();
    const year = req.query.year
      ? parseInt(req.query.year, 10)
      : now.getFullYear();
    const month = req.query.month
      ? parseInt(req.query.month, 10)
      : now.getMonth() + 1;

    const [employees, applications, snap] = await Promise.all([
      Employee.find().sort({ name: 1 }).lean(),
      Application.find().lean(),
      RosterSnapshot.findOne({ year, month }).lean()
    ]);
    const employeeCount = employees.length;

    const {
      roster,
      isCustom: rosterFromSnapshot,
      swapLog: snapSwapLog
    } = await loadMergedRoster(year, month, employees, applications, snap);

    const absencesByDate = buildAbsencesMap(year, month, employees, applications);

    const swapLog = rosterFromSnapshot
      ? (snapSwapLog || []).slice().reverse()
      : [];

    res.json({
      year,
      month,
      timezone: "Asia/Kolkata",
      slots: SLOTS,
      roster,
      employeeCount,
      absencesByDate,
      isCustom: rosterFromSnapshot,
      swapLog
    });

    setImmediate(() => {
      syncWeekendCreditsForMonth(year, month, roster).catch(err =>
        console.warn("Weekend comp‑off sync:", err.message)
      );
    });
  } catch (err) {
    console.error("Roster error:", err);
    res.status(500).json({
      error: err.message || "Failed to generate roster"
    });
  }
});

/* Save drag‑drop / manual edits for a month */
app.post("/api/roster/custom", async (req, res) => {
  try {
    await connectDB();

    const { year, month, entries, swapNote } = req.body;

    if (
      year == null ||
      month == null ||
      !Array.isArray(entries) ||
      entries.length === 0
    ) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    for (const e of entries) {
      if (
        !e.date ||
        !e.slot ||
        e.primary === undefined ||
        e.backup === undefined ||
        typeof e.weekend !== "boolean"
      ) {
        return res.status(400).json({
          error:
            "Each entry needs date, slot, primary, backup, weekend (boolean)"
        });
      }
      if (!validSlotSet.has(e.slot)) {
        return res.status(400).json({
          error:
            "Saved roster uses old slot format. Click “Reset to auto roster” and save again."
        });
      }
    }

    const existing = await RosterSnapshot.findOne({ year, month }).lean();
    let swapLog = existing?.swapLog ? [...existing.swapLog] : [];

    if (swapNote && String(swapNote).trim()) {
      swapLog.push({
        message: String(swapNote).trim(),
        at: new Date()
      });
      if (swapLog.length > 50) {
        swapLog = swapLog.slice(-50);
      }
    }

    await RosterSnapshot.findOneAndUpdate(
      { year, month },
      { year, month, entries, swapLog },
      { upsert: true, returnDocument: "after" }
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Save roster error:", err);
    res.status(500).json({ error: "Failed to save roster" });
  }
});

/* Discard manual roster and regenerate from rules */
app.delete("/api/roster/custom", async (req, res) => {
  try {
    await connectDB();

    const year = parseInt(req.query.year, 10);
    const month = parseInt(req.query.month, 10);

    if (!year || !month) {
      return res.status(400).json({ error: "year and month query params required" });
    }

    await RosterSnapshot.deleteOne({ year, month });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete roster snapshot error:", err);
    res.status(500).json({ error: "Failed to reset roster" });
  }
});

/* ===========================
   ✅ APPLY LEAVE / COMPOFF
=========================== */
app.post("/api/apply", async (req, res) => {
  try {
    await connectDB();

    const { employeeId, from, to, type } = req.body;

    const emp = await Employee.findById(employeeId);
    if (!emp) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const days =
      Math.floor((new Date(to) - new Date(from)) / 86400000) + 1;

    if (type === "compoff") {
      if (emp.compOff < days) {
        return res.status(400).json({
          error: "Insufficient comp‑off balance"
        });
      }
      emp.compOff -= days;
      await emp.save();
    }

    const application = await Application.create({
      employeeId,
      from,
      to,
      type
    });

    res.json({ success: true, application });
  } catch (err) {
    console.error("Apply error:", err);
    res.status(500).json({ error: "Failed to apply" });
  }
});

/* ===========================
   ✅ LIST APPLICATIONS
=========================== */
app.get("/api/applications", async (req, res) => {
  try {
    await connectDB();

    const apps = await Application.find()
      .populate("employeeId", "name")
      .sort({ createdAt: -1 });

    res.json(
      apps.map(a => ({
        id: a._id,
        name: a.employeeId.name,
        from: a.from.toISOString().slice(0, 10),
        to: a.to.toISOString().slice(0, 10),
        type: a.type
      }))
    );
  } catch (err) {
    console.error("List applications error:", err);
    res.status(500).json({ error: "Failed to fetch applications" });
  }
});

/* ===========================
   ✅ EMPLOYEES (for dropdowns)
=========================== */
app.get("/api/employees", async (req, res) => {
  try {
    await connectDB();

    const employees = await Employee.find()
      .sort({ name: 1 })
      .select("name")
      .lean();

    res.json(
      employees.map(e => ({
        _id: e._id,
        name: e.name
      }))
    );
  } catch (err) {
    console.error("Employees error:", err);
    res.status(500).json({ error: "Failed to fetch employees" });
  }
});

/* ===========================
   ✅ SHIFT PREFERENCE
=========================== */
app.post("/api/shift-preference", async (req, res) => {
  try {
    await connectDB();

    const { employeeId, shift, from, to } = req.body;

    if (!employeeId || !shift || !from || !to) {
      return res.status(400).json({ error: "Missing fields" });
    }

    if (!["morning", "middle", "late"].includes(shift)) {
      return res.status(400).json({ error: "Invalid shift" });
    }

    if (from > to) {
      return res.status(400).json({ error: "From date cannot be after To date" });
    }

    const emp = await Employee.findById(employeeId);
    if (!emp) {
      return res.status(404).json({ error: "Employee not found" });
    }

    emp.shiftPreferences.push({
      shift,
      from: new Date(from),
      to: new Date(to)
    });
    await emp.save();

    res.json({ success: true });
  } catch (err) {
    console.error("Shift preference error:", err);
    res.status(500).json({ error: "Failed to save shift preference" });
  }
});

app.get("/api/shift-preferences", async (req, res) => {
  try {
    await connectDB();

    const employees = await Employee.find()
      .sort({ name: 1 })
      .select("name shiftPreferences")
      .lean();

    const rows = [];

    for (const e of employees) {
      for (const p of e.shiftPreferences || []) {
        rows.push({
          name: e.name,
          shift: p.shift,
          from: p.from.toISOString().slice(0, 10),
          to: p.to.toISOString().slice(0, 10)
        });
      }
    }

    rows.sort((a, b) => b.from.localeCompare(a.from) || a.name.localeCompare(b.name));

    res.json(rows);
  } catch (err) {
    console.error("Shift preferences list error:", err);
    res.status(500).json({ error: "Failed to fetch shift preferences" });
  }
});

/* ===========================
   ✅ COMP‑OFF BALANCES
=========================== */
app.get("/api/balances", async (req, res) => {
  try {
    await connectDB();

    const balances = await Employee.find()
      .select("name compOff")
      .sort({ name: 1 });

    res.json(balances);

    const now = new Date();
    setImmediate(() => {
      const y = now.getFullYear();
      const m = now.getMonth() + 1;
      syncWeekendCreditsForMonth(y, m).catch(e =>
        console.warn("Weekend comp‑off sync (balances):", e.message)
      );
    });
  } catch (err) {
    console.error("Balances error:", err);
    res.status(500).json({ error: "Failed to fetch balances" });
  }
});

/* ===========================
   ✅ WEEKEND CREDIT (ROTATIONAL)
   – Call once per DAY (Sat/Sun)
=========================== */
app.post("/api/credit-weekend", async (req, res) => {
  try {
    await connectDB();

    const date = new Date(req.body.date);
    const result = await creditWeekendDay(date);

    if (result.skipped) {
      return res.json({ message: "Not a weekend day or not enough staff" });
    }

    res.json({
      success: true,
      credited: result.credited || [],
      namesOnRoster: result.namesOnRoster || [],
      date: date.toISOString().slice(0, 10)
    });
  } catch (err) {
    console.error("Weekend credit error:", err);
    res.status(500).json({ error: "Failed to credit weekend" });
  }
});

/* ===========================
   ✅ DELETE / CANCEL APPLICATION
=========================== */
app.delete("/api/applications/:id", async (req, res) => {
  try {
    await connectDB();

    const appDoc = await Application.findById(req.params.id);
    if (!appDoc) {
      return res.status(404).json({ error: "Not found" });
    }

    // Restore comp‑off if cancelled
    if (appDoc.type === "compoff") {
      const days =
        Math.floor((appDoc.to - appDoc.from) / 86400000) + 1;

      await Employee.findByIdAndUpdate(appDoc.employeeId, {
        $inc: { compOff: days }
      });
    }

    await appDoc.deleteOne();
    res.json({ success: true });
  } catch (err) {
    console.error("Delete application error:", err);
    res.status(500).json({ error: "Failed to delete application" });
  }
});

/* ===========================
   ✅ START SERVER (local only — Vercel uses api/index.js entry)
=========================== */
module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ Backend running at http://localhost:${PORT}`);
    connectDB().catch(err =>
      console.error("[db] Warm-up connection:", err.message)
    );
  });
}
