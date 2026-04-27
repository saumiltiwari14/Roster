/** @typedef {{ date: string, slot: string, primary: string, backup: string, weekend: boolean }} RosterEntry */

const IST_TZ = "Asia/Kolkata";

let rosterState = /** @type {RosterEntry[]} */ ([]);
let absencesByDate = {};
let slotsOrder = /** @type {string[]} */ ([]);
let isCustom = false;
let swapLogList = /** @type {{ at: string, message: string }[]} */ ([]);
let lastEmployeeCount = -1;

const nowInit = new Date();
let viewYear = nowInit.getFullYear();
let viewMonth = nowInit.getMonth() + 1;

/** Calendar date in Asia/Kolkata (matches roster columns). */
function getTodayISO() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function formatLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatSlotRangeIST(slot) {
  const m = slot.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
  if (!m) return slot;
  const t = (h, min) => {
    const d = new Date(2000, 0, 1, parseInt(h, 10), parseInt(min, 10));
    return d.toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
  };
  return `${t(m[1], m[2])} – ${t(m[3], m[4])} IST`;
}

function parseSlotBoundsMin(slot) {
  const m = slot.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
  if (!m) return null;
  const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const end = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
  return { start, end };
}

function getISTMinutesNow() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TZ,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const hh = parseInt(parts.find(p => p.type === "hour")?.value ?? "0", 10);
  const mm = parseInt(parts.find(p => p.type === "minute")?.value ?? "0", 10);
  return hh * 60 + mm;
}

function checkCurrentSlot(slot) {
  return getCurrentSlotKey() === slot;
}

/** Which roster slot key is active in IST right now; null outside 7:30–20:30. */
function getCurrentSlotKey() {
  const order =
    slotsOrder.length > 0
      ? slotsOrder
      : deriveSlotOrderFromRoster(rosterState);
  const now = getISTMinutesNow();
  for (const slot of order) {
    const b = parseSlotBoundsMin(slot);
    if (!b) continue;
    if (now >= b.start && now < b.end) return slot;
  }
  return null;
}

function prefBandLabel(slot) {
  const i = slotsOrder.indexOf(slot);
  if (i === -1) return "";
  const n = slotsOrder.length;
  const a = Math.ceil(n / 3);
  const b = Math.ceil((2 * n) / 3);
  if (i < a) return "Morning";
  if (i < b) return "Middle";
  return "Late";
}

function setMonthTitle(year, month) {
  const d = new Date(year, month - 1, 1);
  document.getElementById("monthTitle").textContent =
    `${d.toLocaleString("en-IN", { month: "long" })} ${year}`;
}

function updateMonthNavLabel() {
  const el = document.getElementById("monthNavLabel");
  if (!el) return;
  const d = new Date(viewYear, viewMonth - 1, 1);
  el.textContent = d.toLocaleString("en-IN", {
    month: "long",
    year: "numeric"
  });
}

function shiftViewMonth(delta) {
  const d = new Date(viewYear, viewMonth - 1 + delta, 1);
  viewYear = d.getFullYear();
  viewMonth = d.getMonth() + 1;
  loadRoster();
}

function goThisMonth() {
  const [y, m] = getTodayISO().split("-").map(Number);
  viewYear = y;
  viewMonth = m;
  loadRoster();
}

function renderAbsenceChips(list) {
  if (!list?.length) return `<span class="abs-quiet">—</span>`;
  return list
    .map(a => {
      const tag = a.type === "compoff" ? "CO" : "LV";
      const cls = a.type === "compoff" ? "co" : "lv";
      return `<span class="abs-tag ${cls}">${escapeHtml(a.name)} ${tag}</span>`;
    })
    .join("");
}

function cellIndex(date, slot) {
  return rosterState.findIndex(r => r.date === date && r.slot === slot);
}

/** When API omits `slots`, rebuild order from roster rows (sorted). */
function deriveSlotOrderFromRoster(roster) {
  if (!roster?.length) return [];
  const seen = new Set();
  const list = [];
  for (const r of roster) {
    if (r.slot && !seen.has(r.slot)) {
      seen.add(r.slot);
      list.push(r.slot);
    }
  }
  list.sort((a, b) => a.localeCompare(b, "en"));
  return list;
}

function swapWithSameDayRule(idx1, field1, idx2, field2) {
  if (idx1 < 0 || idx2 < 0) return null;
  if (idx1 === idx2 && field1 === field2) return null;

  const d1 = rosterState[idx1].date;
  const d2 = rosterState[idx2].date;
  if (d1 !== d2) {
    alert("Swaps are limited to the same day.");
    return null;
  }

  const sk1 = rosterState[idx1].slot;
  const sk2 = rosterState[idx2].slot;
  const n1 = rosterState[idx1][field1];
  const n2 = rosterState[idx2][field2];
  const L1 = field1 === "primary" ? "P" : "B";
  const L2 = field2 === "primary" ? "P" : "B";

  swapFields(idx1, field1, idx2, field2);

  const t1 = formatSlotRangeIST(sk1);
  const t2 = sk1 === sk2 ? "" : formatSlotRangeIST(sk2);
  return `${d1} · ${t1}${sk1 !== sk2 ? " ↔ " + t2 : ""} · ${n1} (${L1}) ↔ ${n2} (${L2})`;
}

function swapFields(i, f1, j, f2) {
  const a = rosterState[i][f1];
  rosterState[i][f1] = rosterState[j][f2];
  rosterState[j][f2] = a;
}

async function persistRoster(swapNote) {
  const body = {
    year: viewYear,
    month: viewMonth,
    entries: rosterState
  };
  if (swapNote) body.swapNote = swapNote;

  const res = await fetch("/api/roster/custom", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || "Could not save roster");
    await loadRoster();
    return false;
  }
  isCustom = true;
  updateCustomBanner();
  return true;
}

function updateCustomBanner() {
  const el = document.getElementById("customBanner");
  const btn = document.getElementById("btnResetRoster");
  if (!el || !btn) return;
  el.hidden = !isCustom;
  btn.hidden = !isCustom;
}

function renderSwapLogPanel() {
  const panel = document.getElementById("swapLogPanel");
  if (!panel) return;
  if (!swapLogList.length) {
    panel.innerHTML = `<p class="swap-muted">No edits this month.</p>`;
    return;
  }
  panel.innerHTML =
    `<ul class="swap-lines">` +
    swapLogList
      .map(entry => {
        const at = entry.at
          ? new Date(entry.at).toLocaleString("en-IN", {
              timeZone: IST_TZ,
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit"
            })
          : "";
        return `<li><span class="swap-time">${escapeHtml(at)}</span> ${escapeHtml(entry.message)}</li>`;
      })
      .join("") +
    `</ul>`;
}

async function resetToAutoRoster() {
  if (!confirm("Reset this month to auto-generated roster?")) return;
  const res = await fetch(
    `/api/roster/custom?year=${viewYear}&month=${viewMonth}`,
    { method: "DELETE" }
  );
  if (!res.ok) {
    alert("Could not reset roster");
    return;
  }
  await loadRoster();
}

async function loadRoster() {
  try {
    const r = await fetch(`/api/roster?year=${viewYear}&month=${viewMonth}`);
    const payload = await r.json();
    if (!r.ok) {
      lastEmployeeCount = -1;
      alert(payload.error || `Server error (${r.status})`);
      renderRosterCanvas();
      void updateLiveDutyCard();
      return;
    }
    if (payload.error) {
      lastEmployeeCount = -1;
      alert(payload.error);
      renderRosterCanvas();
      void updateLiveDutyCard();
      return;
    }

    viewYear = payload.year;
    viewMonth = payload.month;
    lastEmployeeCount =
      typeof payload.employeeCount === "number" ? payload.employeeCount : -1;
    absencesByDate = payload.absencesByDate || {};
    isCustom = !!payload.isCustom;
    slotsOrder =
      payload.slots?.length > 0
        ? payload.slots
        : deriveSlotOrderFromRoster(payload.roster);
    swapLogList = Array.isArray(payload.swapLog) ? payload.swapLog : [];

    rosterState = JSON.parse(JSON.stringify(payload.roster || []));
    setMonthTitle(viewYear, viewMonth);
    updateMonthNavLabel();
    renderRosterCanvas();
    updateCustomBanner();
    renderSwapLogPanel();
    void updateLiveDutyCard();
  } catch (err) {
    lastEmployeeCount = -1;
    alert(
      "Cannot reach API. Start the server (npm start in backend) and open http://localhost:3000 — do not open the HTML file directly."
    );
    renderRosterCanvas();
  }
}

function renderRosterCanvas() {
  const grid = document.getElementById("grid");
  if (!grid) return;
  grid.innerHTML = "";

  if (!rosterState.length || !slotsOrder.length) {
    grid.style.gridTemplateColumns = "1fr";
    let detail = "";
    if (lastEmployeeCount >= 0 && lastEmployeeCount < 2) {
      detail =
        `<p class="sheet-empty-text">MongoDB has <strong>${lastEmployeeCount}</strong> team member(s). The roster needs at least <strong>2</strong>.</p>` +
        `<p class="sheet-empty-text">In PowerShell: <code>cd backend</code> → <code>npm run seed</code> (adds sample names). Or add people in Atlas / Compass.</p>` +
        `<p class="sheet-empty-text">Set <code>MONGODB_URI</code> in <code>backend/.env</code> (see <code>.env.example</code>). Check DB: <a href="/api/health" target="_blank" rel="noopener">/api/health</a></p>`;
    } else if (lastEmployeeCount >= 2) {
      detail =
        `<p class="sheet-empty-text">Employees exist (${lastEmployeeCount}) but roster is empty — check server terminal for errors, or click <strong>Reset month</strong>.</p>`;
    } else {
      detail =
        `<p class="sheet-empty-text">Could not load roster (API or MongoDB). Start backend with <code>npm start</code>, use <code>http://localhost:3000</code>, and verify <a href="/api/health" target="_blank" rel="noopener">/api/health</a> shows <code>mongo: true</code>.</p>`;
    }
    grid.innerHTML =
      `<div class="sheet-empty">
        <p class="sheet-empty-title">No roster data</p>
        ${detail}
      </div>`;
    return;
  }

  const days = [...new Set(rosterState.map(r => r.date))].sort();
  const map = {};
  rosterState.forEach((r, idx) => {
    map[`${r.date}_${r.slot}`] = { ...r, _idx: idx };
  });

  grid.style.gridTemplateColumns = `132px repeat(${days.length}, minmax(168px, 1fr))`;

  const corner = document.createElement("div");
  corner.className = "xh corner-cell";
  corner.innerHTML = `<span class="xh-main">IST</span><span class="xh-sub">7:30–20:30 · 2 h</span>`;
  grid.appendChild(corner);

  days.forEach((date, index) => {
    const header = document.createElement("div");
    header.className = "xh col-head";
    if (isWeekend(date)) header.classList.add("is-weekend-col");
    header.dataset.date = date;
    if (date === getTodayISO()) {
      header.classList.add("is-today-col");
      header.dataset.today = "true";
      header.dataset.colIndex = String(index);
    }
    header.innerHTML = `
      <span class="col-date">${formatDate(date)}</span>
      <span class="col-abs">${renderAbsenceChips(absencesByDate[date])}</span>`;
    grid.appendChild(header);
  });

  const activeSlotKey = getCurrentSlotKey();

  slotsOrder.forEach(slot => {
    const active = activeSlotKey === slot;
    const rowHead = document.createElement("div");
    rowHead.className = "xh row-head";
    rowHead.dataset.slot = slot;
    if (active) rowHead.classList.add("is-active-window");
    const band = prefBandLabel(slot);
    rowHead.innerHTML = `
      <span class="row-time">${formatSlotRangeIST(slot)}</span>
      <span class="row-band">${band}</span>`;
    grid.appendChild(rowHead);

    days.forEach(date => {
      const row = map[`${date}_${slot}`];
      const idx = row ? row._idx : cellIndex(date, slot);

      const cell = document.createElement("div");
      cell.className = "xh cell";
      cell.dataset.date = date;
      cell.dataset.slot = slot;
      if (row?.weekend) cell.classList.add("is-weekend-cell");
      if (date === getTodayISO()) cell.classList.add("is-today-cell");
      if (active && date === getTodayISO()) cell.classList.add("is-active-row");

      cell.addEventListener("dragover", e => {
        e.preventDefault();
        cell.classList.add("dz-over");
      });
      cell.addEventListener("dragleave", () =>
        cell.classList.remove("dz-over")
      );
      cell.addEventListener("drop", async e => {
        e.preventDefault();
        cell.classList.remove("dz-over");
        let data;
        try {
          data = JSON.parse(e.dataTransfer.getData("application/json") || "{}");
        } catch {
          return;
        }
        if (data.idx == null || !data.field) return;
        const note = swapWithSameDayRule(data.idx, data.field, idx, "primary");
        if (!note) return;
        const ok = await persistRoster(note);
        if (ok) await loadRoster();
      });

      const primary = rosterState[idx]?.primary ?? "—";
      const backup = rosterState[idx]?.backup ?? "—";

      cell.innerHTML = `
        <div class="assign">
          <span class="assign-tag p">P</span>
          <span class="chip p" draggable="true" data-field="primary" data-idx="${idx}">${escapeHtml(primary)}</span>
        </div>
        <div class="assign">
          <span class="assign-tag b">B</span>
          <span class="chip b" draggable="true" data-field="backup" data-idx="${idx}">${escapeHtml(backup)}</span>
        </div>`;

      cell.querySelectorAll(".chip").forEach(chip => {
        chip.addEventListener("dragstart", ev => {
          const i = parseInt(chip.dataset.idx, 10);
          const field = chip.dataset.field;
          ev.dataTransfer.setData(
            "application/json",
            JSON.stringify({
              idx: i,
              field,
              date: rosterState[i]?.date
            })
          );
          chip.classList.add("dragging");
        });
        chip.addEventListener("dragend", () =>
          chip.classList.remove("dragging")
        );
        chip.addEventListener("dragover", e => e.preventDefault());
        chip.addEventListener("drop", async e => {
          e.preventDefault();
          e.stopPropagation();
          let data;
          try {
            data = JSON.parse(e.dataTransfer.getData("application/json") || "{}");
          } catch {
            return;
          }
          const i = parseInt(chip.dataset.idx, 10);
          const field = chip.dataset.field;
          if (data.idx == null || !data.field) return;
          const note = swapWithSameDayRule(data.idx, data.field, i, field);
          if (!note) return;
          const ok = await persistRoster(note);
          if (ok) await loadRoster();
        });
      });

      grid.appendChild(cell);
    });
  });

  setTimeout(scrollToToday, 80);
  refreshLiveHighlights();
}

async function getTodayRosterRows() {
  const iso = getTodayISO();
  const [y, m] = iso.split("-").map(Number);
  if (viewYear === y && viewMonth === m && rosterState.length) {
    return rosterState;
  }
  try {
    const r = await fetch(`/api/roster?year=${y}&month=${m}`);
    const p = await r.json();
    if (!r.ok || p.error) return [];
    return p.roster || [];
  } catch {
    return [];
  }
}

async function updateLiveDutyCard() {
  const slotEl = document.getElementById("liveDutySlot");
  const priEl = document.getElementById("liveDutyPrimary");
  const bakEl = document.getElementById("liveDutyBackup");
  const noteEl = document.getElementById("liveDutyNote");
  const dateEl = document.getElementById("liveDutyDate");
  if (!slotEl || !priEl || !bakEl) return;

  if (dateEl) {
    dateEl.textContent = new Intl.DateTimeFormat("en-IN", {
      timeZone: IST_TZ,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(new Date());
  }

  const slotKey = getCurrentSlotKey();
  if (!slotKey) {
    slotEl.textContent = "Outside roster hours";
    priEl.textContent = "—";
    bakEl.textContent = "—";
    if (noteEl) {
      noteEl.textContent =
        "Coverage window is 7:30 AM – 8:30 PM IST (shown when current time falls in a slot).";
    }
    return;
  }

  slotEl.textContent = formatSlotRangeIST(slotKey);
  if (noteEl) noteEl.textContent = "";

  const iso = getTodayISO();
  const roster = await getTodayRosterRows();
  const row = roster.find(r => r.date === iso && r.slot === slotKey);
  if (!row) {
    priEl.textContent = "—";
    bakEl.textContent = "—";
    if (noteEl) {
      noteEl.textContent =
        "No roster row for today’s date in the schedule (check month or regenerate).";
    }
    return;
  }

  priEl.textContent = row.primary || "—";
  bakEl.textContent = row.backup || "—";
}

function refreshLiveHighlights() {
  const today = getTodayISO();
  const slotKey = getCurrentSlotKey();

  document.querySelectorAll(".xh.col-head").forEach(h => {
    const d = h.dataset.date;
    if (!d) return;
    const isToday = d === today;
    h.classList.toggle("is-today-col", isToday);
    if (isToday) h.dataset.today = "true";
    else delete h.dataset.today;
  });

  document.querySelectorAll(".xh.row-head").forEach(r => {
    r.classList.toggle("is-active-window", r.dataset.slot === slotKey);
  });

  document.querySelectorAll(".xh.cell").forEach(c => {
    const isTodayCol = c.dataset.date === today;
    const isActive =
      slotKey &&
      c.dataset.date === today &&
      c.dataset.slot === slotKey;
    c.classList.toggle("is-today-cell", isTodayCol);
    c.classList.toggle("is-active-row", !!isActive);
  });
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short"
  });
}

function isWeekend(dateStr) {
  const d = new Date(dateStr);
  return d.getDay() === 0 || d.getDay() === 6;
}

function scrollToToday() {
  const container = document.getElementById("container");
  const todayHeader = document.querySelector('[data-today="true"]');
  if (!container || !todayHeader) return;
  const containerRect = container.getBoundingClientRect();
  const headerRect = todayHeader.getBoundingClientRect();
  container.scrollTo({
    left:
      container.scrollLeft +
      (headerRect.left - containerRect.left) -
      containerRect.width / 2 +
      headerRect.width / 2,
    behavior: "smooth"
  });
}

document.addEventListener("keydown", e => {
  if (e.key.toLowerCase() === "t") scrollToToday();
});

setInterval(loadRoster, 5 * 60 * 1000);

setInterval(() => {
  void updateLiveDutyCard();
  refreshLiveHighlights();
}, 30 * 1000);

document.getElementById("btnResetRoster")?.addEventListener("click", resetToAutoRoster);
document.getElementById("btnThisMonth")?.addEventListener("click", goThisMonth);

document.querySelectorAll(".btn-month[data-delta]").forEach(btn => {
  btn.addEventListener("click", () => {
    const delta = parseInt(btn.getAttribute("data-delta"), 10);
    if (Number.isFinite(delta)) shiftViewMonth(delta);
  });
});

window.scrollToToday = scrollToToday;

loadRoster();
