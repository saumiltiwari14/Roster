const Employee = require("./models/Employee");
const WeekendCredit = require("./models/WeekendCredit");
const { loadMergedRoster } = require("./rosterEngine");

const IST_TZ = "Asia/Kolkata";

function todayISOIST() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function collectNamesFromRows(rows) {
  const names = new Set();
  for (const row of rows) {
    const p = row.primary != null ? String(row.primary).trim() : "";
    const b = row.backup != null ? String(row.backup).trim() : "";
    if (p) names.add(p);
    if (b) names.add(b);
  }
  return names;
}

async function awardCompOffForDate(dateStr, nameSet, nameToId) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const creditDate = new Date(y, m - 1, d);
  const credited = [];

  for (const name of nameSet) {
    const empId = nameToId.get(name);
    if (!empId) continue;
    try {
      await WeekendCredit.create({
        employeeId: empId,
        date: creditDate
      });
      await Employee.updateOne({ _id: empId }, { $inc: { compOff: 1 } });
      credited.push(name);
    } catch {
      /* duplicate credit for this employee + calendar date */
    }
  }

  return credited;
}

/**
 * For each weekend date in the roster that is strictly before today (IST), award 1 comp‑off
 * per employee who appears as primary or backup on that date (any slot).
 */
async function syncWeekendCreditsForMonth(year, month, rosterOptional) {
  const roster =
    rosterOptional || (await loadMergedRoster(year, month)).roster;
  if (!roster?.length) return;

  const employees = await Employee.find().sort({ name: 1 }).lean();
  if (employees.length < 2) return;

  const nameToId = new Map(
    employees.map(e => [String(e.name).trim(), e._id])
  );

  const todayIST = todayISOIST();

  const weekendDates = [
    ...new Set(roster.filter(r => r.weekend).map(r => r.date))
  ].sort();

  for (const dateStr of weekendDates) {
    if (dateStr >= todayIST) continue;

    const rows = roster.filter(r => r.date === dateStr && r.weekend);
    const names = collectNamesFromRows(rows);
    if (names.size === 0) continue;

    await awardCompOffForDate(dateStr, names, nameToId);
  }
}

/**
 * Manual trigger: credit comp‑offs for one calendar day (must be weekend, in the past IST,
 * and names must appear on the merged roster for that day).
 */
async function creditWeekendDay(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return { skipped: true };

  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const dayNum = d.getDate();
  const dateStr = `${y}-${String(mo).padStart(2, "0")}-${String(dayNum).padStart(
    2,
    "0"
  )}`;

  if (dateStr >= todayISOIST()) return { skipped: true };

  const { roster } = await loadMergedRoster(y, mo);
  const rows = roster.filter(r => r.date === dateStr && r.weekend);
  if (!rows.length) return { skipped: true };

  const employees = await Employee.find().sort({ name: 1 }).lean();
  if (employees.length < 2) return { skipped: true };

  const nameToId = new Map(
    employees.map(e => [String(e.name).trim(), e._id])
  );

  const names = collectNamesFromRows(rows);
  const credited = await awardCompOffForDate(dateStr, names, nameToId);

  return { credited, namesOnRoster: [...names] };
}

module.exports = {
  creditWeekendDay,
  syncWeekendCreditsForMonth
};
