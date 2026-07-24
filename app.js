/**
 * Dayflare — Joelle's daily pulse
 * Zero-build planner with localStorage persistence + reminder engine
 */

(() => {
  "use strict";

  const STORAGE_KEY = "dayflare-v1";
  const POLL_MS = 20000;
  const SNOOZE_MS = 5 * 60 * 1000;

  const SECTIONS = [
    { id: "morning", label: "Morning", window: "6:00 – 12:00", badge: "morning" },
    { id: "afternoon", label: "Afternoon", window: "12:00 – 17:00", badge: "afternoon" },
    { id: "evening", label: "Evening", window: "17:00 – late", badge: "evening" },
  ];

  const KIND_LABELS = {
    water: "Water",
    food: "Food",
    focus: "Focus",
    move: "Move",
    care: "Care",
  };

  // —— Utils ——
  const uid = () =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const formatDateLabel = () =>
    new Date().toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

  const escapeHtml = (str) =>
    String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const timeToMinutes = (hhmm) => {
    if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };

  const nowMinutes = () => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  };

  // —— Seed data ——
  function createSeed() {
    return {
      date: todayKey(),
      notes: "Soft start. Protect focus blocks. Celebrate the little wins.",
      streak: 1,
      tokens: 0,
      lastCompleteDate: null,
      sections: {
        morning: {
          tasks: [
            { id: uid(), text: "Sunlight + stretch for 5 min", done: false },
            { id: uid(), text: "Review Dayflare priorities", done: false },
            { id: uid(), text: "Protein breakfast", done: true },
          ],
          reminder: { time: "08:30", message: "Morning block — kick off your top three", firedKey: null },
        },
        afternoon: {
          tasks: [
            { id: uid(), text: "Deep work sprint (45 min)", done: false },
            { id: uid(), text: "Walk outside after lunch", done: false },
            { id: uid(), text: "Inbox zero-ish", done: false },
          ],
          reminder: { time: "13:00", message: "Afternoon check-in — how’s energy?", firedKey: null },
        },
        evening: {
          tasks: [
            { id: uid(), text: "Prep tomorrow’s clothes / bag", done: false },
            { id: uid(), text: "Screens down before bed", done: false },
            { id: uid(), text: "One gratitude note", done: false },
          ],
          reminder: { time: "20:00", message: "Evening wind-down starts now", firedKey: null },
        },
      },
      workout: [
        { id: uid(), name: "Goblet squat", sets: "3", reps: "10", notes: "Slow eccentric", done: false },
        { id: uid(), name: "Push-ups", sets: "3", reps: "8–12", notes: "Knees OK", done: false },
        { id: uid(), name: "Dead bug", sets: "3", reps: "8/side", notes: "Core control", done: false },
        { id: uid(), name: "Walk / incline", sets: "1", reps: "20 min", notes: "Easy pace", done: false },
      ],
      wellness: [
        { id: uid(), label: "Glass of water", time: "09:00", kind: "water", done: false, firedKey: null },
        { id: uid(), label: "Refill bottle", time: "11:30", kind: "water", done: false, firedKey: null },
        { id: uid(), label: "Colorful lunch plate", time: "12:30", kind: "food", done: false, firedKey: null },
        { id: uid(), label: "Afternoon snack + protein", time: "15:30", kind: "food", done: false, firedKey: null },
        { id: uid(), label: "Stand & move 2 min", time: "14:00", kind: "move", done: false, firedKey: null },
        { id: uid(), label: "Eyes off screen — blink reset", time: "16:00", kind: "care", done: false, firedKey: null },
        { id: uid(), label: "Hydrate before dinner", time: "18:00", kind: "water", done: false, firedKey: null },
      ],
      snoozed: {},
    };
  }

  // —— State ——
  let state = loadState();
  let notifyEnabled = localStorage.getItem("dayflare-notify") === "1";

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createSeed();
      const parsed = JSON.parse(raw);
      if (parsed.date !== todayKey()) {
        return rolloverDay(parsed);
      }
      return parsed;
    } catch {
      return createSeed();
    }
  }

  function rolloverDay(prev) {
    const next = createSeed();
    const allDone = computeProgress(prev).pct === 100;
    if (allDone && prev.lastCompleteDate === prev.date) {
      next.streak = (prev.streak || 0) + 1;
    } else if (prev.lastCompleteDate === prev.date) {
      next.streak = prev.streak || 1;
    } else {
      // Keep streak if yesterday completed; otherwise soft reset to 1 on new seed day
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
      next.streak = prev.lastCompleteDate === yKey ? (prev.streak || 1) : 1;
    }
    next.tokens = Math.max(0, Math.floor((prev.tokens || 0) * 0.5));
    return next;
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function computeProgress(s = state) {
    let done = 0;
    let total = 0;
    for (const sec of SECTIONS) {
      const tasks = s.sections[sec.id].tasks;
      total += tasks.length;
      done += tasks.filter((t) => t.done).length;
    }
    total += s.workout.length;
    done += s.workout.filter((w) => w.done).length;
    total += s.wellness.length;
    done += s.wellness.filter((w) => w.done).length;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    return { done, total, pct };
  }

  // —— DOM refs ——
  const $ = (sel) => document.querySelector(sel);
  const daySectionsEl = $("#day-sections");
  const workoutListEl = $("#workout-list");
  const wellnessBoardEl = $("#wellness-board");
  const toastRoot = $("#toast-root");
  const confettiRoot = $("#confetti-root");
  const progressRing = $("#progress-ring");
  const CIRC = 2 * Math.PI * 52;

  // —— Render ——
  function renderAll() {
    $("#today-label").textContent = formatDateLabel();
    renderProgress();
    renderSections();
    renderWorkout();
    renderWellness();
    $("#day-notes").value = state.notes || "";
    $("#btn-notify").setAttribute("aria-pressed", notifyEnabled ? "true" : "false");
    $("#btn-notify").textContent = notifyEnabled ? "Alerts on" : "Enable alerts";
  }

  function renderProgress() {
    const { done, total, pct } = computeProgress();
    $("#progress-pct").textContent = `${pct}%`;
    $("#done-count").textContent = String(done);
    $("#total-count").textContent = String(total);
    $("#streak-display").textContent = `${state.streak || 0} day streak`;
    $("#token-display").textContent = `${state.tokens || 0} tokens`;
    progressRing.style.strokeDasharray = String(CIRC);
    progressRing.style.strokeDashoffset = String(CIRC * (1 - pct / 100));
    progressRing.style.stroke = pct === 100 ? "var(--coral)" : "var(--teal)";
  }

  function renderSections() {
    daySectionsEl.innerHTML = SECTIONS.map((sec) => {
      const data = state.sections[sec.id];
      const doneCount = data.tasks.filter((t) => t.done).length;
      const rem = data.reminder || { time: "", message: "" };
      return `
        <article class="day-block" data-section="${sec.id}">
          <div class="day-block__header">
            <div>
              <h3 class="day-block__title">${escapeHtml(sec.label)}</h3>
              <p class="day-block__sub">${escapeHtml(sec.window)} · ${doneCount}/${data.tasks.length} done</p>
            </div>
            <span class="badge badge--${sec.badge}">${escapeHtml(sec.label)}</span>
          </div>
          <ul class="task-list" data-list="section" data-section="${sec.id}" role="list">
            ${data.tasks.map((t) => taskItemHtml(t, { kind: "section", sectionId: sec.id })).join("")}
          </ul>
          <form class="inline-form add-task-form" data-section="${sec.id}">
            <label class="sr-only" for="add-${sec.id}">New ${sec.label} plan</label>
            <input id="add-${sec.id}" name="text" type="text" placeholder="Add a plan…" required />
            <button type="submit" class="btn btn--primary btn--sm">Add</button>
          </form>
          <div class="reminder-box">
            <h4>Block reminder</h4>
            <form class="reminder-form" data-section="${sec.id}">
              <label class="sr-only" for="rem-time-${sec.id}">Reminder time</label>
              <input id="rem-time-${sec.id}" name="time" type="time" value="${escapeHtml(rem.time || "")}" required />
              <label class="sr-only" for="rem-msg-${sec.id}">Reminder message</label>
              <input id="rem-msg-${sec.id}" name="message" type="text" placeholder="Reminder message" value="${escapeHtml(rem.message || "")}" required />
              <button type="submit" class="btn btn--sm btn--secondary">Save</button>
            </form>
            <p class="reminder-status">${rem.time ? `Set for ${escapeHtml(rem.time)}` : "No reminder yet"}</p>
          </div>
        </article>
      `;
    }).join("");
    bindListDnD(daySectionsEl);
  }

  function taskItemHtml(task, ctx) {
    const meta =
      ctx.kind === "workout"
        ? `<span class="task-item__meta">${escapeHtml(task.sets || "—")} sets · ${escapeHtml(task.reps || "—")} · ${escapeHtml(task.notes || "")}</span>`
        : "";
    const label = ctx.kind === "workout" ? task.name : task.text;
    return `
      <li class="task-item ${task.done ? "is-done" : ""}" draggable="true" data-id="${task.id}" data-kind="${ctx.kind}" data-section="${ctx.sectionId || ""}">
        <span class="drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
        <div class="task-item__body">
          <label>
            <input class="task-check" type="checkbox" ${task.done ? "checked" : ""} data-action="toggle" aria-label="Mark complete: ${escapeHtml(label)}" />
            <span class="task-item__text">${escapeHtml(label)}</span>
          </label>
          ${meta}
        </div>
        <div class="task-item__actions">
          <button type="button" class="btn btn--icon" data-action="edit" aria-label="Edit">${pencilSvg()}</button>
          <button type="button" class="btn btn--icon btn--danger" data-action="delete" aria-label="Delete">${trashSvg()}</button>
        </div>
      </li>
    `;
  }

  function pencilSvg() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
  }

  function trashSvg() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>`;
  }

  function renderWorkout() {
    workoutListEl.innerHTML = state.workout
      .map((w) => taskItemHtml(w, { kind: "workout" }))
      .join("");
    bindListDnD(workoutListEl);
  }

  function renderWellness() {
    wellnessBoardEl.innerHTML = state.wellness
      .map(
        (w) => `
      <div class="token-card ${w.done ? "is-done" : ""}" role="button" tabindex="0" data-id="${w.id}" data-action="toggle-wellness" aria-pressed="${w.done}">
        <span class="badge badge--${escapeHtml(w.kind)}">${escapeHtml(KIND_LABELS[w.kind] || w.kind)}</span>
        <span class="token-card__time">${escapeHtml(w.time)}</span>
        <span class="token-card__label">${escapeHtml(w.label)}</span>
        <div class="token-card__actions">
          <button type="button" class="btn btn--icon" data-action="edit-wellness" aria-label="Edit ${escapeHtml(w.label)}">${pencilSvg()}</button>
          <button type="button" class="btn btn--icon btn--danger" data-action="delete-wellness" aria-label="Delete ${escapeHtml(w.label)}">${trashSvg()}</button>
        </div>
      </div>`
      )
      .join("");
  }

  // —— Mutations ——
  function awardToken(n = 1) {
    state.tokens = (state.tokens || 0) + n;
  }

  function checkSectionComplete(sectionId) {
    const tasks = state.sections[sectionId].tasks;
    if (tasks.length && tasks.every((t) => t.done)) {
      celebrate(`${SECTIONS.find((s) => s.id === sectionId).label} complete!`);
      awardToken(3);
    }
  }

  function checkDayComplete() {
    const { pct } = computeProgress();
    if (pct === 100 && state.lastCompleteDate !== state.date) {
      state.lastCompleteDate = state.date;
      state.streak = (state.streak || 0) + 1;
      awardToken(10);
      celebrate("Full dayflare! Everything checked.");
    }
  }

  function toggleTask(kind, id, sectionId) {
    let item;
    if (kind === "section") {
      item = state.sections[sectionId].tasks.find((t) => t.id === id);
    } else {
      item = state.workout.find((t) => t.id === id);
    }
    if (!item) return;
    item.done = !item.done;
    if (item.done) {
      awardToken(1);
      if (kind === "section") checkSectionComplete(sectionId);
      if (kind === "workout" && state.workout.length && state.workout.every((w) => w.done)) {
        celebrate("Workout flare complete!");
        awardToken(5);
      }
    }
    checkDayComplete();
    save();
    renderAll();
  }

  function deleteTask(kind, id, sectionId) {
    if (kind === "section") {
      state.sections[sectionId].tasks = state.sections[sectionId].tasks.filter((t) => t.id !== id);
    } else {
      state.workout = state.workout.filter((t) => t.id !== id);
    }
    save();
    renderAll();
  }

  function startEdit(li) {
    if (li.classList.contains("is-editing")) return;
    const kind = li.dataset.kind;
    const id = li.dataset.id;
    const sectionId = li.dataset.section;
    let item;
    if (kind === "section") {
      item = state.sections[sectionId].tasks.find((t) => t.id === id);
    } else {
      item = state.workout.find((t) => t.id === id);
    }
    if (!item) return;

    li.classList.add("is-editing");
    const body = li.querySelector(".task-item__body");
    const fields =
      kind === "workout"
        ? `
        <input class="edit-field" data-field="name" value="${escapeHtml(item.name)}" aria-label="Exercise name" />
        <input class="edit-field" data-field="sets" value="${escapeHtml(item.sets || "")}" aria-label="Sets" />
        <input class="edit-field" data-field="reps" value="${escapeHtml(item.reps || "")}" aria-label="Reps" />
        <input class="edit-field" data-field="notes" value="${escapeHtml(item.notes || "")}" aria-label="Notes" />
        <button type="button" class="btn btn--primary btn--sm" data-action="save-edit">Save</button>
      `
        : `
        <input class="edit-field" data-field="text" value="${escapeHtml(item.text)}" aria-label="Plan text" />
        <button type="button" class="btn btn--primary btn--sm" data-action="save-edit">Save</button>
      `;
    body.insertAdjacentHTML("beforeend", `<div class="edit-wrap">${fields}</div>`);
    body.querySelector(".edit-field").focus();
  }

  function saveEdit(li) {
    const kind = li.dataset.kind;
    const id = li.dataset.id;
    const sectionId = li.dataset.section;
    let item;
    if (kind === "section") {
      item = state.sections[sectionId].tasks.find((t) => t.id === id);
      const text = li.querySelector('[data-field="text"]').value.trim();
      if (!text) return;
      item.text = text;
    } else {
      item = state.workout.find((t) => t.id === id);
      const name = li.querySelector('[data-field="name"]').value.trim();
      if (!name) return;
      item.name = name;
      item.sets = li.querySelector('[data-field="sets"]').value.trim();
      item.reps = li.querySelector('[data-field="reps"]').value.trim();
      item.notes = li.querySelector('[data-field="notes"]').value.trim();
    }
    save();
    renderAll();
  }

  // —— Drag & drop reorder ——
  let dragId = null;
  let dragKind = null;
  let dragSection = null;

  function bindListDnD(root) {
    root.querySelectorAll(".task-item").forEach((el) => {
      el.addEventListener("dragstart", (e) => {
        dragId = el.dataset.id;
        dragKind = el.dataset.kind;
        dragSection = el.dataset.section;
        el.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", dragId);
      });
      el.addEventListener("dragend", () => {
        el.classList.remove("is-dragging");
        root.querySelectorAll(".is-drag-over").forEach((n) => n.classList.remove("is-drag-over"));
        dragId = null;
      });
      el.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (el.dataset.kind !== dragKind) return;
        if (dragKind === "section" && el.dataset.section !== dragSection) return;
        el.classList.add("is-drag-over");
      });
      el.addEventListener("dragleave", () => el.classList.remove("is-drag-over"));
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        el.classList.remove("is-drag-over");
        const targetId = el.dataset.id;
        if (!dragId || dragId === targetId) return;
        if (el.dataset.kind !== dragKind) return;
        reorder(dragKind, dragSection, dragId, targetId);
      });
    });
  }

  function reorder(kind, sectionId, fromId, toId) {
    const list =
      kind === "section" ? state.sections[sectionId].tasks : state.workout;
    const fromIdx = list.findIndex((t) => t.id === fromId);
    const toIdx = list.findIndex((t) => t.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    save();
    renderAll();
  }

  // —— Confetti & toasts ——
  function celebrate(message) {
    showToast({ title: "Nice!", message, kind: "care", autoDismiss: 4500 });
    spawnConfetti();
  }

  function spawnConfetti() {
    const colors = ["#ff5a4e", "#00c2b2", "#ffd23f", "#b8f248", "#4db7ff", "#ff8a3d"];
    for (let i = 0; i < 36; i++) {
      const piece = document.createElement("span");
      piece.className = "confetti-piece";
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[i % colors.length];
      piece.style.animationDuration = `${1.4 + Math.random() * 1.4}s`;
      piece.style.animationDelay = `${Math.random() * 0.3}s`;
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      confettiRoot.appendChild(piece);
      setTimeout(() => piece.remove(), 3200);
    }
  }

  function showToast({ title, message, kind = "care", onSnooze, autoDismiss = 0 }) {
    const el = document.createElement("div");
    el.className = `toast toast--${kind}`;
    el.setAttribute("role", "status");
    el.innerHTML = `
      <p class="toast__title">${escapeHtml(title)}</p>
      <p class="toast__msg">${escapeHtml(message)}</p>
      <div class="toast__actions">
        <button type="button" class="btn btn--primary" data-toast="dismiss">Dismiss</button>
        ${onSnooze ? `<button type="button" class="btn btn--ghost" data-toast="snooze">Snooze 5 min</button>` : ""}
      </div>
    `;
    const dismiss = () => {
      el.classList.add("is-leaving");
      setTimeout(() => el.remove(), 280);
    };
    el.querySelector('[data-toast="dismiss"]').addEventListener("click", dismiss);
    const snoozeBtn = el.querySelector('[data-toast="snooze"]');
    if (snoozeBtn && onSnooze) {
      snoozeBtn.addEventListener("click", () => {
        onSnooze();
        dismiss();
      });
    }
    toastRoot.appendChild(el);
    if (autoDismiss) setTimeout(dismiss, autoDismiss);
    return { dismiss, el };
  }

  function browserNotify(title, body) {
    if (!notifyEnabled || typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    try {
      new Notification(title, { body, silent: false });
    } catch {
      /* ignore */
    }
  }

  // —— Reminder engine ——
  function fireKeyFor(id, time) {
    return `${todayKey()}|${id}|${time}`;
  }

  function isSnoozed(id) {
    const until = state.snoozed?.[id];
    return until && Date.now() < until;
  }

  /** Silently mark already-past reminders so a mid-day open doesn't flood toasts. */
  function catchUpPastReminders() {
    const mins = nowMinutes();
    let changed = false;
    for (const sec of SECTIONS) {
      const rem = state.sections[sec.id].reminder;
      if (!rem?.time) continue;
      const tMin = timeToMinutes(rem.time);
      if (tMin === null || mins < tMin) continue;
      const key = fireKeyFor(`section-${sec.id}`, rem.time);
      if (rem.firedKey !== key) {
        rem.firedKey = key;
        changed = true;
      }
    }
    for (const w of state.wellness) {
      if (!w.time) continue;
      const tMin = timeToMinutes(w.time);
      if (tMin === null || mins < tMin) continue;
      const key = fireKeyFor(`wellness-${w.id}`, w.time);
      if (w.firedKey !== key) {
        w.firedKey = key;
        changed = true;
      }
    }
    if (changed) save();
  }

  function checkReminders() {
    const mins = nowMinutes();

    // Clear stale snoozes first
    if (state.snoozed) {
      for (const [k, until] of Object.entries(state.snoozed)) {
        if (Date.now() >= until) delete state.snoozed[k];
      }
    }

    // Section reminders — due window, or re-fire after snooze
    for (const sec of SECTIONS) {
      const rem = state.sections[sec.id].reminder;
      if (!rem?.time || !rem.message) continue;
      const tMin = timeToMinutes(rem.time);
      if (tMin === null) continue;
      const key = fireKeyFor(`section-${sec.id}`, rem.time);
      if (rem.firedKey === key) continue;
      if (isSnoozed(`section-${sec.id}`)) continue;
      const dueNow = mins >= tMin && mins <= tMin + 1;
      const afterSnooze = rem.firedKey === null && mins >= tMin;
      if (dueNow || afterSnooze) {
        rem.firedKey = key;
        save();
        const title = `${sec.label} reminder`;
        showToast({
          title,
          message: rem.message,
          kind: sec.id,
          onSnooze: () => {
            state.snoozed[`section-${sec.id}`] = Date.now() + SNOOZE_MS;
            rem.firedKey = null;
            save();
          },
        });
        browserNotify(title, rem.message);
      }
    }

    // Wellness reminders
    for (const w of state.wellness) {
      if (!w.time) continue;
      const tMin = timeToMinutes(w.time);
      if (tMin === null) continue;
      const key = fireKeyFor(`wellness-${w.id}`, w.time);
      if (w.firedKey === key) continue;
      if (isSnoozed(`wellness-${w.id}`)) continue;
      const dueNow = mins >= tMin && mins <= tMin + 1;
      const afterSnooze = w.firedKey === null && mins >= tMin;
      if (dueNow || afterSnooze) {
        // Avoid flooding: afterSnooze only if we previously had a snooze entry cleared
        // Catch-up already set firedKey for past items, so afterSnooze only hits snoozed ones.
        w.firedKey = key;
        save();
        const title = `${KIND_LABELS[w.kind] || "Wellness"} nudge`;
        showToast({
          title,
          message: w.label,
          kind: w.kind,
          onSnooze: () => {
            state.snoozed[`wellness-${w.id}`] = Date.now() + SNOOZE_MS;
            w.firedKey = null;
            save();
          },
        });
        browserNotify(title, w.label);
      }
    }
  }

  // —— Event wiring ——
  function onDelegatedClick(e) {
    const actionEl = e.target.closest("[data-action]");
    if (!actionEl) return;

    const action = actionEl.dataset.action;

    // Wellness board
    if (action === "toggle-wellness") {
      const card = actionEl.closest(".token-card") || actionEl;
      // ignore if clicking nested action buttons (handled below)
      if (e.target.closest("[data-action='edit-wellness'], [data-action='delete-wellness']")) return;
      const id = card.dataset.id;
      const item = state.wellness.find((w) => w.id === id);
      if (!item) return;
      item.done = !item.done;
      if (item.done) awardToken(1);
      checkDayComplete();
      save();
      renderAll();
      return;
    }

    if (action === "edit-wellness") {
      e.stopPropagation();
      const id = actionEl.closest(".token-card").dataset.id;
      const item = state.wellness.find((w) => w.id === id);
      if (!item) return;
      const label = prompt("Nudge label", item.label);
      if (label === null) return;
      const time = prompt("Time (HH:MM)", item.time);
      if (time === null) return;
      if (!/^\d{1,2}:\d{2}$/.test(time)) {
        showToast({ title: "Hmm", message: "Use a time like 14:30", kind: "focus", autoDismiss: 3000 });
        return;
      }
      item.label = label.trim() || item.label;
      item.time = time.padStart(5, "0");
      item.firedKey = null;
      save();
      renderAll();
      return;
    }

    if (action === "delete-wellness") {
      e.stopPropagation();
      const id = actionEl.closest(".token-card").dataset.id;
      state.wellness = state.wellness.filter((w) => w.id !== id);
      save();
      renderAll();
      return;
    }

    const li = actionEl.closest(".task-item");
    if (!li) {
      if (action === "save-edit") return;
      return;
    }

    if (action === "toggle") {
      // checkbox change handled separately
      return;
    }
    if (action === "edit") {
      startEdit(li);
      return;
    }
    if (action === "delete") {
      deleteTask(li.dataset.kind, li.dataset.id, li.dataset.section);
      return;
    }
    if (action === "save-edit") {
      saveEdit(li);
    }
  }

  document.addEventListener("click", onDelegatedClick);

  document.addEventListener("change", (e) => {
    if (e.target.matches(".task-check")) {
      const li = e.target.closest(".task-item");
      if (!li) return;
      toggleTask(li.dataset.kind, li.dataset.id, li.dataset.section);
    }
  });

  document.addEventListener("keydown", (e) => {
    const card = e.target.closest(".token-card");
    if (card && (e.key === "Enter" || e.key === " ")) {
      if (e.target.closest("button")) return;
      e.preventDefault();
      card.click();
    }
    if (e.key === "Enter" && e.target.matches(".edit-field")) {
      const li = e.target.closest(".task-item");
      if (li) saveEdit(li);
    }
  });

  daySectionsEl.addEventListener("submit", (e) => {
    const form = e.target;
    if (form.classList.contains("add-task-form")) {
      e.preventDefault();
      const sectionId = form.dataset.section;
      const text = new FormData(form).get("text").toString().trim();
      if (!text) return;
      state.sections[sectionId].tasks.push({ id: uid(), text, done: false });
      form.reset();
      save();
      renderAll();
    }
    if (form.classList.contains("reminder-form")) {
      e.preventDefault();
      const sectionId = form.dataset.section;
      const fd = new FormData(form);
      const time = fd.get("time").toString();
      const message = fd.get("message").toString().trim();
      state.sections[sectionId].reminder = {
        time,
        message,
        firedKey: null,
      };
      save();
      renderAll();
      showToast({
        title: "Reminder saved",
        message: `${SECTIONS.find((s) => s.id === sectionId).label} at ${time}`,
        kind: sectionId,
        autoDismiss: 2800,
      });
    }
  });

  $("#workout-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = fd.get("name").toString().trim();
    if (!name) return;
    state.workout.push({
      id: uid(),
      name,
      sets: fd.get("sets").toString().trim(),
      reps: fd.get("reps").toString().trim(),
      notes: fd.get("notes").toString().trim(),
      done: false,
    });
    e.target.reset();
    save();
    renderAll();
  });

  $("#wellness-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const label = fd.get("label").toString().trim();
    const time = fd.get("time").toString();
    const kind = fd.get("kind").toString();
    if (!label || !time) return;
    state.wellness.push({
      id: uid(),
      label,
      time,
      kind,
      done: false,
      firedKey: null,
    });
    // sort by time
    state.wellness.sort((a, b) => (timeToMinutes(a.time) || 0) - (timeToMinutes(b.time) || 0));
    e.target.reset();
    save();
    renderAll();
  });

  let notesTimer;
  $("#day-notes").addEventListener("input", (e) => {
    state.notes = e.target.value;
    clearTimeout(notesTimer);
    notesTimer = setTimeout(save, 300);
  });

  $("#btn-reset").addEventListener("click", () => {
    if (!confirm("Reset today to the sample Dayflare plan? Your streak tokens will keep a soft carry.")) {
      return;
    }
    const prev = state;
    state = createSeed();
    state.streak = prev.streak || 1;
    state.tokens = prev.tokens || 0;
    catchUpPastReminders();
    save();
    renderAll();
    showToast({ title: "Fresh day", message: "Sample plans loaded again.", kind: "morning", autoDismiss: 3000 });
  });

  $("#btn-notify").addEventListener("click", async () => {
    if (typeof Notification === "undefined") {
      showToast({
        title: "Not available",
        message: "This browser doesn’t support notifications. In-app popups still work.",
        kind: "focus",
        autoDismiss: 4000,
      });
      return;
    }
    if (Notification.permission === "granted") {
      notifyEnabled = !notifyEnabled;
    } else if (Notification.permission === "denied") {
      showToast({
        title: "Blocked",
        message: "Notifications are blocked in browser settings. In-app popups still fire.",
        kind: "focus",
        autoDismiss: 4000,
      });
      return;
    } else {
      const perm = await Notification.requestPermission();
      notifyEnabled = perm === "granted";
    }
    localStorage.setItem("dayflare-notify", notifyEnabled ? "1" : "0");
    renderAll();
    if (notifyEnabled) {
      browserNotify("Dayflare alerts on", "You’ll get a ping when reminders hit.");
      showToast({ title: "Alerts on", message: "Browser + in-app reminders are ready.", kind: "care", autoDismiss: 3000 });
    }
  });

  // —— Boot ——
  catchUpPastReminders();
  renderAll();
  checkReminders();
  setInterval(checkReminders, POLL_MS);

  // Demo-friendly: if a reminder is within the next minute of page load for testing,
  // nothing special — poll handles it. Expose soft debug helper.
  window.Dayflare = {
    forceCheck: checkReminders,
    state: () => state,
    celebrate,
  };
})();
