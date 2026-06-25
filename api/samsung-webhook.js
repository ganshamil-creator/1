// api/samsung-webhook.js
//
// Принимает POST-запросы от HC Webhook (Android-приложение на телефоне),
// конвертирует формат Health Connect в формат, который понимает хаб
// (wr.steps / wr.heartRate / wr.sleep / wr.weight / wr.systolic / wr.diastolic),
// и сохраняет в тот же Firestore-документ, куда пишет сам хаб
// (users/{userId}/health/wearable, обёртка {__profiles, __allData}).
//
// ВАЖНО: этот файл нужно положить в папку api/ рядом с proxy.js.
// Требует пакет firebase-admin (добавить в package.json зависимостей проекта).

import admin from "firebase-admin";

// Инициализируем Firebase Admin один раз (переиспользуется между вызовами функции)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // В переменных окружения Vercel переносы строк private_key превращаются
      // в литеральные "\n" — возвращаем их обратно в настоящие переносы строк.
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

// Секретный токен для простой защиты вебхука — без него любой человек,
// узнавший URL, мог бы слать произвольные данные в твою базу.
const WEBHOOK_SECRET = process.env.SAMSUNG_WEBHOOK_SECRET;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") return res.status(200).json({ status: "ok", endpoint: "samsung-webhook" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Проверка секретного токена — передаётся как ?token=... в самом URL вебхука
  if (WEBHOOK_SECRET && req.query.token !== WEBHOOK_SECRET) {
    return res.status(403).json({ error: "Invalid or missing token" });
  }

  // Какому пользователю принадлежат эти данные — Firebase UID, передаётся
  // тоже через query (?uid=...), раз HC Webhook не умеет логиниться через Google.
  const userId = req.query.uid;
  if (!userId) {
    return res.status(400).json({ error: "Missing uid parameter" });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  try {
    const wearableDelta = convertHealthConnectPayload(body);

    const docRef = db.collection("users").doc(userId).collection("health").doc("wearable");
    const snap = await docRef.get();

    let allData = {};
    if (snap.exists) {
      const data = snap.data();
      if (data.__allData) {
        try { allData = JSON.parse(data.__allData); } catch (e) { allData = {}; }
      }
    }

    // Структура совпадает с window.allProfilesData в хабе: { me: {wearable: {...}, biomarkers: {...}, ...} }
    if (!allData.me) allData.me = { biomarkers: {}, wearable: {}, diary: {}, documents: [], lastUpdated: null };
    if (!allData.me.wearable) allData.me.wearable = {};

    let mergedCount = 0;
    Object.keys(wearableDelta).forEach((metricKey) => {
      if (!allData.me.wearable[metricKey]) allData.me.wearable[metricKey] = [];
      wearableDelta[metricKey].forEach((entry) => {
        // Один день = одна запись: заменяем существующую запись на эту же дату
        allData.me.wearable[metricKey] = allData.me.wearable[metricKey].filter((e) => e.date !== entry.date);
        allData.me.wearable[metricKey].push(entry);
        mergedCount++;
      });
      allData.me.wearable[metricKey].sort((a, b) => (a.date > b.date ? 1 : -1));
    });
    allData.me.lastUpdated = Date.now();

    // Сохраняем существующие __profiles нетронутыми (этот вебхук не трогает профили)
    const existingProfiles = snap.exists && snap.data().__profiles ? snap.data().__profiles : "{}";

    await docRef.set({
      __profiles: existingProfiles,
      __allData: JSON.stringify(allData),
      ts: Date.now(),
    });

    return res.status(200).json({ status: "ok", merged: mergedCount });
  } catch (e) {
    console.error("samsung-webhook error:", e);
    return res.status(500).json({ error: e.message || "Internal error" });
  }
}

// Конвертирует JSON от HC Webhook (Health Connect) в формат wearable хаба:
// { steps: [{date, value, unit}], heartRate: [...], sleep: [...], weight: [...], systolic: [...], diastolic: [...] }
function convertHealthConnectPayload(payload) {
  const result = {};

  // Шаги: HC Webhook отдаёт count за интервал [start_time, end_time) — берём дату начала интервала
  if (Array.isArray(payload.steps)) {
    result.steps = payload.steps.map((s) => ({
      date: isoDateOnly(s.start_time),
      value: s.count,
      unit: "шаг/день",
    })).filter((e) => e.date && typeof e.value === "number");
  }

  // Пульс: десятки точек в день — группируем по дате и берём среднее
  if (Array.isArray(payload.heart_rate)) {
    const byDate = {};
    payload.heart_rate.forEach((hr) => {
      const date = isoDateOnly(hr.time);
      if (!date || typeof hr.bpm !== "number") return;
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(hr.bpm);
    });
    result.heartRate = Object.keys(byDate).map((date) => ({
      date,
      value: Math.round(byDate[date].reduce((a, b) => a + b, 0) / byDate[date].length),
      unit: "уд/мин",
    }));
  }

  // Сон: HC Webhook обычно отдаёт сессии с duration в минутах — конвертируем в часы
  if (Array.isArray(payload.sleep)) {
    result.sleep = payload.sleep.map((s) => ({
      date: isoDateOnly(s.start_time),
      value: s.duration_minutes ? Math.round((s.duration_minutes / 60) * 10) / 10 : null,
      unit: "часов",
    })).filter((e) => e.date && e.value !== null);
  }

  // Вес
  if (Array.isArray(payload.weight)) {
    result.weight = payload.weight.map((w) => ({
      date: isoDateOnly(w.time),
      value: w.weight_kg || w.value,
      unit: "кг",
    })).filter((e) => e.date && typeof e.value === "number");
  }

  // Давление: систолическое и диастолическое раздельно
  if (Array.isArray(payload.blood_pressure)) {
    const systolic = [];
    const diastolic = [];
    payload.blood_pressure.forEach((bp) => {
      const date = isoDateOnly(bp.time);
      if (!date) return;
      if (typeof bp.systolic === "number") systolic.push({ date, value: bp.systolic, unit: "мм рт.ст." });
      if (typeof bp.diastolic === "number") diastolic.push({ date, value: bp.diastolic, unit: "мм рт.ст." });
    });
    if (systolic.length) result.systolic = systolic;
    if (diastolic.length) result.diastolic = diastolic;
  }

  return result;
}

// Извлекает дату YYYY-MM-DD из ISO-таймстампа Health Connect (например "2026-06-23T08:20:36.270Z")
function isoDateOnly(isoString) {
  if (!isoString || typeof isoString !== "string") return null;
  return isoString.slice(0, 10);
}
