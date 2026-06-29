"use strict";

/**
 * FitHub AI V3 - Frontend Logic
 * ---------------------------------------------------------------------------
 * Vanilla ES6. Talks to the Express/SQLite backend via /api routes.
 * Handles auth, routing (SPA views), and all interactive features.
 * ---------------------------------------------------------------------------
 */

/* ========================================================================== */
/*  USER MODE & LOCAL STORAGE HELPERS                                         */
/* ========================================================================== */

const USER_MODE = {
  AUTHENTICATED: 'authenticated',
  ANONYMOUS: 'anonymous'
};

function getUserMode() {
  return token() ? USER_MODE.AUTHENTICATED :
         localStorage.getItem('userName') ? USER_MODE.ANONYMOUS : null;
}

function getCurrentUser() {
  const mode = getUserMode();
  if (mode === USER_MODE.AUTHENTICATED) {
    return { mode, name: null, userId: null };
  }
  if (mode === USER_MODE.ANONYMOUS) {
    return {
      mode,
      name: localStorage.getItem('userName'),
      profile: JSON.parse(localStorage.getItem('anonProfile') || '{}')
    };
  }
  return null;
}

const ANON_STORE = {
  KEYS: {
    PROFILE: 'anonProfile',
    MEALS: 'anonMeals',
    WATER: 'anonWater',
    WORKOUTS: 'anonWorkouts',
    PROGRESS: 'anonProgress',
    SETTINGS: 'anonSettings'
  },
  get(key) { return JSON.parse(localStorage.getItem(key) || '[]'); },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
  push(key, item) { const arr = this.get(key); arr.push(item); this.set(key, arr); },
  remove(key, id) { const arr = this.get(key).filter(x => x.id !== id); this.set(key, arr); },
  update(key, id, updates) {
    const arr = this.get(key).map(x => x.id === id ? { ...x, ...updates } : x);
    this.set(key, arr);
  }
};

/* ========================================================================== */
/*  LOCAL CALCULATORS (for anonymous users)                                    */
/* ========================================================================== */

function calcBMILocal(weight, height) {
  if (!weight || !height) return null;
  const m = height / 100;
  return +(weight / (m * m)).toFixed(1);
}

function bmiCategoryLocal(bmi) {
  if (bmi == null) return "--";
  if (bmi < 18.5) return "Underweight";
  if (bmi < 25) return "Normal";
  if (bmi < 30) return "Overweight";
  return "Obese";
}

function calcCalorieGoalLocal(p) {
  if (!p || !p.weight || !p.height || !p.age) return 2000;
  const s = p.gender === "female" ? -161 : 5;
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + s;
  const factors = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very: 1.9 };
  let tdee = bmr * (factors[p.activity] || 1.375);
  if (p.goal === "Fat Loss") tdee -= 400;
  if (p.goal === "Muscle Gain") tdee += 300;
  return Math.round(tdee);
}

function calcProteinLocal(p) {
  if (!p || !p.weight) return null;
  let perKg = 1.6;
  if (p.goal === "Muscle Gain") perKg = 2.0;
  else if (p.goal === "Fat Loss") perKg = 1.8;
  else if (p.goal === "Strength") perKg = 1.9;
  return Math.round(p.weight * perKg);
}

function calcWaterLocal(p) {
  if (!p || !p.weight) return 2.5;
  let litres = p.weight * 0.033;
  if (["active", "very"].includes(p.activity)) litres += 0.5;
  return +litres.toFixed(1);
}

/* ========================================================================== */
/*  LOCAL WORKOUT GENERATOR                                                    */
/* ========================================================================== */

const LOCAL_EXERCISES = [
  { name: "Push-ups", category: "Chest", equipment: "Bodyweight", difficulty: "Beginner", muscle: "Chest", instructions: "Keep your body straight, lower until elbows reach 90°, push back up." },
  { name: "Bench Press", category: "Chest", equipment: "Barbell", difficulty: "Intermediate", muscle: "Chest", instructions: "Lower the bar to mid-chest, press up until arms are extended." },
  { name: "Pull-ups", category: "Back", equipment: "Bar", difficulty: "Intermediate", muscle: "Back", instructions: "Hang with arms extended, pull chin above the bar, lower slowly." },
  { name: "Deadlift", category: "Back", equipment: "Barbell", difficulty: "Advanced", muscle: "Back/Legs", instructions: "Hinge at hips, keep back flat, drive through heels to stand." },
  { name: "Squats", category: "Legs", equipment: "Bodyweight", difficulty: "Beginner", muscle: "Legs", instructions: "Feet shoulder-width, sit back and down, keep chest up." },
  { name: "Lunges", category: "Legs", equipment: "Bodyweight", difficulty: "Beginner", muscle: "Legs", instructions: "Step forward, lower back knee toward the floor, return." },
  { name: "Shoulder Press", category: "Shoulders", equipment: "Dumbbell", difficulty: "Intermediate", muscle: "Shoulders", instructions: "Press weights overhead until arms extend, lower to shoulders." },
  { name: "Biceps Curl", category: "Arms", equipment: "Dumbbell", difficulty: "Beginner", muscle: "Biceps", instructions: "Curl the weights toward shoulders, keep elbows fixed, lower slowly." },
  { name: "Plank", category: "Core", equipment: "Bodyweight", difficulty: "Beginner", muscle: "Core", instructions: "Hold a straight line on forearms and toes, brace your core." },
  { name: "Burpees", category: "Full Body", equipment: "Bodyweight", difficulty: "Advanced", muscle: "Full Body", instructions: "Squat, kick to plank, push-up, jump back up explosively." },
  { name: "Running", category: "Cardio", equipment: "None", difficulty: "Beginner", muscle: "Cardio", instructions: "Maintain steady pace, land mid-foot, keep breathing rhythmic." },
  { name: "Cycling", category: "Cardio", equipment: "Bike", difficulty: "Beginner", muscle: "Cardio", instructions: "Keep a steady cadence, adjust resistance for intensity." },
  { name: "Jump Rope", category: "Cardio", equipment: "Rope", difficulty: "Beginner", muscle: "Cardio", instructions: "Jump on the balls of your feet, turning the rope with the wrists." },
  { name: "Mountain Climbers", category: "Core", equipment: "Bodyweight", difficulty: "Intermediate", muscle: "Core", instructions: "From plank, drive knees toward chest alternately at pace." },
  { name: "Yoga", category: "Flexibility", equipment: "Mat", difficulty: "Beginner", muscle: "Flexibility", instructions: "Flow through poses with controlled breathing and balance." },
  { name: "Swimming", category: "Cardio", equipment: "Pool", difficulty: "Intermediate", muscle: "Full Body", instructions: "Use full-body strokes, exhale underwater, keep a steady rhythm." },
  { name: "HIIT", category: "Cardio", equipment: "None", difficulty: "Advanced", muscle: "Full Body", instructions: "Alternate 30s max effort with 30s rest for several rounds." },
  { name: "Walking", category: "Cardio", equipment: "None", difficulty: "Beginner", muscle: "Cardio", instructions: "Brisk steady walk, swing arms, keep an upright posture." }
];

const LOCAL_MET = { Walking: 3.5, Running: 9.8, Cycling: 7.5, "Jump Rope": 11, Squats: 5, Burpees: 10, "Mountain Climbers": 9, Yoga: 3, Swimming: 8, HIIT: 12, Plank: 4 };

const LOCAL_GOAL_EXERCISES = {
  "Muscle Gain": ["Bench Press", "Deadlift", "Shoulder Press", "Biceps Curl", "Squats", "Pull-ups"],
  "Fat Loss": ["Running", "Burpees", "Mountain Climbers", "Jump Rope", "HIIT", "Cycling"],
  "Strength": ["Deadlift", "Bench Press", "Squats", "Shoulder Press", "Pull-ups"],
  "Endurance": ["Running", "Cycling", "Swimming", "Plank", "Walking"],
  "Home Workout": ["Push-ups", "Squats", "Plank", "Burpees", "Mountain Climbers", "Jump Rope", "Yoga"],
  "Gym Workout": ["Bench Press", "Deadlift", "Shoulder Press", "Biceps Curl"]
};

function generateLocalWorkout(level, goal, weight) {
  const setMap = { Beginner: [3, "10-12"], Intermediate: [4, "8-10"], Advanced: [5, "6-8"] };
  const [sets, reps] = setMap[level] || setMap.Beginner;
  const names = LOCAL_GOAL_EXERCISES[goal] || LOCAL_GOAL_EXERCISES["Muscle Gain"];

  const exercises = names.map((name) => {
    const ex = LOCAL_EXERCISES.find(e => e.name === name) || LOCAL_EXERCISES[0];
    const met = LOCAL_MET[name] || 5;
    const calPerMin = (met * 3.5 * weight) / 200;
    const duration = 8;
    return { name, sets, reps, rest: "60-90s", muscle: ex.muscle, difficulty: level, calories: Math.round(calPerMin * duration), instructions: `Perform ${sets} sets of ${reps} reps with controlled form. Rest 60-90s between sets.` };
  });
  return { level, goal, exercises };
}

function setupWorkoutTimer(list, onFinish) {
  const timerEl = list.querySelector("#timer");
  const tick = () => {
    workoutSeconds++;
    const mm = String(Math.floor(workoutSeconds / 60)).padStart(2, "0");
    const ss = String(workoutSeconds % 60).padStart(2, "0");
    timerEl.textContent = `${mm}:${ss}`;
  };

  const startBtn = list.querySelector("#startW");
  const pauseBtn = list.querySelector("#pauseW");
  const finishBtn = list.querySelector("#finishW");

  if (startBtn) startBtn.onclick = () => { if (workoutTimer) return; workoutTimer = setInterval(tick, 1000); toast("Workout started!"); };
  if (pauseBtn) pauseBtn.onclick = () => { stopWorkoutTimer(); toast("Paused"); };
  if (finishBtn) finishBtn.onclick = () => { stopWorkoutTimer(); onFinish(timerEl); };
}

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
  const headers = { "Content-Type": "application/json" };
  const t = token();
  if (t) headers.Authorization = "Bearer " + t;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({ error: "Unexpected server response" }));
  if (!res.ok) {
    if (res.status === 401 && getUserMode() === USER_MODE.ANONYMOUS) {
      throw new Error(data.error || "Request failed");
    }
    if (res.status === 401) {
      localStorage.removeItem("token");
      location.reload();
    }
    throw new Error(data.error || "Request failed");
  }
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
const getStartedScreen = $("#getStarted");
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
  const tabLogin = $("#tabLogin");
  const tabRegister = $("#tabRegister");
  if (tabLogin) tabLogin.onclick = () => switchTab("login");
  if (tabRegister) tabRegister.onclick = () => switchTab("register");

  const loginForm = $("#loginForm");
  if (loginForm) loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const d = await api("/login", "POST", {
        username: f.username.value.trim(),
        password: f.password.value
      });
      localStorage.setItem("token", d.token);
      if (authScreen) authScreen.classList.add("hidden");
      enterApp({ skipWizard: !!d.setupDone });
    } catch (err) {
      authMsg(err.message);
    }
  };

  const registerForm = $("#registerForm");
  if (registerForm) registerForm.onsubmit = async (e) => {
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
      if (authScreen) authScreen.classList.add("hidden");
      enterApp({ skipWizard: false });
    } catch (err) {
      authMsg(err.message);
    }
  };

  $$("#demoBtn").forEach((btn) => {
    btn.onclick = async () => {
      try {
        const d = await api("/demo", "POST", {});
        localStorage.setItem("token", d.token);
        if (authScreen) authScreen.classList.add("hidden");
        if (getStartedScreen) getStartedScreen.classList.add("hidden");
        enterApp({ skipWizard: true });
        toast("Welcome to the demo account!");
      } catch (err) {
        authMsg(err.message);
      }
    };
  });
}

/* ========================================================================== */
/*  SETUP WIZARD                                                               */
/* ========================================================================== */

function bindWizard() {
  const skipBtn = $("#skipWizard");
  if (skipBtn) skipBtn.onclick = () => {
    $("#wizard").classList.add("hidden");
    render("dashboard");
  };

  const wizForm = $("#wizardForm");
  if (wizForm) wizForm.onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const mode = getUserMode();
    if (mode === USER_MODE.ANONYMOUS) {
      const profile = {
        age: +f.age.value || null,
        gender: f.gender.value || null,
        height: +f.height.value || null,
        weight: +f.weight.value || null,
        goal: f.goal.value || null,
        activity: f.activity.value || null
      };
      localStorage.setItem('anonProfile', JSON.stringify(profile));
      $("#wizard").classList.add("hidden");
      toast("Profile saved!");
      render("dashboard");
    } else {
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
    }
  };
}

/* ========================================================================== */
/*  GET STARTED SCREEN                                                         */
/* ========================================================================== */

function showGetStartedScreen() {
  if (getStartedScreen) getStartedScreen.classList.remove("hidden");
  if (authScreen) authScreen.classList.add("hidden");
  if (appShell) appShell.classList.add("hidden");
}

function bindGetStarted() {
  const form = $("#getStartedForm");
  if (form) form.onsubmit = (e) => {
    e.preventDefault();
    const name = form.querySelector('input[name="name"]').value.trim();
    if (!name) return;
    localStorage.setItem("userName", name);
    enterApp({ skipWizard: false });
    toast("Welcome, " + name + "!");
  };

  const showLogin = $("#showLoginLink");
  if (showLogin) showLogin.onclick = (e) => {
    e.preventDefault();
    if (getStartedScreen) getStartedScreen.classList.add("hidden");
    if (authScreen) authScreen.classList.remove("hidden");
  };

  const closeAuth = $("#closeAuthModal");
  if (closeAuth) closeAuth.onclick = () => {
    if (authScreen) authScreen.classList.add("hidden");
    if (getStartedScreen) getStartedScreen.classList.remove("hidden");
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
  if (logout) logout.onclick = () => { localStorage.clear(); location.reload(); };

  const navLogin = $("#navLoginLink");
  if (navLogin) navLogin.onclick = (e) => {
    e.preventDefault();
    if (appShell) appShell.classList.add("hidden");
    if (authScreen) authScreen.classList.remove("hidden");
    switchTab("login");
  };

  updateNavVisibility();
}

function updateNavVisibility() {
  const mode = getUserMode();
  const isAnon = mode === USER_MODE.ANONYMOUS;
  const profileLink = $("#nav a[data-view=profile]");
  const settingsLink = $("#nav a[data-view=settings]");
  const loginLink = $("#navLoginLink");
  const logoutBtn = $("#logoutBtn");

  if (profileLink) profileLink.classList.toggle("hidden", isAnon);
  if (settingsLink) settingsLink.classList.toggle("hidden", isAnon);
  if (loginLink) loginLink.classList.toggle("hidden", !isAnon);
  if (logoutBtn) logoutBtn.classList.toggle("hidden", isAnon);
}

/* ========================================================================== */
/*  APP ENTRY                                                                  */
/* ========================================================================== */

function enterApp({ skipWizard = false } = {}) {
  if (authScreen) authScreen.classList.add("hidden");
  if (getStartedScreen) getStartedScreen.classList.add("hidden");
  appShell.classList.remove("hidden");
  if (!skipWizard) {
    const mode = getUserMode();
    if (mode === USER_MODE.AUTHENTICATED) {
      // wizard logic only for authenticated users
    }
  }
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
  const mode = getUserMode();
  const quotes = [
    "Discipline is choosing what you want most over what you want now.",
    "The body achieves what the mind believes.",
    "Small steps every day lead to big results.",
    "Sweat now, shine later.",
    "Your only limit is you."
  ];
  const quote = quotes[Math.floor(Math.random() * quotes.length)];

  if (mode === USER_MODE.ANONYMOUS) {
    const p = JSON.parse(localStorage.getItem('anonProfile') || '{}');
    const userName = localStorage.getItem('userName') || 'there';
    const weight = p.weight || 70;
    const height = p.height || 170;
    const age = p.age || 25;
    const gender = p.gender || 'male';
    const activity = p.activity || 'moderate';
    const goal = p.goal || 'Weight Maintenance';
    const calorieGoal = calcCalorieGoalLocal({ weight, height, age, gender, activity, goal });
    const proteinGoal = calcProteinLocal({ weight, goal });
    const waterGoal = calcWaterLocal({ weight, activity });
    const waterGlasses = parseInt(localStorage.getItem(ANON_STORE.KEYS.WATER) || '0');
    const bmi = calcBMILocal(weight, height);

    v.innerHTML = `
      <h1 class="view-title">Welcome, ${escapeHtml(userName)} 👋</h1>
      <div class="card quote-card"><p>"${escapeHtml(quote)}"</p></div>

      <div class="grid">
        <div class="card stat"><h4>Calorie Goal</h4><div class="big">${calorieGoal}</div><span class="muted">kcal/day</span></div>
        <div class="card stat"><h4>BMI</h4><div class="big">${bmi ?? "--"}</div><span class="muted">${bmiCategoryLocal(bmi)}</span></div>
        <div class="card stat"><h4>Water Today</h4><div class="big"><span id="waterCount">${waterGlasses}</span> / ${Math.round(waterGoal * 4)} glasses</div></div>
      </div>

      <div class="grid two" style="margin-top:1rem">
        <div class="card water-card">
          <h4>Water Intake</h4>
          <div class="row" style="margin-top:.6rem">
            <button class="btn ghost" id="waterMinus">−</button>
            <button class="btn primary" id="waterPlus">+ Glass</button>
          </div>
          <p class="muted" style="margin-top:.4rem">Goal: ${waterGoal} L • Protein: ${proteinGoal ?? "--"} g</p>
        </div>
        <div class="card">
          <h4>Quick Actions</h4>
          <div class="row wrap" style="margin-top:.6rem">
            <button class="btn primary qa" data-go="workout">Start Workout</button>
            <button class="btn ghost qa" data-go="diet">Generate Diet</button>
            <button class="btn ghost qa" data-go="tracker">Log Food</button>
            <button class="btn ghost qa" data-go="chat">Ask AI Coach</button>
          </div>
        </div>
      </div>`;

    const updateWater = (delta) => {
      const current = parseInt(localStorage.getItem(ANON_STORE.KEYS.WATER) || '0');
      const next = Math.max(0, current + delta);
      localStorage.setItem(ANON_STORE.KEYS.WATER, String(next));
      $("#waterCount").textContent = next;
    };
    const wp = $("#waterPlus");
    const wm = $("#waterMinus");
    if (wp) wp.onclick = () => updateWater(1);
    if (wm) wm.onclick = () => updateWater(-1);

    $$(".qa").forEach((b) => b.onclick = () => {
      const go = b.dataset.go;
      const link = $(`#nav a[data-view="${go}"]`);
      if (link) link.click(); else render(go);
    });
    return;
  }

  /* Authenticated mode */
  let d;
  try { d = await api("/dashboard"); } catch (e) { throw e; }

  v.innerHTML = `
    <h1 class="view-title">Welcome back, ${escapeHtml(d.username)} 👋</h1>
    <div class="card quote-card"><p>"${escapeHtml(quote)}"</p></div>

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
  const wp = $("#waterPlus");
  const wm = $("#waterMinus");
  if (wp) wp.onclick = () => updateWater(1);
  if (wm) wm.onclick = () => updateWater(-1);

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

  const mode = getUserMode();
  const f = $("#calcForm");

  /* Pre-fill from profile when available. */
  if (mode === USER_MODE.ANONYMOUS) {
    const p = JSON.parse(localStorage.getItem('anonProfile') || '{}');
    if (p.age) f.age.value = p.age;
    if (p.gender) f.gender.value = p.gender;
    if (p.height) f.height.value = p.height;
    if (p.weight) f.weight.value = p.weight;
    if (p.goal) f.goal.value = p.goal;
    if (p.activity) f.activity.value = p.activity;
  } else {
    try {
      const p = await api("/profile");
      if (p.age) f.age.value = p.age;
      if (p.gender) f.gender.value = p.gender;
      if (p.height) f.height.value = p.height;
      if (p.weight) f.weight.value = p.weight;
      if (p.goal) f.goal.value = p.goal;
      if (p.activity) f.activity.value = p.activity;
    } catch (e) { /* ignore */ }
  }

  $("#calcForm").onsubmit = (e) => {
    e.preventDefault();
    const form = e.target;
    const data = {
      age: +form.age.value || null,
      gender: form.gender.value || null,
      height: +form.height.value || null,
      weight: +form.weight.value || null,
      goal: form.goal.value || null,
      activity: form.activity.value || null
    };

    if (mode === USER_MODE.ANONYMOUS) {
      /* Save to anonymous profile */
      localStorage.setItem('anonProfile', JSON.stringify(data));
      const bmi = calcBMILocal(data.weight, data.height);
      const calorieGoal = calcCalorieGoalLocal(data);
      const proteinGoal = calcProteinLocal(data);
      const waterGoal = calcWaterLocal(data);
      $("#calcResult").innerHTML = `
        <div class="card stat"><h4>BMI</h4><div class="big">${bmi ?? "--"}</div><span class="muted">${bmiCategoryLocal(bmi)}</span></div>
        <div class="card stat"><h4>Daily Calories</h4><div class="big">${calorieGoal}</div><span class="muted">kcal/day</span></div>
        <div class="card stat"><h4>Protein</h4><div class="big">${proteinGoal ?? "--"}</div><span class="muted">g/day</span></div>
        <div class="card stat"><h4>Water</h4><div class="big">${waterGoal}</div><span class="muted">litres/day</span></div>`;
    } else {
      api("/calculate", "POST", data).then((r) => {
        $("#calcResult").innerHTML = `
          <div class="card stat"><h4>BMI</h4><div class="big">${r.bmi ?? "--"}</div><span class="muted">${escapeHtml(r.bmiCategory)}</span></div>
          <div class="card stat"><h4>Daily Calories</h4><div class="big">${r.calorieGoal}</div><span class="muted">kcal/day</span></div>
          <div class="card stat"><h4>Protein</h4><div class="big">${r.proteinGoal ?? "--"}</div><span class="muted">g/day</span></div>
          <div class="card stat"><h4>Water</h4><div class="big">${r.waterGoal}</div><span class="muted">litres/day</span></div>`;
      }).catch((err) => toast(err.message, "err"));
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

  const mode = getUserMode();

  $("#genW").onclick = async () => {
    const list = $("#wList");
    list.innerHTML = `<p class="muted">Generating plan...</p>`;
    const level = $("#wLevel").value;
    const goal = $("#wGoal").value;

    if (mode === USER_MODE.ANONYMOUS) {
      const p = JSON.parse(localStorage.getItem('anonProfile') || '{}');
      const weight = p.weight || 70;
      const plan = generateLocalWorkout(level, goal, weight);
      const total = plan.exercises.reduce((s, x) => s + x.calories, 0);

      list.innerHTML = `
        <div class="card timer-card">
          <h4>${escapeHtml(plan.goal)} • ${escapeHtml(plan.level)}</h4>
          <div class="timer" id="timer">00:00</div>
          <div class="row wrap">
            <button class="btn primary" id="startW">Start</button>
            <button class="btn ghost" id="pauseW">Pause</button>
            <button class="btn primary" id="finishW">Finish (+${total} kcal)</button>
          </div>
          <p class="muted" style="margin-top:.4rem">Estimated total burn: <b>${total} kcal</b></p>
        </div>
        ${plan.exercises.map((x) => `
          <div class="list-item ex">
            <div>
              <b>${escapeHtml(x.name)}</b> <span class="tag">${escapeHtml(x.muscle)}</span>
              <span class="tag">${escapeHtml(x.difficulty)}</span><br>
              <span class="muted">${x.sets} sets × ${escapeHtml(x.reps)} • rest ${escapeHtml(x.rest)}</span><br>
              <span class="muted">${escapeHtml(x.instructions)}</span>
            </div>
            <div class="cal"><b>${x.calories}</b><br><span class="muted">kcal</span></div>
          </div>`).join("")}`;

      setupWorkoutTimer(list, timerEl => {
        const minutes = Math.max(1, Math.round(workoutSeconds / 60)) || plan.exercises.length * 8;
        const workout = {
          id: Date.now(),
          date: new Date().toISOString().slice(0, 10),
          duration: minutes,
          calories: total,
          exercises: plan.exercises.length
        };
        ANON_STORE.push(ANON_STORE.KEYS.WORKOUTS, workout);
        toast(`Workout saved! ${minutes} min • ${total} kcal`);
        workoutSeconds = 0;
        timerEl.textContent = "00:00";
      });
      return;
    }

    /* Authenticated mode */
    try {
      const d = await api("/workout/generate", "POST", { level, goal });
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

      setupWorkoutTimer(list, async timerEl => {
        const minutes = Math.max(1, Math.round(workoutSeconds / 60)) || d.exercises.length * 8;
        try {
          await api("/workout/finish", "POST", { duration: minutes, calories: total, exercises: d.exercises.length });
          toast(`Workout saved! ${minutes} min • ${total} kcal • ${d.exercises.length} exercises`);
          workoutSeconds = 0;
          timerEl.textContent = "00:00";
        } catch (e) { toast(e.message, "err"); }
      });
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
  const mode = getUserMode();

  if (mode === USER_MODE.ANONYMOUS) {
    const p = JSON.parse(localStorage.getItem('anonProfile') || '{}');
    const weight = p.weight || 70;
    const height = p.height || 170;
    const age = p.age || 25;
    const gender = p.gender || 'male';
    const activity = p.activity || 'moderate';
    const goal = p.goal || 'Weight Maintenance';
    const profile = { weight, height, age, gender, activity, goal };
    const calorieGoal = calcCalorieGoalLocal(profile);
    const proteinGoal = calcProteinLocal(profile);
    const waterGoal = calcWaterLocal(profile);
    const split = { Breakfast: 0.25, Lunch: 0.35, Dinner: 0.30, Snacks: 0.10 };
    const foods = { Breakfast: "Oats, eggs, banana, milk", Lunch: "Grilled chicken, rice, salad", Dinner: "Fish/paneer, veggies, quinoa", Snacks: "Greek yogurt, nuts, fruit" };
    const meals = {};
    for (const [k, ratio] of Object.entries(split)) {
      const cal = Math.round(calorieGoal * ratio);
      meals[k] = { food: foods[k], calories: cal, protein: Math.round((cal * 0.30) / 4), carbs: Math.round((cal * 0.45) / 4), fat: Math.round((cal * 0.25) / 9) };
    }

    v.innerHTML = `
      <h1 class="view-title">Diet Planner</h1>
      <div class="grid">
        <div class="card stat"><h4>Daily Target</h4><div class="big">${calorieGoal}</div><span class="muted">kcal</span></div>
        <div class="card stat"><h4>Protein</h4><div class="big">${proteinGoal ?? "--"}</div><span class="muted">g</span></div>
        <div class="card stat"><h4>Water</h4><div class="big">${waterGoal} L</div><span class="muted">per day</span></div>
      </div>
      <div class="grid" style="margin-top:1rem">
        ${Object.entries(meals).map(([k, x]) => `
          <div class="card meal-card">
            <h4>${escapeHtml(k)}</h4>
            <p>${escapeHtml(x.food)}</p>
            <p class="muted">${x.calories} kcal • P ${x.protein}g • C ${x.carbs}g • F ${x.fat}g</p>
          </div>`).join("")}
      </div>
      <p class="muted" style="margin-top:1rem">Tip: log what you actually eat in the Calorie Tracker.</p>`;
    return;
  }

  /* Authenticated mode */
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
  const mode = getUserMode();

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

  if (mode === USER_MODE.ANONYMOUS) {
    const loadMeals = () => {
      const meals = ANON_STORE.get(ANON_STORE.KEYS.MEALS);
      const today = new Date().toISOString().slice(0, 10);
      const todayMeals = meals.filter(m => m.date === today);
      const totals = todayMeals.reduce((t, m) => ({ calories: t.calories + (m.calories || 0), protein: t.protein + (m.protein || 0), carbs: t.carbs + (m.carbs || 0), fat: t.fat + (m.fat || 0) }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

      $("#trackerTotals").innerHTML = `
        <div class="card stat"><h4>Calories</h4><div class="big">${Math.round(totals.calories)}</div></div>
        <div class="card stat"><h4>Protein</h4><div class="big">${Math.round(totals.protein)}g</div></div>
        <div class="card stat"><h4>Carbs</h4><div class="big">${Math.round(totals.carbs)}g</div></div>
        <div class="card stat"><h4>Fat</h4><div class="big">${Math.round(totals.fat)}g</div></div>`;

      const list = $("#mealList");
      list.innerHTML = todayMeals.length
        ? todayMeals.map((x) => `
          <div class="list-item">
            <div><b>${escapeHtml(x.name)}</b> <span class="tag">${escapeHtml(x.type)}</span><br>
              <span class="muted">${Math.round(x.calories)} kcal • P ${Math.round(x.protein)}g</span></div>
            <button class="del" data-id="${x.id}" title="Delete">✕</button>
          </div>`).join("")
        : `<p class="muted">No meals logged today.</p>`;
      list.querySelectorAll(".del").forEach((b) => b.onclick = () => {
        ANON_STORE.remove(ANON_STORE.KEYS.MEALS, +b.dataset.id);
        loadMeals();
      });
    };

    const addMeal = (meal) => {
      meal.id = Date.now();
      meal.date = new Date().toISOString().slice(0, 10);
      ANON_STORE.push(ANON_STORE.KEYS.MEALS, meal);
      toast("Meal added!");
      loadMeals();
    };

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
          addMeal({ type: $("#mealType").value, name: f.name, calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat });
          $("#foodSearch").value = "";
          results.innerHTML = "";
        });
      } catch (e) { toast(e.message, "err"); }
    };

    $("#foodSearch").oninput = doSearch;
    $("#addCustom").onclick = () => {
      const name = $("#cName").value.trim();
      if (!name) return toast("Enter a food name", "err");
      addMeal({ type: $("#mealType").value, name, calories: +$("#cCal").value || 0, protein: +$("#cPro").value || 0, carbs: +$("#cCarb").value || 0, fat: +$("#cFat").value || 0 });
      $("#cName").value = ""; $("#cCal").value = "";
      $("#cPro").value = ""; $("#cCarb").value = ""; $("#cFat").value = "";
    };

    loadMeals();
    return;
  }

  /* Authenticated mode */
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
  const mode = getUserMode();

  if (mode === USER_MODE.ANONYMOUS) {
    const prog = ANON_STORE.get(ANON_STORE.KEYS.PROGRESS);
    const hist = ANON_STORE.get(ANON_STORE.KEYS.WORKOUTS);
    const wData = prog.map((p) => ({ date: (p.date || "").slice(5), weight: p.weight || 0 }));
    const bData = prog.map((p) => ({ date: (p.date || "").slice(5), bmi: p.bmi || 0 }));

    v.innerHTML = `
      <h1 class="view-title">Progress Tracker</h1>
      <div class="grid two">
        <div class="card">
          <h4>Weight History (kg)</h4>
          ${wData.length ? barChart(wData, "weight", "linear-gradient(180deg,var(--good),var(--primary2))") : '<p class="muted">No data yet.</p>'}
        </div>
        <div class="card">
          <h4>BMI History</h4>
          ${bData.length ? barChart(bData, "bmi", "linear-gradient(180deg,var(--primary2),var(--primary))") : '<p class="muted">No data yet.</p>'}
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
    return;
  }

  /* Authenticated mode */
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
  const mode = getUserMode();
  const userName = mode === USER_MODE.ANONYMOUS ? (localStorage.getItem('userName') || 'there') : '';

  v.innerHTML = `
    <h1 class="view-title">AI Fitness Coach</h1>
    <div class="card chat-card">
      <div id="chatLog" class="chat-log">
        <div class="bubble bot">Hi${mode === USER_MODE.ANONYMOUS ? ", " + escapeHtml(userName) : ""}! I'm your FitHub AI coach. Ask me about workouts, diet, protein, water, or motivation. 💪</div>
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
      const body = { message: msg };
      if (mode === USER_MODE.ANONYMOUS) body.profile = JSON.parse(localStorage.getItem('anonProfile') || '{}');
      const r = await api("/chat", "POST", body);
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
  const mode = getUserMode();
  if (mode === USER_MODE.ANONYMOUS) {
    v.innerHTML = `
      <h1 class="view-title">My Profile</h1>
      <div class="card">
        <p>Please <a href="#" id="loginFromProfile">Login or Sign Up</a> to save your profile permanently and sync across devices.</p>
      </div>`;
    const link = $("#loginFromProfile");
    if (link) link.onclick = (e) => { e.preventDefault(); render("about"); };
    return;
  }
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
  const mode = getUserMode();
  if (mode === USER_MODE.ANONYMOUS) {
    v.innerHTML = `
      <h1 class="view-title">Settings</h1>
      <div class="card">
        <p>Please <a href="#" id="loginFromSettings">Login or Sign Up</a> to access settings, change your password, and manage your account.</p>
      </div>`;
    const link = $("#loginFromSettings");
    if (link) link.onclick = (e) => { e.preventDefault(); render("about"); };
    return;
  }
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

  const mode = getUserMode();
  if (mode === USER_MODE.ANONYMOUS) return;

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

  bindGetStarted();
  bindAuth();
  bindWizard();
  bindNav();
  bindHamburger();

  const mode = getUserMode();
  if (mode === USER_MODE.AUTHENTICATED) {
    api("/dashboard")
      .then((d) => enterApp({ skipWizard: !!d.setupDone }))
      .catch(() => { localStorage.removeItem("token"); showGetStartedScreen(); });
  } else if (mode === USER_MODE.ANONYMOUS) {
    enterApp({ skipWizard: true });
  } else {
    showGetStartedScreen();
  }
})();
