"use strict";

/**
 * FitHub AI V3 - Frontend Logic
 * ---------------------------------------------------------------------------
 * Vanilla ES6. Talks to the Express/SQLite backend via /api routes.
 * Handles auth, routing (SPA views), and all interactive features.
 * ---------------------------------------------------------------------------
 */

/* ========================================================================== */
/*  TINY HELPERS                                                               */
/* ========================================================================== */

const API = "/api";
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const token = () => localStorage.getItem("token");
const escapeHtml = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Unified fetch wrapper. Always parses JSON, always throws readable errors. */
async function api(path, method = "GET", body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + (token() || "")
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({ error: "Unexpected server response" }));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/** Lightweight toast notification. */
function toast(message, type = "ok") {
  let host = $("#toastHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "toastHost";
    host.className = "toast-host";
    document.body.appendChild(host);
  }
  const t = document.createElement("div");
  t.className = "toast " + (type === "err" ? "toast-err" : "toast-ok");
  t.textContent = message;
  host.appendChild(t);
  setTimeout(() => { t.classList.add("show"); }, 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 3000);
}

/* ========================================================================== */
/*  ELEMENT REFERENCES                                                         */
/* ========================================================================== */

const authScreen = $("#auth");
const appShell = $("#app");

/* ========================================================================== */
/*  AUTH SCREEN                                                                */
/* ========================================================================== */

function authMsg(text, ok = false) {
  const m = $("#authMsg");
  if (!m) return;
  m.textContent = text || "";
  m.className = "msg " + (ok ? "ok" : "err");
}

function switchTab(which) {
  const login = which === "login";
  $("#tabLogin").classList.toggle("active", login);
  $("#tabRegister").classList.toggle("active", !login);
  $("#loginForm").classList.toggle("hidden", !login);
  $("#registerForm").classList.toggle("hidden", login);
  authMsg("");
}

function bindAuth() {
  $("#tabLogin").onclick = () => switchTab("login");
  $("#tabRegister").onclick = () => switchTab("register");

  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const d = await api("/login", "POST", {
        username: f.username.value.trim(),
        password: f.password.value
      });
      localStorage.setItem("token", d.token);
      enterApp(d.setupDone);
    } catch (err) {
      authMsg(err.message);
    }
  };

  $("#registerForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.password.value !== f.confirm.value) return authMsg("Passwords do not match");
    try {
      const d = await api("/register", "POST", {
        username: f.username.value.trim(),
        password: f.password.value,
        confirm: f.confirm.value
      });
      localStorage.setItem("token", d.token);
      enterApp(false); // first login -> open wizard
    } catch (err) {
      authMsg(err.message);
    }
  };

  const demoBtn = $("#demoBtn");
  if (demoBtn) {
    demoBtn.onclick = async () => {
      try {
        const d = await api("/demo", "POST", {});
        localStorage.setItem("token", d.token);
        enterApp(true);
        toast("Welcome to the demo account!");
      } catch (err) {
        authMsg(err.message);
      }
    };
  }
}

/* ========================================================================== */
/*  SETUP WIZARD                                                               */
/* ========================================================================== */

function bindWizard() {
  $("#skipWizard").onclick = () => {
    $("#wizard").classList.add("hidden");
    render("dashboard");
  };

  $("#wizardForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api("/profile", "PUT", {
        age: +f.age.value || null,
        gender: f.gender.value || null,
        height: +f.height.value || null,
        weight: +f.weight.value || null,
        goal: f.goal.value || null,
        activity: f.activity.value || null
      });
      $("#wizard").classList.add("hidden");
      toast("Profile saved!");
      render("dashboard");
    } catch (err) {
      toast(err.message, "err");
    }
  };
}

/* ========================================================================== */
/*  HAMBURGER MENU (mobile)                                                    */
/* ========================================================================== */

function bindHamburger() {
  const burger = $("#hamburger");
  const sidebar = $("#sidebar");
  const overlay = $("#overlay");
  if (!burger || !sidebar) return;

  const toggle = (open) => {
    const isOpen = open !== undefined ? open : !sidebar.classList.contains("open");
    sidebar.classList.toggle("open", isOpen);
    burger.classList.toggle("active", isOpen);
    if (overlay) overlay.classList.toggle("show", isOpen);
  };

  burger.onclick = () => toggle();
  if (overlay) overlay.onclick = () => toggle(false);

  // Close menu after navigating on mobile.
  $$("#nav a").forEach((a) => a.addEventListener("click", () => {
    if (window.innerWidth <= 820) toggle(false);
  }));
}

/* ========================================================================== */
/*  NAVIGATION                                                                 */
/* ========================================================================== */

function bindNav() {
  $$("#nav a[data-view]").forEach((a) => {
    a.onclick = () => {
      $$("#nav a").forEach((x) => x.classList.remove("active"));
      a.classList.add("active");
      render(a.dataset.view);
    };
  });

  const logout = $("#logoutBtn");
  if (logout) logout.onclick = () => { localStorage.removeItem("token"); location.reload(); };
}

/* ========================================================================== */
/*  APP ENTRY                                                                  */
/* ========================================================================== */

function enterApp(setupDone) {
  authScreen.classList.add("hidden");
  appShell.classList.remove("hidden");
  if (!setupDone) $("#wizard").classList.remove("hidden");
  startReminders();
  render("dashboard");
}

/* ========================================================================== */
/*  CHART RENDERING                                                            */
/* ========================================================================== */

/** Render a simple animated bar chart from an array of {date, [key]}. */
function barChart(data, key, gradient) {
  if (!data || !data.length) return `<p class="muted">No data yet.</p>`;
  const max = Math.max(1, ...data.map((d) => Number(d[key]) || 0));
  return `<div class="chart">${data.map((d) => {
    const h = ((Number(d[key]) || 0) / max) * 100;
    const style = `height:${h}%;${gradient ? "background:" + gradient : ""}`;
    return `<div class="col">
      <div class="b" style="${style}" title="${escapeHtml(d[key])}"></div>
      <span class="lbl">${escapeHtml(d.date)}</span>
    </div>`;
  }).join("")}</div>`;
}

/* ========================================================================== */
/*  VIEW ROUTER                                                                */
/* ========================================================================== */

async function render(view) {
  const v = $("#views");
  if (!v) return;
  v.innerHTML = `<p class="muted">Loading...</p>`;
  try {
    switch (view) {
      case "dashboard": return await renderDashboard(v);
      case "calculators": return await renderCalculators(v);
      case "workout": return await renderWorkout(v);
      case "exercises": return await renderExercises(v);
      case "diet": return await renderDiet(v);
      case "tracker": return await renderTracker(v);
      case "progress": return await renderProgress(v);
      case "chat": return await renderChat(v);
      case "profile": return await renderProfile(v);
      case "settings": return await renderSettings(v);
      case "about": return renderAbout(v);
      default: return await renderDashboard(v);
    }
  } catch (e) {
    if (/authenticated|session/i.test(e.message)) {
      localStorage.removeItem("token");
      return location.reload();
    }
    v.innerHTML = `<p class="msg err">${escapeHtml(e.message)}</p>`;
  }
}

/* ========================================================================== */
/*  DASHBOARD                                                                  */
/* ========================================================================== */

async function renderDashboard(v) {
  const d = await api("/dashboard");
  const quotes = [
    "Discipline is choosing what you want most over what you want now.",
    "The body achieves what the mind believes.",
    "Small steps every day lead to big results.",
    "Sweat now, shine later.",
    "Your only limit is you."
  ];
  const quote = quotes[Math.floor(Math.random() * quotes.length)];

  v.innerHTML = `
    <h1 class="view-title">Welcome back, ${escapeHtml(d.username)} 👋</h1>
    <div class="card quote-card"><p>“${escapeHtml(quote)}”</p></div>

    <div class="grid">
      <div class="card stat"><h4>Calorie Goal</h4><div class="big">${d.calorieGoal}</div><span class="muted">kcal/day</span></div>
      <div class="card stat"><h4>Consumed</h4><div class="big">${d.consumed}</div><span class="muted">kcal today</span></div>
      <div class="card stat"><h4>Burned</h4><div class="big">${d.burned}</div><span class="muted">kcal today</span></div>
      <div class="card stat"><h4>Remaining</h4><div class="big">${d.remaining}</div><span class="muted">kcal left</span></div>
      <div class="card stat"><h4>BMI</h4><div class="big">${d.bmi ?? "--"}</div><span class="muted">${escapeHtml(d.bmiCategory || "")}</span></div>
      <div class="card stat"><h4>Streak</h4><div class="big">${d.streak} 🔥</div><span class="muted">days</span></div>
    </div>

    <div class="grid two" style="margin-top:1rem">
      <div class="card">
        <h4>Goal Completion</h4>
        <div class="bar"><span style="width:${d.goalPct}%"></span></div>
        <p class="muted" style="margin-top:.4rem">${d.goalPct}% of daily calories consumed</p>
        <div class="weekly-stats">
          <div><b>${d.weeklyWorkouts}</b><span class="muted">workouts this week</span></div>
          <div><b>${d.weeklyBurned}</b><span class="muted">kcal burned (7d)</span></div>
        </div>
      </div>

      <div class="card water-card">
        <h4>Water Intake</h4>
        <div class="big"><span id="waterCount">${d.water}</span> / ${Math.round((d.waterGoal || 2.5) * 4)} glasses</div>
        <div class="row" style="margin-top:.6rem">
          <button class="btn ghost" id="waterMinus">−</button>
          <button class="btn primary" id="waterPlus">+ Glass</button>
        </div>
        <p class="muted" style="margin-top:.4rem">Goal: ${d.waterGoal} L • Protein: ${d.proteinGoal ?? "--"} g</p>
      </div>
    </div>

    <div class="card" style="margin-top:1rem">
      <h4>Weekly Calories Burned</h4>
      ${barChart(d.week, "burned")}
    </div>

    <div class="card" style="margin-top:1rem">
      <h4>Quick Actions</h4>
      <div class="row wrap" style="margin-top:.6rem">
        <button class="btn primary qa" data-go="workout">Start Workout</button>
        <button class="btn ghost qa" data-go="diet">Generate Diet</button>
        <button class="btn ghost qa" data-go="tracker">Log Food</button>
        <button class="btn ghost qa" data-go="chat">Ask AI Coach</button>
      </div>
    </div>`;

  /* Water buttons */
  const updateWater = async (delta) => {
    try {
      const r = await api("/water", "POST", { delta });
      $("#waterCount").textContent = r.glasses;
    } catch (e) { toast(e.message, "err"); }
  };
  $("#waterPlus").onclick = () => updateWater(1);
  $("#waterMinus").onclick = () => updateWater(-1);

  /* Quick actions */
  $$(".qa").forEach((b) => b.onclick = () => {
    const go = b.dataset.go;
    const link = $(`#nav a[data-view="${go}"]`);
    if (link) link.click(); else render(go);
  });
}

/* ========================================================================== */
/*  CALCULATORS (BMI / Calories / Protein / Water)                            */
/* ========================================================================== */

async function renderCalculators(v) {
  v.innerHTML = `
    <h1 class="view-title">Fitness Calculators</h1>
    <div class="card">
      <form id="calcForm" class="form">
        <div class="grid">
          <input name="age" type="number" placeholder="Age" />
          <select name="gender">
            <option value="">Gender</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
          <input name="height" type="number" placeholder="Height (cm)" />
          <input name="weight" type="number" placeholder="Weight (kg)" />
          <select name="goal">
            <option value="">Goal</option>
            <option>Muscle Gain</option><option>Fat Loss</option>
            <option>Weight Maintenance</option><option>Strength</option><option>Endurance</option>
          </select>
          <select name="activity">
            <option value="">Activity Level</option>
            <option value="sedentary">Sedentary</option>
            <option value="light">Light</option>
            <option value="moderate">Moderate</option>
            <option value="active">Active</option>
            <option value="very">Very Active</option>
          </select>
        </div>
        <button class="btn primary">Calculate</button>
      </form>
    </div>
    <div id="calcResult" class="grid" style="margin-top:1rem"></div>`;

  /* Pre-fill from profile when available. */
  try {
    const p = await api("/profile");
    const f = $("#calcForm");
    if (p.age) f.age.value = p.age;
    if (p.gender) f.gender.value = p.gender;
    if (p.height) f.height.value = p.height;
    if (p.weight) f.weight.value = p.weight;
    if (p.goal) f.goal.value = p.goal;
    if (p.activity) f.activity.value = p.activity;
  } catch (e) { /* ignore */ }

  $("#calcForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const r = await api("/calculate", "POST", {
        age: +f.age.value || null,
        gender: f.gender.value || null,
        height: +f.height.value || null,
        weight: +f.weight.value || null,
        goal: f.goal.value || null,
        activity: f.activity.value || null
      });
      $("#calcResult").innerHTML = `
        <div class="card stat"><h4>BMI</h4><div class="big">${r.bmi ?? "--"}</div><span class="muted">${escapeHtml(r.bmiCategory)}</span></div>
        <div class="card stat"><h4>Daily Calories</h4><div class="big">${r.calorieGoal}</div><span class="muted">kcal/day</span></div>
        <div class="card stat"><h4>Protein</h4><div class="big">${r.proteinGoal ?? "--"}</div><span class="muted">g/day</span></div>
        <div class="card stat"><h4>Water</h4><div class="big">${r.waterGoal}</div><span class="muted">litres/day</span></div>`;
    } catch (err) {
      toast(err.message, "err");
    }
  };
}

/* ========================================================================== */
/*  WORKOUT PLANNER (with start/pause/finish timer)                           */
/* ========================================================================== */

let workoutTimer = null;
let workoutSeconds = 0;

function stopWorkoutTimer() {
  if (workoutTimer) { clearInterval(workoutTimer); workoutTimer = null; }
}

async function renderWorkout(v) {
  stopWorkoutTimer();
  workoutSeconds = 0;

  v.innerHTML = `
    <h1 class="view-title">Workout Planner</h1>
    <div class="card">
      <div class="grid">
        <select id="wLevel"><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select>
        <select id="wGoal">
          <option>Muscle Gain</option><option>Fat Loss</option><option>Strength</option>
          <option>Endurance</option><option>Home Workout</option><option>Gym Workout</option>
        </select>
        <button class="btn primary" id="genW">Generate Plan</button>
      </div>
    </div>
    <div id="wList" style="margin-top:1rem"></div>`;

  $("#genW").onclick = async () => {
    const list = $("#wList");
    list.innerHTML = `<p class="muted">Generating plan...</p>`;
    try {
      const d = await api("/workout/generate", "POST", {
        level: $("#wLevel").value,
        goal: $("#wGoal").value
      });
      const total = d.exercises.reduce((s, x) => s + x.calories, 0);

      list.innerHTML = `
        <div class="card timer-card">
          <h4>${escapeHtml(d.goal)} • ${escapeHtml(d.level)}</h4>
          <div class="timer" id="timer">00:00</div>
          <div class="row wrap">
            <button class="btn primary" id="startW">Start</button>
            <button class="btn ghost" id="pauseW">Pause</button>
            <button class="btn primary" id="finishW">Finish (+${total} kcal)</button>
          </div>
          <p class="muted" style="margin-top:.4rem">Estimated total burn: <b>${total} kcal</b></p>
        </div>
        ${d.exercises.map((x) => `
          <div class="list-item ex">
            <div>
              <b>${escapeHtml(x.name)}</b> <span class="tag">${escapeHtml(x.muscle)}</span>
              <span class="tag">${escapeHtml(x.difficulty)}</span><br>
              <span class="muted">${x.sets} sets × ${escapeHtml(x.reps)} • rest ${escapeHtml(x.rest)}</span><br>
              <span class="muted">${escapeHtml(x.instructions)}</span>
            </div>
            <div class="cal"><b>${x.calories}</b><br><span class="muted">kcal</span></div>
          </div>`).join("")}`;

      const timerEl = $("#timer");
      const tick = () => {
        workoutSeconds++;
        const mm = String(Math.floor(workoutSeconds / 60)).padStart(2, "0");
        const ss = String(workoutSeconds % 60).padStart(2, "0");
        timerEl.textContent = `${mm}:${ss}`;
      };

      $("#startW").onclick = () => {
        if (workoutTimer) return;
        workoutTimer = setInterval(tick, 1000);
        toast("Workout started!");
      };
      $("#pauseW").onclick = () => { stopWorkoutTimer(); toast("Paused"); };
      $("#finishW").onclick = async () => {
        stopWorkoutTimer();
        const minutes = Math.max(1, Math.round(workoutSeconds / 60)) || d.exercises.length * 8;
        try {
          await api("/workout/finish", "POST", {
            duration: minutes,
            calories: total,
            exercises: d.exercises.length
          });
          toast(`Workout saved! ${minutes} min • ${total} kcal • ${d.exercises.length} exercises`);
          workoutSeconds = 0;
          timerEl.textContent = "00:00";
        } catch (e) {
          toast(e.message, "err");
        }
      };
    } catch (err) {
      list.innerHTML = `<p class="msg err">${escapeHtml(err.message)}</p>`;
    }
  };
}

/* ========================================================================== */
/*  EXERCISE LIBRARY (search + categories)                                    */
/* ========================================================================== */

async function renderExercises(v) {
  v.innerHTML = `
    <h1 class="view-title">Exercise Library</h1>
    <div class="card">
      <div class="row wrap">
        <input id="exSearch" placeholder="Search exercises..." />
        <select id="exCat"></select>
      </div>
    </div>
    <div id="exList" class="grid" style="margin-top:1rem"></div>`;

  const load = async () => {
    const search = $("#exSearch").value;
    const category = $("#exCat").value || "All";
    const d = await api(`/exercises?search=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}`);

    /* Populate categories once. */
    const catSel = $("#exCat");
    if (!catSel.dataset.loaded) {
      catSel.innerHTML = d.categories.map((c) => `<option>${escapeHtml(c)}</option>`).join("");
      catSel.dataset.loaded = "1";
      catSel.value = category;
    }

    const list = $("#exList");
    list.innerHTML = d.exercises.length
      ? d.exercises.map((x) => `
        <div class="card ex-card">
          <h4>${escapeHtml(x.name)}</h4>
          <div class="row wrap" style="gap:.3rem;margin:.3rem 0">
            <span class="tag">${escapeHtml(x.category)}</span>
            <span class="tag">${escapeHtml(x.equipment)}</span>
            <span class="tag">${escapeHtml(x.difficulty)}</span>
          </div>
          <p class="muted">${escapeHtml(x.instructions)}</p>
        </div>`).join("")
      : `<p class="muted">No exercises found.</p>`;
  };

  await load();
  $("#exSearch").oninput = load;
  $("#exCat").onchange = load;
}

/* ========================================================================== */
/*  DIET PLANNER                                                               */
/* ========================================================================== */

async function renderDiet(v) {
  const d = await api("/diet/generate", "POST", {});
  const m = d.meals;
  v.innerHTML = `
    <h1 class="view-title">Diet Planner</h1>
    <div class="grid">
      <div class="card stat"><h4>Daily Target</h4><div class="big">${d.calorieGoal}</div><span class="muted">kcal</span></div>
      <div class="card stat"><h4>Protein</h4><div class="big">${d.proteinGoal ?? "--"}</div><span class="muted">g</span></div>
      <div class="card stat"><h4>Water</h4><div class="big">${escapeHtml(d.water)}</div><span class="muted">per day</span></div>
    </div>
    <div class="grid" style="margin-top:1rem">
      ${Object.entries(m).map(([k, x]) => `
        <div class="card meal-card">
          <h4>${escapeHtml(k)}</h4>
          <p>${escapeHtml(x.food)}</p>
          <p class="muted">${x.calories} kcal • P ${x.protein}g • C ${x.carbs}g • F ${x.fat}g</p>
        </div>`).join("")}
    </div>
    <p class="muted" style="margin-top:1rem">Tip: log what you actually eat in the Calorie Tracker.</p>`;
}

/* ========================================================================== */
/*  CALORIE TRACKER + FOOD LOGGING (with food search)                         */
/* ========================================================================== */

async function renderTracker(v) {
  v.innerHTML = `
    <h1 class="view-title">Calorie Tracker</h1>
    <div id="trackerTotals" class="grid"></div>

    <div class="card" style="margin-top:1rem">
      <h4>Log Food</h4>
      <div class="row wrap" style="margin-top:.6rem">
        <input id="foodSearch" placeholder="Search foods (e.g. egg, rice)" />
        <select id="mealType">
          <option>Breakfast</option><option>Lunch</option><option>Dinner</option><option>Snacks</option>
        </select>
      </div>
      <div id="foodResults" class="food-results"></div>

      <p class="muted" style="margin-top:.8rem">Or add a custom food:</p>
      <div class="row wrap">
        <input id="cName" placeholder="Food name" />
        <input id="cCal" type="number" placeholder="Calories" />
        <input id="cPro" type="number" placeholder="Protein (g)" />
        <input id="cCarb" type="number" placeholder="Carbs (g)" />
        <input id="cFat" type="number" placeholder="Fat (g)" />
        <button class="btn primary" id="addCustom">Add</button>
      </div>
    </div>

    <div class="card" style="margin-top:1rem">
      <h4>Today's Meals</h4>
      <div id="mealList"></div>
    </div>`;

  const loadMeals = async () => {
    const d = await api("/meals");
    const t = d.totals;
    $("#trackerTotals").innerHTML = `
      <div class="card stat"><h4>Calories</h4><div class="big">${Math.round(t.calories)}</div></div>
      <div class="card stat"><h4>Protein</h4><div class="big">${Math.round(t.protein)}g</div></div>
      <div class="card stat"><h4>Carbs</h4><div class="big">${Math.round(t.carbs)}g</div></div>
      <div class="card stat"><h4>Fat</h4><div class="big">${Math.round(t.fat)}g</div></div>`;

    const list = $("#mealList");
    list.innerHTML = d.meals.length
      ? d.meals.map((x) => `
        <div class="list-item">
          <div><b>${escapeHtml(x.name)}</b> <span class="tag">${escapeHtml(x.type)}</span><br>
            <span class="muted">${Math.round(x.calories)} kcal • P ${Math.round(x.protein)}g</span></div>
          <button class="del" data-id="${x.id}" title="Delete">✕</button>
        </div>`).join("")
      : `<p class="muted">No meals logged today.</p>`;
    list.querySelectorAll(".del").forEach((b) => b.onclick = async () => {
      try { await api("/meals/" + b.dataset.id, "DELETE"); loadMeals(); }
      catch (e) { toast(e.message, "err"); }
    });
  };

  const addMeal = async (meal) => {
    try {
      await api("/meals", "POST", meal);
      toast("Meal added!");
      loadMeals();
    } catch (e) { toast(e.message, "err"); }
  };

  /* Food search from common foods DB. */
  const doSearch = async () => {
    const q = $("#foodSearch").value;
    const results = $("#foodResults");
    if (!q.trim()) { results.innerHTML = ""; return; }
    try {
      const foods = await api(`/foods?search=${encodeURIComponent(q)}`);
      results.innerHTML = foods.length
        ? foods.map((f, i) => `
          <button class="food-pill" data-i="${i}">
            ${escapeHtml(f.name)} <span class="muted">${f.calories} kcal</span>
          </button>`).join("")
        : `<p class="muted">No match. Add it as a custom food below.</p>`;
      results.querySelectorAll(".food-pill").forEach((btn) => btn.onclick = () => {
        const f = foods[+btn.dataset.i];
        addMeal({
          type: $("#mealType").value,
          name: f.name, calories: f.calories,
          protein: f.protein, carbs: f.carbs, fat: f.fat
        });
        $("#foodSearch").value = "";
        results.innerHTML = "";
      });
    } catch (e) { toast(e.message, "err"); }
  };

  $("#foodSearch").oninput = doSearch;

  $("#addCustom").onclick = () => {
    const name = $("#cName").value.trim();
    if (!name) return toast("Enter a food name", "err");
    addMeal({
      type: $("#mealType").value,
      name,
      calories: +$("#cCal").value || 0,
      protein: +$("#cPro").value || 0,
      carbs: +$("#cCarb").value || 0,
      fat: +$("#cFat").value || 0
    });
    $("#cName").value = ""; $("#cCal").value = "";
    $("#cPro").value = ""; $("#cCarb").value = ""; $("#cFat").value = "";
  };

  await loadMeals();
}

/* ========================================================================== */
/*  PROGRESS (charts + workout history)                                        */
/* ========================================================================== */

async function renderProgress(v) {
  const [prog, hist] = await Promise.all([api("/progress"), api("/workout/history")]);
  const wData = prog.map((p) => ({ date: (p.date || "").slice(5), weight: p.weight || 0 }));
  const bData = prog.map((p) => ({ date: (p.date || "").slice(5), bmi: p.bmi || 0 }));

  v.innerHTML = `
    <h1 class="view-title">Progress Tracker</h1>
    <div class="grid two">
      <div class="card">
        <h4>Weight History (kg)</h4>
        ${barChart(wData, "weight", "linear-gradient(180deg,var(--good),var(--primary2))")}
      </div>
      <div class="card">
        <h4>BMI History</h4>
        ${barChart(bData, "bmi", "linear-gradient(180deg,var(--primary2),var(--primary))")}
      </div>
    </div>

    <div class="card" style="margin-top:1rem">
      <h4>Workout History</h4>
      ${hist.length
        ? hist.map((h) => `
          <div class="list-item">
            <div><b>${escapeHtml(h.date)}</b><br>
              <span class="muted">${h.exercises} exercises • ${h.duration} min</span></div>
            <div class="cal"><b>${Math.round(h.calories)}</b><br><span class="muted">kcal</span></div>
          </div>`).join("")
        : `<p class="muted">No workouts completed yet. Finish one in the Workout Planner.</p>`}
    </div>`;
}

/* ========================================================================== */
/*  AI FITNESS CHATBOT                                                         */
/* ========================================================================== */

async function renderChat(v) {
  v.innerHTML = `
    <h1 class="view-title">AI Fitness Coach</h1>
    <div class="card chat-card">
      <div id="chatLog" class="chat-log">
        <div class="bubble bot">Hi! I'm your FitHub AI coach. Ask me about workouts, diet, protein, water, or motivation. 💪</div>
      </div>
      <form id="chatForm" class="row" style="margin-top:.8rem">
        <input id="chatInput" placeholder="Ask me anything about fitness..." autocomplete="off" />
        <button class="btn primary">Send</button>
      </form>
    </div>`;

  const log = $("#chatLog");
  const addBubble = (text, who) => {
    const b = document.createElement("div");
    b.className = "bubble " + who;
    b.textContent = text;
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  };

  $("#chatForm").onsubmit = async (e) => {
    e.preventDefault();
    const input = $("#chatInput");
    const msg = input.value.trim();
    if (!msg) return;
    addBubble(msg, "user");
    input.value = "";
    const typing = addBubble("…", "bot");
    try {
      const r = await api("/chat", "POST", { message: msg });
      typing.textContent = r.reply;
    } catch (err) {
      typing.textContent = "Sorry, I couldn't respond right now. Please try again.";
    }
  };
}

/* ========================================================================== */
/*  PROFILE                                                                    */
/* ========================================================================== */

async function renderProfile(v) {
  const p = await api("/profile");
  v.innerHTML = `
    <h1 class="view-title">My Profile</h1>
    <div class="card">
      <form id="pForm" class="form">
        <div class="profile-photo">
          <img id="photoPreview" src="${p.photo || ""}" alt="" class="${p.photo ? "" : "hidden"}" />
          <div class="photo-actions">
            <label class="btn ghost">Upload Photo
              <input id="photoInput" type="file" accept="image/*" hidden />
            </label>
          </div>
        </div>
        <input value="${escapeHtml(p.username)}" disabled />
        <div class="grid">
          <input name="age" type="number" placeholder="Age" value="${p.age ?? ""}" />
          <select name="gender">
            <option value="">Gender</option>
            <option value="male" ${p.gender === "male" ? "selected" : ""}>Male</option>
            <option value="female" ${p.gender === "female" ? "selected" : ""}>Female</option>
          </select>
          <input name="height" type="number" placeholder="Height (cm)" value="${p.height ?? ""}" />
          <input name="weight" type="number" placeholder="Weight (kg)" value="${p.weight ?? ""}" />
          <select name="goal">
            <option value="">Goal</option>
            ${["Muscle Gain", "Fat Loss", "Weight Maintenance", "Strength", "Endurance"]
              .map((g) => `<option ${p.goal === g ? "selected" : ""}>${g}</option>`).join("")}
          </select>
          <select name="activity">
            <option value="">Activity Level</option>
            ${[["sedentary", "Sedentary"], ["light", "Light"], ["moderate", "Moderate"], ["active", "Active"], ["very", "Very Active"]]
              .map(([val, t]) => `<option value="${val}" ${p.activity === val ? "selected" : ""}>${t}</option>`).join("")}
          </select>
        </div>
        <button class="btn primary">Save Profile</button>
      </form>
    </div>`;

  let photoData = p.photo || null;
  const input = $("#photoInput");
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      photoData = reader.result;
      const img = $("#photoPreview");
      img.src = photoData;
      img.classList.remove("hidden");
    };
    reader.readAsDataURL(file);
  };

  $("#pForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api("/profile", "PUT", {
        age: +f.age.value || null,
        gender: f.gender.value || null,
        height: +f.height.value || null,
        weight: +f.weight.value || null,
        goal: f.goal.value || null,
        activity: f.activity.value || null,
        photo: photoData
      });
      toast("Profile saved!");
    } catch (err) {
      toast(err.message, "err");
    }
  };
}

/* ========================================================================== */
/*  SETTINGS                                                                   */
/* ========================================================================== */

async function renderSettings(v) {
  const s = await api("/settings");
  v.innerHTML = `
    <h1 class="view-title">Settings</h1>

    <div class="card">
      <h4>Theme</h4>
      <div class="row" style="margin-top:.6rem">
        <button class="btn ${s.theme === "dark" ? "primary" : "ghost"}" id="themeDark">🌙 Dark</button>
        <button class="btn ${s.theme === "light" ? "primary" : "ghost"}" id="themeLight">☀ Light</button>
      </div>
    </div>

    <div class="card" style="margin-top:1rem">
      <h4>Reminders</h4>
      <label class="switch-row">
        <span>Water reminders</span>
        <input type="checkbox" id="waterRem" ${s.water_reminder ? "checked" : ""} />
      </label>
      <label class="switch-row">
        <span>Workout reminders</span>
        <input type="checkbox" id="workoutRem" ${s.workout_reminder ? "checked" : ""} />
      </label>
      <button class="btn ghost" id="enableNotif" style="margin-top:.6rem">Enable Browser Notifications</button>
    </div>

    <div class="card" style="margin-top:1rem">
      <h4>Change Password</h4>
      <form id="pwForm" class="form" style="margin-top:.6rem">
        <input name="current" type="password" placeholder="Current password" required />
        <input name="next" type="password" placeholder="New password" required />
        <button class="btn primary">Update Password</button>
      </form>
    </div>

    <div class="card danger" style="margin-top:1rem">
      <h4>Danger Zone</h4>
      <button class="btn ghost danger-btn" id="delAcc" style="margin-top:.6rem">Delete Account</button>
    </div>`;

  const setTheme = async (theme) => {
    applyTheme(theme);
    try { await api("/settings", "PUT", { theme }); } catch (e) { /* ignore */ }
    renderSettings(v);
  };
  $("#themeDark").onclick = () => setTheme("dark");
  $("#themeLight").onclick = () => setTheme("light");

  const saveReminder = async () => {
    try {
      await api("/settings", "PUT", {
        water_reminder: $("#waterRem").checked ? 1 : 0,
        workout_reminder: $("#workoutRem").checked ? 1 : 0
      });
      toast("Reminders updated");
      startReminders();
    } catch (e) { toast(e.message, "err"); }
  };
  $("#waterRem").onchange = saveReminder;
  $("#workoutRem").onchange = saveReminder;

  $("#enableNotif").onclick = async () => {
    if (!("Notification" in window)) return toast("Notifications not supported", "err");
    const perm = await Notification.requestPermission();
    toast(perm === "granted" ? "Notifications enabled!" : "Notifications blocked", perm === "granted" ? "ok" : "err");
  };

  $("#pwForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api("/password", "PUT", { current: f.current.value, next: f.next.value });
      toast("Password updated!");
      f.reset();
    } catch (err) {
      toast(err.message, "err");
    }
  };

  $("#delAcc").onclick = async () => {
    if (!confirm("Delete your account permanently? This cannot be undone.")) return;
    try {
      await api("/account", "DELETE");
      localStorage.clear();
      location.reload();
    } catch (e) {
      toast(e.message, "err");
    }
  };
}

/* ========================================================================== */
/*  ABOUT                                                                      */
/* ========================================================================== */

function renderAbout(v) {
  v.innerHTML = `
    <h1 class="view-title">FitHub AI</h1>
    <div class="card">
      <p>FitHub AI is an intelligent fitness and wellness platform created by
      <b>Mohit Chaudhary</b>. It helps users achieve their goals with AI-generated
      workout plans, personalized diet plans, progress tracking, reminders,
      hydration tracking, BMI calculator, and modern analytics.</p>
    </div>
    <div class="grid" style="margin-top:1rem">
      <div class="card"><h4>💪 Smart Workouts</h4><p class="muted">Plans for every level and goal.</p></div>
      <div class="card"><h4>🥗 Diet Planner</h4><p class="muted">Calorie-matched meal guidance.</p></div>
      <div class="card"><h4>📈 Progress</h4><p class="muted">Track weight, BMI & workouts.</p></div>
      <div class="card"><h4>🤖 AI Coach</h4><p class="muted">Instant fitness answers.</p></div>
    </div>`;
}

/* ========================================================================== */
/*  THEME                                                                      */
/* ========================================================================== */

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme || "dark");
  localStorage.setItem("theme", theme || "dark");
}

/* ========================================================================== */
/*  REMINDERS (browser notifications)                                          */
/* ========================================================================== */

let reminderTimers = [];

async function startReminders() {
  /* Clear any existing timers first. */
  reminderTimers.forEach((t) => clearInterval(t));
  reminderTimers = [];

  let settings;
  try { settings = await api("/settings"); } catch (e) { return; }
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  if (settings.water_reminder) {
    reminderTimers.push(setInterval(() => {
      new Notification("FitHub AI 💧", { body: "Time to drink a glass of water!" });
    }, 60 * 60 * 1000)); // hourly
  }
  if (settings.workout_reminder) {
    reminderTimers.push(setInterval(() => {
      new Notification("FitHub AI 💪", { body: "Don't forget your workout today!" });
    }, 4 * 60 * 60 * 1000)); // every 4 hours
  }
}

/* ========================================================================== */
/*  INIT                                                                       */
/* ========================================================================== */

(function init() {
  /* Apply saved theme immediately to avoid flash. */
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);

  bindAuth();
  bindWizard();
  bindNav();
  bindHamburger();

  /* Auto-login if a valid token exists. */
  if (token()) {
    api("/dashboard")
      .then((d) => enterApp(d.setupDone))
      .catch(() => localStorage.removeItem("token"));
  }
})();
