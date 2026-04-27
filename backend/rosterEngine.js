const Employee = require("./models/Employee");
const Application = require("./models/Application");
const RosterSnapshot = require("./models/RosterSnapshot");

/** Minutes from midnight for login / logout window (IST wall-clock times). */
const WINDOW_START_MIN = 7 * 60 + 30;
const WINDOW_END_MIN = 20 * 60 + 30;

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * 7:30 AM → 8:30 PM IST in steps of 2 hours (last segment may be 1 hour).
 * Keys look like "07:30-09:30" (always IST labels).
 */
function buildSlotsIST() {
  const slots = [];
  let cur = WINDOW_START_MIN;
  while (cur < WINDOW_END_MIN) {
    const next = Math.min(cur + 120, WINDOW_END_MIN);
    const sh = Math.floor(cur / 60);
    const sm = cur % 60;
    const eh = Math.floor(next / 60);
    const em = next % 60;
    slots.push(`${pad2(sh)}:${pad2(sm)}-${pad2(eh)}:${pad2(em)}`);
    cur = next;
  }
  return slots;
}

const SLOTS = buildSlotsIST();
const validSlotSet = new Set(SLOTS);

/**
 * Preference bands (morning / middle / late) split the working window into thirds by slot index.
 */
function buildShiftToSlots() {
  const n = SLOTS.length;
  const a = Math.ceil(n / 3);
  const b = Math.ceil((2 * n) / 3);
  return {
    morning: new Set(SLOTS.slice(0, a)),
    middle: new Set(SLOTS.slice(a, b)),
    late: new Set(SLOTS.slice(b, n))
  };
}

const SHIFT_TO_SLOTS = buildShiftToSlots();

function isWeekend(dateStr) {
  const d = new Date(dateStr);
  return d.getDay() === 0 || d.getDay() === 6;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function inRange(date, from, to) {
  const d = new Date(date);
  return d >= new Date(from) && d <= new Date(to);
}

function getShiftPreferenceForDate(emp, dateStr) {
  const prefs = emp.shiftPreferences || [];
  let shift = null;
  for (const p of prefs) {
    if (inRange(dateStr, p.from, p.to)) shift = p.shift;
  }
  return shift;
}

function isEligibleForSlot(emp, dateStr, slot) {
  const shift = getShiftPreferenceForDate(emp, dateStr);
  if (!shift) return true;
  const allowed = SHIFT_TO_SLOTS[shift];
  return allowed ? allowed.has(slot) : false;
}

function filterByShiftForSlot(employees, dateStr, slot) {
  return employees.filter(e => isEligibleForSlot(e, dateStr, slot));
}

function getWeekendIndex(year, month, dateStr) {
  const target = new Date(dateStr);
  let count = -1;

  for (let day = 1; day <= target.getDate(); day++) {
    const cur = new Date(year, month - 1, day);
    if (cur.getDay() === 6) count++;
  }
  return count;
}

async function fetchEmployeesAndApplications() {
  const [employees, applications] = await Promise.all([
    Employee.find().sort({ name: 1 }).lean(),
    Application.find().lean()
  ]);
  return { employees, applications };
}

/** Build roster from already-loaded employees + applications (no extra DB round-trips). */
function generateRosterFromCore(year, month, employees, applications) {
  const roster = [];
  if (employees.length < 2) return [];

  const shiftCount = {};
  employees.forEach(e => (shiftCount[e._id.toString()] = 0));

  const appMap = {};
  for (const app of applications) {
    const id = app.employeeId.toString();
    if (!appMap[id]) appMap[id] = [];
    appMap[id].push(app);
  }

  const totalDays = daysInMonth(year, month);

  for (let day = 1; day <= totalDays; day++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")}`;

    const weekend = isWeekend(date);

    let availableEmployees;

    if (weekend) {
      const weekendIndex = getWeekendIndex(year, month, date);
      const pairStart = (weekendIndex * 2) % employees.length;

      availableEmployees = [
        employees[pairStart],
        employees[(pairStart + 1) % employees.length]
      ];
    } else {
      availableEmployees = employees.filter(emp => {
        const apps = appMap[emp._id.toString()] || [];
        return !apps.some(a => inRange(date, a.from, a.to));
      });
    }

    if (availableEmployees.length === 0) {
      throw new Error(`No employees available on ${date}`);
    }

    for (const slot of SLOTS) {
      let pool = filterByShiftForSlot(availableEmployees, date, slot);

      if (pool.length === 0) {
        throw new Error(
          `No employee is eligible for ${slot} on ${date} (check shift preferences).`
        );
      }

      pool = [...pool];

      if (!weekend) {
        pool.sort(
          (a, b) =>
            shiftCount[a._id.toString()] - shiftCount[b._id.toString()]
        );
      }

      const primary = pool[0];
      const backup = pool[1] || pool[0];

      if (!weekend) {
        shiftCount[primary._id.toString()]++;
        shiftCount[backup._id.toString()]++;
      }

      roster.push({
        date,
        slot,
        primary: primary.name,
        backup: backup.name,
        weekend
      });
    }
  }

  return roster;
}

async function generateRoster(year, month) {
  const { employees, applications } = await fetchEmployeesAndApplications();
  return generateRosterFromCore(year, month, employees, applications);
}

/** Leave overlay for the month; uses the same `employees` + `applications` as roster generation. */
function buildAbsencesMap(year, month, employees, applications) {
  const totalDays = daysInMonth(year, month);
  const out = {};
  const byId = new Map(employees.map(e => [e._id.toString(), e]));

  for (let day = 1; day <= totalDays; day++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")}`;

    const list = [];
    for (const app of applications) {
      const emp = app.employeeId && byId.get(app.employeeId.toString());
      if (!emp) continue;
      if (inRange(date, app.from, app.to)) {
        list.push({
          name: emp.name,
          type: app.type
        });
      }
    }
    if (list.length) out[date] = list;
  }

  return out;
}

/**
 * Merge a possibly incomplete custom snapshot with generated rows so every date×slot exists.
 */
function ensureFullRoster(year, month, partialRoster, employees, applications) {
  const expected = daysInMonth(year, month) * SLOTS.length;
  if (!partialRoster?.length || partialRoster.length < expected) {
    const generated = generateRosterFromCore(year, month, employees, applications);
    if (!partialRoster?.length) return generated;
    const map = new Map(partialRoster.map(e => [`${e.date}_${e.slot}`, e]));
    return generated.map(g => map.get(`${g.date}_${g.slot}`) || g);
  }
  return partialRoster;
}

/**
 * Same roster the UI should see: auto-generated, or custom snapshot with gaps filled.
 * Pass `employees`, `applications`, and optionally `snapPreloaded` from one parallel `Promise.all`
 * to avoid duplicate queries on GET /api/roster.
 *
 * @param snapPreloaded pass result of `findOne` (or `undefined` to fetch inside)
 */
async function loadMergedRoster(
  year,
  month,
  employees,
  applications,
  snapPreloaded
) {
  if (!employees || !applications) {
    const data = await fetchEmployeesAndApplications();
    employees = data.employees;
    applications = data.applications;
  }

  const snap =
    snapPreloaded !== undefined
      ? snapPreloaded
      : await RosterSnapshot.findOne({ year, month }).lean();

  if (snap?.entries?.length) {
    const usesOldSlots = snap.entries.some(e => !validSlotSet.has(e.slot));
    if (usesOldSlots) {
      await RosterSnapshot.deleteOne({ year, month });
      return {
        roster: generateRosterFromCore(year, month, employees, applications),
        isCustom: false,
        swapLog: []
      };
    }
    return {
      roster: ensureFullRoster(year, month, snap.entries, employees, applications),
      isCustom: true,
      swapLog: snap.swapLog || []
    };
  }
  return {
    roster: generateRosterFromCore(year, month, employees, applications),
    isCustom: false,
    swapLog: []
  };
}

module.exports = {
  generateRoster,
  generateRosterFromCore,
  fetchEmployeesAndApplications,
  SLOTS,
  buildAbsencesMap,
  validSlotSet,
  loadMergedRoster
};
