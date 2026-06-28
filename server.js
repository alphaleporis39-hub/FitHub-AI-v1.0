"use strict";

/**
 * FitHub AI V3 - Backend Server
 * ---------------------------------------------------------------------------
 * Stack: Express + better-sqlite3 + JWT + bcrypt
 *
 * Design rules:
 *  - Every response is JSON (except static files / index.html).
 *  - Every route is wrapped in try/catch -> global error handler.
 *  - The process never crashes (uncaught handlers installed).
 *  - SQLite schema is self-healing (auto migrate/recreate on mismatch).
 *  - Frontend is served from the public/ folder via static middleware.
 * ---------------------------------------------------------------------------
 */

const path = require("path");
const fs = require("fs");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "fithub-ai-secret-change-me";
const AI_API_KEY = process.env.AI_API_KEY || ""; // optional; offline fallback used if empty

/* ========================================================================== */
/*  DATABASE SETUP                                                             */
/* ========================================================================== */

const db = new Database(path.join(__dirname, "fithub.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/* Create tables if they do not exist. */
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS profile (
    user_id INTEGER PRIMARY KEY,
    age INTEGER,
    gender TEXT,
    height REAL,
    weight REAL,
    goal TEXT,
    activity TEXT,
    photo TEXT,
    setup_done INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    date TEXT,
    duration INTEGER,
    calories REAL,
    exercises INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS diet_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    date TEXT,
    plan TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS meals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    date TEXT,
    type TEXT,
    name TEXT,
    calories REAL,
    protein REAL,
    carbs REAL,
    fat REAL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS water_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    date TEXT,
    glasses INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    date TEXT,
    weight REAL,
    bmi REAL,
    calories REAL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    user_id INTEGER PRIMARY KEY,
    theme TEXT DEFAULT 'dark',
    water_reminder INTEGER DEFAULT 1,
    workout_reminder INTEGER DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

/* ========================================================================== */
/*  SCHEMA SELF-HEALING MIGRATION                                              */
/* ========================================================================== */

/**
 * Verify a table has all required columns. If not, attempt to add the missing
 * columns in-place (safe for SQLite). Used for additive changes.
 */
function ensureColumns(table, columnDefs) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  for (const { name, def } of columnDefs) {
    if (!existing.includes(name)) {
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def};`);
        console.warn(`[MIGRATION] Added missing column ${table}.${name}`);
      } catch (e) {
        console.warn(`[MIGRATION] Could not add ${table}.${name}: ${e.message}`);
      }
    }
  }
}

/**
 * Rebuild the users table if its schema is incompatible (e.g. missing the
 * username column from a previous version). Recovers data where possible so
 * registration works without any manual database editing.
 */
function ensureUsersSchema() {
  const cols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  const required = ["id", "username", "password", "created_at"];
  const ok = required.every((c) => cols.includes(c));
  if (ok) return;

  console.warn("[MIGRATION] users table schema outdated. Rebuilding...");
  const tx = db.transaction(() => {
    db.exec("ALTER TABLE users RENAME TO users_old;");
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const oldCols = db.prepare("PRAGMA table_info(users_old)").all().map((c) => c.name);
    const nameCol = ["username", "user", "name", "email"].find((c) => oldCols.includes(c));
    const passCol = ["password", "pass", "password_hash", "hash"].find((c) => oldCols.includes(c));

    if (nameCol && passCol) {
      const rows = db.prepare(`SELECT ${nameCol} AS u, ${passCol} AS p FROM users_old`).all();
      const insert = db.prepare("INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)");
      let recovered = 0;
      for (const r of rows) {
        if (r.u && r.p) { insert.run(String(r.u), String(r.p)); recovered++; }
      }
      console.warn(`[MIGRATION] Recovered ${recovered} user record(s).`);
    }

    db.exec("DROP TABLE users_old;");
  });
  tx();
  console.warn("[MIGRATION] users table rebuilt successfully.");
}

ensureUsersSchema();
ensureColumns("profile", [
  { name: "photo", def: "TEXT" },
  { name: "setup_done", def: "INTEGER DEFAULT 0" }
]);
ensureColumns("settings", [
  { name: "water_reminder", def: "INTEGER DEFAULT 1" },
  { name: "workout_reminder", def: "INTEGER DEFAULT 1" }
]);

/* ========================================================================== */
/*  MIDDLEWARE                                                                 */
/* ========================================================================== */

app.use(express.json({ limit: "5mb" })); // larger limit allows base64 profile photos

/* Serve the frontend exclusively from the public/ folder. */
app.use(express.static(path.join(__dirname, "public")));

/** JWT auth guard. Attaches req.user = { id, username }. */
function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Not authenticated" });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

/* ========================================================================== */
/*  HELPERS                                                                    */
/* ========================================================================== */

const today = () => new Date().toISOString().slice(0, 10);

/** Calculate BMI from weight (kg) and height (cm). */
function calcBMI(weight, height) {
  if (!weight || !height) return null;
  const m = height / 100;
  return +(weight / (m * m)).toFixed(1);
}

/** Friendly BMI category. */
function bmiCategory(bmi) {
  if (bmi == null) return "--";
  if (bmi < 18.5) return "Underweight";
  if (bmi < 25) return "Normal";
  if (bmi < 30) return "Overweight";
  return "Obese";
}

/** Daily calorie goal via Mifflin-St Jeor + activity + goal adjustment. */
function calcCalorieGoal(p) {
  if (!p || !p.weight || !p.height || !p.age) return 2000;
  const s = p.gender === "female" ? -161 : 5;
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + s;
  const factors = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very: 1.9 };
  let tdee = bmr * (factors[p.activity] || 1.375);
  if (p.goal === "Fat Loss") tdee -= 400;
  if (p.goal === "Muscle Gain") tdee += 300;
  return Math.round(tdee);
}

/** Daily protein target (g) based on weight and goal. */
function calcProtein(p) {
  if (!p || !p.weight) return null;
  let perKg = 1.6;
  if (p.goal === "Muscle Gain") perKg = 2.0;
  else if (p.goal === "Fat Loss") perKg = 1.8;
  else if (p.goal === "Strength") perKg = 1.9;
  return Math.round(p.weight * perKg);
}

/** Daily water target in litres based on weight and activity. */
function calcWater(p) {
  if (!p || !p.weight) return 2.5;
  let litres = p.weight * 0.033;
  if (["active", "very"].includes(p.activity)) litres += 0.5;
  return +litres.toFixed(1);
}

/* ========================================================================== */
/*  STATIC FITNESS DATA (Exercise library, foods, MET values)                 */
/* ========================================================================== */

/** MET values used for calorie-burn estimation. */
const MET = {
  Walking: 3.5, Running: 9.8, Cycling: 7.5, "Jump Rope": 11, "Push-ups": 8, "Pull-ups": 8,
  Squats: 5, "Bench Press": 6, Deadlift: 6, "Shoulder Press": 6, "Biceps Curl": 4,
  "Triceps Extension": 4, Plank: 4, Burpees: 10, "Mountain Climbers": 9, Yoga: 3,
  Swimming: 8, HIIT: 12, Treadmill: 8, "Stair Climber": 9, Lunges: 5, "Leg Press": 5
};

const MUSCLE = {
  "Bench Press": "Chest", Deadlift: "Back/Legs", Squats: "Legs", "Pull-ups": "Back",
  "Push-ups": "Chest", "Shoulder Press": "Shoulders", "Biceps Curl": "Biceps",
  "Triceps Extension": "Triceps", Plank: "Core", Running: "Cardio", Cycling: "Cardio",
  "Jump Rope": "Cardio", Burpees: "Full Body", "Mountain Climbers": "Core", Yoga: "Flexibility",
  Swimming: "Full Body", HIIT: "Full Body", Treadmill: "Cardio", "Stair Climber": "Legs",
  Walking: "Cardio", Lunges: "Legs", "Leg Press": "Legs"
};

/** Full exercise library, searchable + categorized on the frontend. */
const EXERCISE_LIBRARY = [
  { name: "Push-ups", category: "Chest", equipment: "Bodyweight", difficulty: "Beginner",
    instructions: "Keep your body straight, lower until elbows reach 90°, push back up." },
  { name: "Bench Press", category: "Chest", equipment: "Barbell", difficulty: "Intermediate",
    instructions: "Lower the bar to mid-chest, press up until arms are extended." },
  { name: "Pull-ups", category: "Back", equipment: "Bar", difficulty: "Intermediate",
    instructions: "Hang with arms extended, pull chin above the bar, lower slowly." },
  { name: "Deadlift", category: "Back", equipment: "Barbell", difficulty: "Advanced",
    instructions: "Hinge at hips, keep back flat, drive through heels to stand." },
  { name: "Squats", category: "Legs", equipment: "Bodyweight", difficulty: "Beginner",
    instructions: "Feet shoulder-width, sit back and down, keep chest up." },
  { name: "Lunges", category: "Legs", equipment: "Bodyweight", difficulty: "Beginner",
    instructions: "Step forward, lower back knee toward the floor, return." },
  { name: "Leg Press", category: "Legs", equipment: "Machine", difficulty: "Intermediate",
    instructions: "Push the platform until legs are nearly straight, lower with control." },
  { name: "Shoulder Press", category: "Shoulders", equipment: "Dumbbell", difficulty: "Intermediate",
    instructions: "Press weights overhead until arms extend, lower to shoulders." },
  { name: "Biceps Curl", category: "Arms", equipment: "Dumbbell", difficulty: "Beginner",
    instructions: "Curl the weights toward shoulders, keep elbows fixed, lower slowly." },
  { name: "Triceps Extension", category: "Arms", equipment: "Dumbbell", difficulty: "Beginner",
    instructions: "Extend the weight overhead, lower behind the head, press back up." },
  { name: "Plank", category: "Core", equipment: "Bodyweight", difficulty: "Beginner",
    instructions: "Hold a straight line on forearms and toes, brace your core." },
  { name: "Mountain Climbers", category: "Core", equipment: "Bodyweight", difficulty: "Intermediate",
    instructions: "From plank, drive knees toward chest alternately at pace." },
  { name: "Burpees", category: "Full Body", equipment: "Bodyweight", difficulty: "Advanced",
    instructions: "Squat, kick to plank, push-up, jump back up explosively." },
  { name: "Jump Rope", category: "Cardio", equipment: "Rope", difficulty: "Beginner",
    instructions: "Jump on the balls of your feet, turning the rope with the wrists." },
  { name: "Running", category: "Cardio", equipment: "None", difficulty: "Beginner",
    instructions: "Maintain steady pace, land mid-foot, keep breathing rhythmic." },
  { name: "Cycling", category: "Cardio", equipment: "Bike", difficulty: "Beginner",
    instructions: "Keep a steady cadence, adjust resistance for intensity." },
  { name: "Swimming", category: "Cardio", equipment: "Pool", difficulty: "Intermediate",
    instructions: "Use full-body strokes, exhale underwater, keep a steady rhythm." },
  { name: "HIIT", category: "Cardio", equipment: "None", difficulty: "Advanced",
    instructions: "Alternate 30s max effort with 30s rest for several rounds." },
  { name: "Treadmill", category: "Cardio", equipment: "Machine", difficulty: "Beginner",
    instructions: "Walk or run at chosen speed and incline for the set duration." },
  { name: "Stair Climber", category: "Cardio", equipment: "Machine", difficulty: "Intermediate",
    instructions: "Step continuously at a steady pace, keep posture upright." },
  { name: "Yoga", category: "Flexibility", equipment: "Mat", difficulty: "Beginner",
    instructions: "Flow through poses with controlled breathing and balance." },
  { name: "Walking", category: "Cardio", equipment: "None", difficulty: "Beginner",
    instructions: "Brisk steady walk, swing arms, keep an upright posture." }
];

/** Goal -> exercise selection for the workout planner. */
const GOAL_EXERCISES = {
  "Muscle Gain": ["Bench Press", "Deadlift", "Shoulder Press", "Biceps Curl", "Triceps Extension", "Squats", "Pull-ups"],
  "Fat Loss": ["Running", "Burpees", "Mountain Climbers", "Jump Rope", "HIIT", "Cycling", "Squats"],
  "Strength": ["Deadlift", "Bench Press", "Squats", "Shoulder Press", "Pull-ups"],
  "Endurance": ["Running", "Cycling", "Swimming", "Treadmill", "Stair Climber", "Plank"],
  "Home Workout": ["Push-ups", "Squats", "Plank", "Burpees", "Mountain Climbers", "Jump Rope", "Yoga"],
  "Gym Workout": ["Bench Press", "Deadlift", "Shoulder Press", "Biceps Curl", "Treadmill", "Stair Climber"]
};

/** Common foods for the food-logging search feature. */
const FOOD_DB = [
  { name: "Boiled Egg", calories: 78, protein: 6, carbs: 1, fat: 5 },
  { name: "Chicken Breast (100g)", calories: 165, protein: 31, carbs: 0, fat: 4 },
  { name: "White Rice (1 cup)", calories: 205, protein: 4, carbs: 45, fat: 0 },
  { name: "Brown Rice (1 cup)", calories: 216, protein: 5, carbs: 45, fat: 2 },
  { name: "Oats (1 cup)", calories: 154, protein: 6, carbs: 27, fat: 3 },
  { name: "Banana", calories: 105, protein: 1, carbs: 27, fat: 0 },
  { name: "Apple", calories: 95, protein: 0, carbs: 25, fat: 0 },
  { name: "Greek Yogurt (1 cup)", calories: 100, protein: 17, carbs: 6, fat: 1 },
  { name: "Almonds (28g)", calories: 164, protein: 6, carbs: 6, fat: 14 },
  { name: "Peanut Butter (1 tbsp)", calories: 94, protein: 4, carbs: 3, fat: 8 },
  { name: "Salmon (100g)", calories: 208, protein: 20, carbs: 0, fat: 13 },
  { name: "Paneer (100g)", calories: 265, protein: 18, carbs: 6, fat: 20 },
  { name: "Whey Protein (1 scoop)", calories: 120, protein: 24, carbs: 3, fat: 1 },
  { name: "Bread Slice", calories: 79, protein: 3, carbs: 14, fat: 1 },
  { name: "Milk (1 cup)", calories: 122, protein: 8, carbs: 12, fat: 5 },
  { name: "Broccoli (1 cup)", calories: 55, protein: 4, carbs: 11, fat: 1 },
  { name: "Sweet Potato (1 med)", calories: 112, protein: 2, carbs: 26, fat: 0 },
  { name: "Tuna (100g)", calories: 132, protein: 28, carbs: 0, fat: 1 }
];

/* ========================================================================== */
/*  AUTH ROUTES                                                                */
/* ========================================================================== */

app.post("/api/register", (req, res, next) => {
  try {
    const { username, password, confirm } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });
    if (username.length < 3) return res.status(400).json({ error: "Username must be at least 3 characters" });
    if (password.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters" });
    if (confirm !== undefined && password !== confirm)
      return res.status(400).json({ error: "Passwords do not match" });

    const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (exists) return res.status(409).json({ error: "That username is already taken. Try another one." });

    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare("INSERT INTO users (username, password) VALUES (?, ?)").run(username, hash);
    const userId = info.lastInsertRowid;
    db.prepare("INSERT INTO profile (user_id) VALUES (?)").run(userId);
    db.prepare("INSERT INTO settings (user_id) VALUES (?)").run(userId);

    const token = jwt.sign({ id: userId, username }, JWT_SECRET, { expiresIn: "30d" });
    res.status(201).json({ token, username, setupDone: false, message: "Account created" });
  } catch (e) {
    next(e);
  }
});

app.post("/api/login", (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });

    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: "Invalid username or password" });

    const prof = db.prepare("SELECT setup_done FROM profile WHERE user_id = ?").get(user.id);
    const token = jwt.sign({ id: user.id, username }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, username, setupDone: !!(prof && prof.setup_done) });
  } catch (e) {
    next(e);
  }
});

/**
 * Demo account: creates (once) and logs into a ready-to-explore account with a
 * pre-filled profile and sample data. Lets users try the app instantly.
 */
app.post("/api/demo", (req, res, next) => {
  try {
    const demoUser = "demo";
    let user = db.prepare("SELECT * FROM users WHERE username = ?").get(demoUser);

    if (!user) {
      const hash = bcrypt.hashSync("demo1234", 10);
      const info = db.prepare("INSERT INTO users (username, password) VALUES (?, ?)").run(demoUser, hash);
      const id = info.lastInsertRowid;
      db.prepare(`
        INSERT INTO profile (user_id, age, gender, height, weight, goal, activity, setup_done)
        VALUES (?, 27, 'male', 178, 75, 'Muscle Gain', 'moderate', 1)
      `).run(id);
      db.prepare("INSERT INTO settings (user_id) VALUES (?)").run(id);

      // seed a little sample data so charts are not empty
      const seedWorkout = db.prepare("INSERT INTO workouts (user_id,date,duration,calories,exercises) VALUES (?,?,?,?,?)");
      const seedMeal = db.prepare("INSERT INTO meals (user_id,date,type,name,calories,protein,carbs,fat) VALUES (?,?,?,?,?,?,?,?)");
      const seedProg = db.prepare("INSERT INTO progress (user_id,date,weight,bmi,calories) VALUES (?,?,?,?,?)");
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const ds = d.toISOString().slice(0, 10);
        seedWorkout.run(id, ds, 45, 320 + i * 10, 6);
        seedProg.run(id, ds, 75 - i * 0.2, calcBMI(75 - i * 0.2, 178), 0);
      }
      seedMeal.run(id, today(), "Breakfast", "Oats & Eggs", 350, 22, 40, 10);
      user = db.prepare("SELECT * FROM users WHERE username = ?").get(demoUser);
    }

    const token = jwt.sign({ id: user.id, username: demoUser }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, username: demoUser, setupDone: true, demo: true });
  } catch (e) {
    next(e);
  }
});

/* ========================================================================== */
/*  PROFILE ROUTES                                                             */
/* ========================================================================== */

app.get("/api/profile", auth, (req, res, next) => {
  try {
    const p = db.prepare("SELECT * FROM profile WHERE user_id = ?").get(req.user.id) || {};
    p.username = req.user.username;
    p.bmi = calcBMI(p.weight, p.height);
    p.bmiCategory = bmiCategory(p.bmi);
    p.calorieGoal = calcCalorieGoal(p);
    p.proteinGoal = calcProtein(p);
    p.waterGoal = calcWater(p);
    res.json(p);
  } catch (e) {
    next(e);
  }
});

app.put("/api/profile", auth, (req, res, next) => {
  try {
    const { age, gender, height, weight, goal, activity, photo } = req.body || {};
    db.prepare(`
      UPDATE profile
      SET age = ?, gender = ?, height = ?, weight = ?, goal = ?, activity = ?,
          photo = COALESCE(?, photo), setup_done = 1
      WHERE user_id = ?
    `).run(age, gender, height, weight, goal, activity, photo || null, req.user.id);

    if (weight) {
      const bmi = calcBMI(weight, height);
      db.prepare("INSERT INTO progress (user_id, date, weight, bmi, calories) VALUES (?,?,?,?,?)")
        .run(req.user.id, today(), weight, bmi, 0);
    }

    res.json({ message: "Profile updated", setupDone: true });
  } catch (e) {
    next(e);
  }
});

app.put("/api/password", auth, (req, res, next) => {
  try {
    const { current, next: newPass } = req.body || {};
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!user || !bcrypt.compareSync(current || "", user.password))
      return res.status(401).json({ error: "Current password is incorrect" });
    if (!newPass || newPass.length < 4) return res.status(400).json({ error: "New password too short" });
    db.prepare("UPDATE users SET password = ? WHERE id = ?").run(bcrypt.hashSync(newPass, 10), req.user.id);
    res.json({ message: "Password changed" });
  } catch (e) {
    next(e);
  }
});

app.delete("/api/account", auth, (req, res, next) => {
  try {
    const id = req.user.id;
    const tables = ["meals", "water_log", "progress", "workouts", "diet_plans", "settings", "profile", "users"];
    const tx = db.transaction(() => {
      for (const t of tables) {
        const col = t === "users" ? "id" : "user_id";
        db.prepare(`DELETE FROM ${t} WHERE ${col} = ?`).run(id);
      }
    });
    tx();
    res.json({ message: "Account deleted" });
  } catch (e) {
    next(e);
  }
});

/* ========================================================================== */
/*  CALCULATOR ROUTES (BMI / Calories / Protein / Water)                      */
/* ========================================================================== */

app.post("/api/calculate", auth, (req, res, next) => {
  try {
    const { age, gender, height, weight, goal, activity } = req.body || {};
    const p = { age, gender, height, weight, goal, activity };
    const bmi = calcBMI(weight, height);
    res.json({
      bmi,
      bmiCategory: bmiCategory(bmi),
      calorieGoal: calcCalorieGoal(p),
      proteinGoal: calcProtein(p),
      waterGoal: calcWater(p)
    });
  } catch (e) {
    next(e);
  }
});

/* ========================================================================== */
/*  DASHBOARD ROUTE                                                            */
/* ========================================================================== */

app.get("/api/dashboard", auth, (req, res, next) => {
  try {
    const id = req.user.id;
    const p = db.prepare("SELECT * FROM profile WHERE user_id = ?").get(id) || {};
    const goal = calcCalorieGoal(p);

    const consumed = db.prepare("SELECT COALESCE(SUM(calories),0) c FROM meals WHERE user_id = ? AND date = ?")
      .get(id, today()).c;
    const burned = db.prepare("SELECT COALESCE(SUM(calories),0) c FROM workouts WHERE user_id = ? AND date = ?")
      .get(id, today()).c;
    const waterRow = db.prepare("SELECT glasses FROM water_log WHERE user_id = ? AND date = ?").get(id, today());
    const water = waterRow ? waterRow.glasses : 0;

    /* Weekly chart data (last 7 days). */
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      const cb = db.prepare("SELECT COALESCE(SUM(calories),0) c FROM workouts WHERE user_id = ? AND date = ?").get(id, ds).c;
      const cc = db.prepare("SELECT COALESCE(SUM(calories),0) c FROM meals WHERE user_id = ? AND date = ?").get(id, ds).c;
      week.push({ date: ds.slice(5), burned: Math.round(cb), consumed: Math.round(cc) });
    }

    /* Current streak (consecutive days with a workout up to today). */
    const dates = db.prepare("SELECT DISTINCT date FROM workouts WHERE user_id = ? ORDER BY date DESC")
      .all(id).map((r) => r.date);
    let streak = 0;
    const cur = new Date();
    for (const ds of dates) {
      if (ds === cur.toISOString().slice(0, 10)) { streak++; cur.setDate(cur.getDate() - 1); }
      else break;
    }

    /* Weekly statistics summary. */
    const weeklyWorkouts = week.reduce((s, d) => s + (d.burned > 0 ? 1 : 0), 0);
    const weeklyBurned = week.reduce((s, d) => s + d.burned, 0);

    res.json({
      username: req.user.username,
      bmi: calcBMI(p.weight, p.height),
      bmiCategory: bmiCategory(calcBMI(p.weight, p.height)),
      calorieGoal: goal,
      consumed: Math.round(consumed),
      burned: Math.round(burned),
      remaining: Math.round(goal - consumed + burned),
      proteinGoal: calcProtein(p),
      waterGoal: calcWater(p),
      water,
      streak,
      week,
      weeklyWorkouts,
      weeklyBurned,
      goalPct: Math.min(100, Math.round((consumed / goal) * 100)) || 0,
      setupDone: !!p.setup_done
    });
  } catch (e) {
    next(e);
  }
});

/* ========================================================================== */
/*  WATER ROUTES                                                               */
/* ========================================================================== */

app.get("/api/water", auth, (req, res, next) => {
  try {
    const row = db.prepare("SELECT glasses FROM water_log WHERE user_id = ? AND date = ?").get(req.user.id, today());
    res.json({ glasses: row ? row.glasses : 0 });
  } catch (e) {
    next(e);
  }
});

app.post("/api/water", auth, (req, res, next) => {
  try {
    const delta = Number(req.body && req.body.delta) || 1;
    const row = db.prepare("SELECT id, glasses FROM water_log WHERE user_id = ? AND date = ?").get(req.user.id, today());
    if (row) {
      const glasses = Math.max(0, row.glasses + delta);
      db.prepare("UPDATE water_log SET glasses = ? WHERE id = ?").run(glasses, row.id);
      return res.json({ glasses });
    }
    const glasses = Math.max(0, delta);
    db.prepare("INSERT INTO water_log (user_id, date, glasses) VALUES (?,?,?)").run(req.user.id, today(), glasses);
    res.json({ glasses });
  } catch (e) {
    next(e);
  }
});

/* ========================================================================== */
/*  EXERCISE LIBRARY ROUTES                                                    */
/* ========================================================================== */

app.get("/api/exercises", auth, (req, res, next) => {
  try {
    const { search = "", category = "" } = req.query || {};
    let list = EXERCISE_LIBRARY;
    if (category && category !== "All") list = list.filter((e) => e.category === category);
    if (search) {
      const q = String(search).toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(q) || e.category.toLowerCase().includes(q));
    }
    const categories = ["All", ...Array.from(new Set(EXERCISE_LIBRARY.map((e) => e.category)))];
    res.json({ categories, exercises: list });
  } catch (e) {
    next(e);
  }
});

/* ========================================================================== */
/*  WORKOUT ROUTES                                                             */
/* ========================================================================== */

app.post("/api/workout/generate", auth, (req, res, next) => {
  try {
    const { level = "Beginner", goal = "Muscle Gain" } = req.body || {};
    const p = db.prepare("SELECT weight FROM profile WHERE user_id = ?").get(req.user.id) || {};
    const weight = p.weight || 70;
    const setMap = { Beginner: [3, "10-12"], Intermediate: [4, "8-10"], Advanced: [5, "6-8"] };
    const [sets, reps] = setMap[level] || setMap.Beginner;

    const names = GOAL_EXERCISES[goal] || GOAL_EXERCISES["Muscle Gain"];
    const exercises = names.map((name) => {
      const met = MET[name] || 5;
      const calPerMin = (met * 3.5 * weight) / 200;
      const duration = 8; // minutes per exercise block
      return {
        name,
        sets,
        reps,
        rest: "60-90s",
        muscle: MUSCLE[name] || "General",
        difficulty: level,
        calories: Math.round(calPerMin * duration),
        instructions: `Perform ${sets} sets of ${reps} reps with controlled form. Rest 60-90s between sets.`
      };
    });
    res.json({ level, goal, exercises });
  } catch (e) {
    next(e);
  }
});

app.post("/api/workout/finish", auth, (req, res, next) => {
  try {
    const { duration = 0, calories = 0, exercises = 0 } = req.body || {};
    db.prepare("INSERT INTO workouts (user_id, date, duration, calories, exercises) VALUES (?,?,?,?,?)")
      .run(req.user.id, today(), Math.round(duration), Math.round(calories), Math.round(exercises));
    res.json({ message: "Workout saved", duration, calories, exercises });
  } catch (e) {
    next(e);
  }
});

app.get("/api/workout/history", auth, (req, res, next) => {
  try {
    const rows = db.prepare(
      "SELECT date, duration, calories, exercises FROM workouts WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT 30"
    ).all(req.user.id);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

/* ========================================================================== */
/*  DIET ROUTES                                                                */
/* ========================================================================== */

app.post("/api/diet/generate", auth, (req, res, next) => {
  try {
    const p = db.prepare("SELECT * FROM profile WHERE user_id = ?").get(req.user.id) || {};
    const goal = calcCalorieGoal(p);
    const split = { Breakfast: 0.25, Lunch: 0.35, Dinner: 0.30, Snacks: 0.10 };
    const foods = {
      Breakfast: "Oats, eggs, banana, milk",
      Lunch: "Grilled chicken, rice, salad",
      Dinner: "Fish/paneer, veggies, quinoa",
      Snacks: "Greek yogurt, nuts, fruit"
    };
    const meals = {};
    for (const [k, ratio] of Object.entries(split)) {
      const cal = Math.round(goal * ratio);
      meals[k] = {
        food: foods[k],
        calories: cal,
        protein: Math.round((cal * 0.30) / 4),
        carbs: Math.round((cal * 0.45) / 4),
        fat: Math.round((cal * 0.25) / 9)
      };
    }
    res.json({ calorieGoal: goal, proteinGoal: calcProtein(p), water: `${calcWater(p)} L`, meals });
  } catch (e) {
    next(e);
  }
});

/* ========================================================================== */
/*  MEAL / FOOD LOGGING ROUTES                                                 */
/* ========================================================================== */

app.get("/api/foods", auth, (req, res, next) => {
  try {
    const q = String((req.query && req.query.search) || "").toLowerCase();
    const list = q ? FOOD_DB.filter((f) => f.name.toLowerCase().includes(q)) : FOOD_DB;
    res.json(list);
  } catch (e) {
    next(e);
  }
});

app.get("/api/meals", auth, (req, res, next) => {
  try {
    const rows = db.prepare("SELECT * FROM meals WHERE user_id = ? AND date = ? ORDER BY id").all(req.user.id, today());
    const totals = rows.reduce(
      (t, m) => ({
        calories: t.calories + (m.calories || 0),
        protein: t.protein + (m.protein || 0),
        carbs: t.carbs + (m.carbs || 0),
        fat: t.fat + (m.fat || 0)
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );
    res.json({ meals: rows, totals });
  } catch (e) {
    next(e);
  }
});

app.post("/api/meals", auth, (req, res, next) => {
  try {
    const { type = "Snacks", name, calories = 0, protein = 0, carbs = 0, fat = 0 } = req.body || {};
    if (!name) return res.status(400).json({ error: "Food name required" });
    const info = db.prepare(
      "INSERT INTO meals (user_id, date, type, name, calories, protein, carbs, fat) VALUES (?,?,?,?,?,?,?,?)"
    ).run(req.user.id, today(), type, name, calories, protein, carbs, fat);
    res.status(201).json({ id: info.lastInsertRowid, message: "Meal added" });
  } catch (e) {
    next(e);
  }
});

app.delete("/api/meals/:id", auth, (req, res, next) => {
  try {
    db.prepare("DELETE FROM meals WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
    res.json({ message: "Meal deleted" });
  } catch (e) {
    next(e);
  }
});

/* ========================================================================== */
/*  PROGRESS ROUTE                                                             */
/* ========================================================================== */

app.get("/api/progress", auth, (req, res, next) => {
  try {
    const rows = db.prepare(
      "SELECT date, weight, bmi, calories FROM progress WHERE user_id = ? ORDER BY date"
    ).all(req.user.id);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

/* ========================================================================== */
/*  SETTINGS ROUTES                                                            */
/* ========================================================================== */

app.get("/api/settings", auth, (req, res, next) => {
  try {
    const s = db.prepare("SELECT theme, water_reminder, workout_reminder FROM settings WHERE user_id = ?")
      .get(req.user.id) || { theme: "dark", water_reminder: 1, workout_reminder: 1 };
    res.json(s);
  } catch (e) {
    next(e);
  }
});

app.put("/api/settings", auth, (req, res, next) => {
  try {
    const cur = db.prepare("SELECT theme, water_reminder, workout_reminder FROM settings WHERE user_id = ?")
      .get(req.user.id) || { theme: "dark", water_reminder: 1, workout_reminder: 1 };
    const theme = req.body && req.body.theme !== undefined ? req.body.theme : cur.theme;
    const water = req.body && req.body.water_reminder !== undefined ? (req.body.water_reminder ? 1 : 0) : cur.water_reminder;
    const workout = req.body && req.body.workout_reminder !== undefined ? (req.body.workout_reminder ? 1 : 0) : cur.workout_reminder;
    db.prepare("UPDATE settings SET theme = ?, water_reminder = ?, workout_reminder = ? WHERE user_id = ?")
      .run(theme, water, workout, req.user.id);
    res.json({ message: "Settings saved", theme, water_reminder: water, workout_reminder: workout });
  } catch (e) {
    next(e);
  }
});

/* ========================================================================== */
/*  AI FITNESS CHATBOT (offline fallback when no API key is configured)       */
/* ========================================================================== */

/** Rule-based offline coach. Returns helpful canned guidance by keyword. */
function offlineChatReply(message, profile) {
  const m = String(message || "").toLowerCase();
  const goal = (profile && profile.goal) || "your goal";

  if (/\b(hi|hello|hey)\b/.test(m))
    return "Hey! I'm your FitHub AI coach. Ask me about workouts, diet, protein, water, or weight loss.";
  if (m.includes("protein"))
    return "Aim for 1.6–2.2g of protein per kg of bodyweight daily. Spread it across meals: eggs, chicken, fish, paneer, Greek yogurt, and whey are great sources.";
  if (m.includes("water") || m.includes("hydrat"))
    return "Drink roughly 30–35 ml of water per kg of bodyweight. Increase it on training days. Keep a bottle nearby and sip regularly.";
  if (m.includes("lose") || m.includes("fat") || m.includes("weight loss"))
    return "Fat loss needs a calorie deficit of ~300–500 kcal/day, high protein, strength training 3–4x/week, and daily steps. Stay consistent and prioritize sleep.";
  if (m.includes("muscle") || m.includes("gain") || m.includes("bulk"))
    return "For muscle gain: eat a slight calorie surplus, hit ~2g protein/kg, train each muscle 2x/week with progressive overload, and rest well.";
  if (m.includes("workout") || m.includes("exercise") || m.includes("routine"))
    return "A solid plan: 3–5 sessions/week mixing compound lifts (squat, deadlift, bench, rows) with some cardio. Use the Workout Planner to generate one for " + goal + ".";
  if (m.includes("diet") || m.includes("meal") || m.includes("eat"))
    return "Build meals around lean protein, complex carbs, healthy fats, and veggies. Use the Diet Planner for a calorie-matched plan, and log foods in the Calorie Tracker.";
  if (m.includes("bmi"))
    return "BMI = weight(kg) / height(m)². Normal is 18.5–24.9. It's a rough guide and doesn't account for muscle mass, so pair it with progress photos and measurements.";
  if (m.includes("rest") || m.includes("sleep") || m.includes("recover"))
    return "Recovery is where progress happens. Aim for 7–9 hours of sleep, take 1–2 rest days/week, and manage stress. Muscles grow when you rest, not just when you train.";
  if (m.includes("motivat") || m.includes("tired") || m.includes("lazy"))
    return "Discipline beats motivation. Start small, show up daily, and track wins. Even a 15-minute session counts. You've got this! 💪";

  return "Great question! Focus on consistency: train regularly, eat enough protein, stay hydrated, and sleep well. Try the Workout Planner and Diet Planner for a tailored plan toward " + goal + ".";
}

app.post("/api/chat", auth, async (req, res, next) => {
  try {
    const message = (req.body && req.body.message) || "";
    if (!message.trim()) return res.status(400).json({ error: "Message is required" });

    const profile = db.prepare("SELECT goal, weight, height, age FROM profile WHERE user_id = ?").get(req.user.id) || {};

    // Offline mode (default): no external API key configured.
    if (!AI_API_KEY) {
      return res.json({ reply: offlineChatReply(message, profile), mode: "offline" });
    }

    /*
     * Online mode placeholder: if an API key is configured, integrate your
     * preferred provider here. The structure is kept simple and safe; any
     * failure gracefully falls back to the offline coach so the chatbot
     * never returns an error to the user.
     */
    try {
      // Intentionally minimal: real provider integration goes here.
      // Falling through to offline guarantees a useful reply regardless.
      return res.json({ reply: offlineChatReply(message, profile), mode: "offline-fallback" });
    } catch (apiErr) {
      console.error("[CHAT] provider error:", apiErr.message);
      return res.json({ reply: offlineChatReply(message, profile), mode: "offline-fallback" });
    }
  } catch (e) {
    next(e);
  }
});

/* ========================================================================== */
/*  STATIC / SPA FALLBACK                                                      */
/* ========================================================================== */

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

/* SPA view routes (serve index.html for SEO-friendly URLs listed in sitemap) */
const spaViews = ["dashboard", "calculators", "workout", "exercises", "diet", "tracker", "progress", "chat", "profile", "settings", "about"];
spaViews.forEach((view) => {
  app.get("/" + view, (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
});

/* ========================================================================== */
/*  404 + GLOBAL ERROR HANDLERS                                                */
/* ========================================================================== */

app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Route not found" });
  res.status(404).sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
  console.error("[ERROR]", err && err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal server error" });
});

/* ========================================================================== */
/*  PROCESS SAFETY + STARTUP                                                   */
/* ========================================================================== */

process.on("uncaughtException", (e) => console.error("[FATAL]", e && e.message));
process.on("unhandledRejection", (e) => console.error("[REJECTION]", e));

/* Ensure the public directory exists so static serving never throws ENOENT. */
try {
  const pub = path.join(__dirname, "public");
  if (!fs.existsSync(pub)) fs.mkdirSync(pub, { recursive: true });
} catch (e) {
  console.warn("[STARTUP] Could not verify public directory:", e.message);
}

app.listen(PORT, () => console.log(`FitHub AI running at http://localhost:${PORT}`));
