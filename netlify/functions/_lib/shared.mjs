import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

const EMPLOYEE_CSV_URL = process.env.EMPLOYEE_CSV_URL || "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ02RkbPel636t5as9voi7c0E_6QYI32l2hAiDv5QDFIohIHyZUqAOnrgvgkUi2va7D0VZJrdPoI75r/pub?gid=1157712149&single=true&output=csv";
const ADMIN_EMAIL = normalizeEmail(process.env.ADMIN_EMAIL || "admin@ags.local");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMeAdmin123!";
const CACHE_TTL_MS = 5 * 60 * 1000;
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
const DASHBOARD_HISTORY_DAYS = Number(process.env.DASHBOARD_HISTORY_DAYS || 2);
const RECENT_END_LIMIT = Number(process.env.RECENT_END_LIMIT || 20);

export const BREAK_TYPES = {
  "15m": { allowedMinutes: 15, breakLabel: "15-Minute Break" },
  "60m": { allowedMinutes: 60, breakLabel: "1-Hour Break" }
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function parseBody(request) {
  try {
    return await request.json();
  } catch (_) {
    return {};
  }
}

export async function getEmployees() {
  const cacheStore = getStore("employee-cache");
  const cached = await cacheStore.get("employees", { type: "json", consistency: "strong" });
  const freshEnough = cached && Date.now() - new Date(cached.updatedAt).getTime() < CACHE_TTL_MS;
  if (freshEnough) return cached.employees;

  try {
    const response = await fetch(EMPLOYEE_CSV_URL);
    if (!response.ok) throw new Error(`Employee sheet request failed with ${response.status}`);
    const text = await response.text();
    const employees = parseEmployeeCsv(text);
    await cacheStore.setJSON("employees", { updatedAt: new Date().toISOString(), employees });
    return employees;
  } catch (error) {
    if (cached?.employees?.length) return cached.employees;
    throw error;
  }
}

export function getAdminUser() {
  return {
    id: "ADMIN",
    name: "AGS Admin",
    email: ADMIN_EMAIL,
    department: "Administration",
    tlEmail: "-",
    tlName: "-",
    role: "admin"
  };
}

export function findUserByEmail(employees, email) {
  const normalized = normalizeEmail(email);
  if (normalized === ADMIN_EMAIL) return getAdminUser();
  const employeeRow = employees.find((employee) => employee.agentEmail === normalized) || null;
  const tlEmails = new Set(employees.map((employee) => employee.tlEmail).filter(Boolean));
  const isTl = tlEmails.has(normalized);

  if (employeeRow) {
    return {
      id: employeeRow.id,
      name: employeeRow.name,
      email: employeeRow.agentEmail,
      department: employeeRow.department,
      tlEmail: employeeRow.tlEmail,
      tlName: lookupTlName(employees, employeeRow.tlEmail),
      role: isTl ? "tl" : "agent",
      password: employeeRow.password || ""
    };
  }

  if (!isTl) return null;
  return null;
}

export async function createSession(user, remember) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + (remember ? SESSION_DAYS * 24 : SESSION_HOURS) * 60 * 60 * 1000).toISOString();
  await getStore("sessions").setJSON(token, { token, email: user.email, remember, expiresAt });
  return { token, expiresAt };
}

export async function deleteSession(token) {
  if (!token) return;
  await getStore("sessions").delete(token);
}

export async function assertTrustedDevice(userEmail, deviceId) {
  const normalizedEmail = normalizeEmail(userEmail);
  if (normalizedEmail === ADMIN_EMAIL) return;
  const normalizedDeviceId = String(deviceId || "").trim();
  if (!normalizedDeviceId) throw new Error("Missing device information.");

  const store = getStore("trusted-devices");
  const existing = await store.get(normalizedEmail, { type: "json", consistency: "strong" });
  if (existing && existing.deviceId !== normalizedDeviceId) {
    throw new Error("This account is already linked to another device.");
  }

  if (!existing) {
    await store.setJSON(normalizedEmail, {
      email: normalizedEmail,
      deviceId: normalizedDeviceId,
      assignedAt: new Date().toISOString()
    }, {
      metadata: {
        deviceId: normalizedDeviceId,
        assignedAt: new Date().toISOString()
      }
    });
    return;
  }

  await store.setJSON(normalizedEmail, {
    ...existing,
    lastSeenAt: new Date().toISOString()
  }, {
    metadata: {
      deviceId: existing.deviceId,
      assignedAt: existing.assignedAt || "",
      lastSeenAt: new Date().toISOString()
    }
  });
}

export async function requireUser(request) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) throw new Error("Unauthorized");

  const session = await getStore("sessions").get(token, { type: "json", consistency: "strong" });
  if (!session) throw new Error("Unauthorized");
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await deleteSession(token);
    throw new Error("Session expired");
  }

  const employees = await getEmployees();
  const user = findUserByEmail(employees, session.email);
  if (!user) throw new Error("User not found");
  return { token, user, employees };
}

export async function buildDashboard(user) {
  const activeStore = getStore("active-breaks");
  const historyStore = getStore("break-history");
  const historyRecords = await listHistory(historyStore);
  const recentHistory = filterHistoryByDays(historyRecords, DASHBOARD_HISTORY_DAYS);

  if (user.role === "admin") {
    return {
      activeBreak: null,
      myHistory: [],
      myHistoryCount: 0,
      myOverbreakCount: 0,
      teamLive: [],
      teamHistory: [],
      teamOverbreaks: [],
      teamOverbreakCount: 0,
      adminActiveBreaks: await listActive(activeStore),
      adminHistory: recentHistory.slice(0, 200),
      trustedDevices: await listTrustedDevices()
    };
  }

  const activeBreak = await activeStore.get(user.email, { type: "json", consistency: "strong" });
  const myRecords = historyRecords.filter((record) => record.employeeEmail === user.email);
  const myHistory = filterHistoryByDays(myRecords, DASHBOARD_HISTORY_DAYS).slice(0, 25);
  const myHistoryCount = myRecords.length;
  const myOverbreakCount = myRecords.filter((record) => record.overMinutes > 0).length;

  let teamLive = [];
  let teamHistory = [];
  let teamOverbreaks = [];
  if (user.role === "tl") {
    teamLive = (await listActive(activeStore)).filter((entry) => entry.tlEmail === user.email).sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    teamHistory = filterHistoryByDays(historyRecords.filter((record) => record.tlEmail === user.email), DASHBOARD_HISTORY_DAYS).slice(0, 50);
    teamOverbreaks = filterHistoryByDays(historyRecords.filter((record) => record.tlEmail === user.email && record.overMinutes > 0), DASHBOARD_HISTORY_DAYS).slice(0, 30);
  }

  return { activeBreak, myHistory, myHistoryCount, myOverbreakCount, teamLive, teamHistory, teamOverbreaks, teamOverbreakCount: teamOverbreaks.length };
}

export async function buildLiveDashboard(user) {
  return buildDashboard(user);
}

export async function getHistoryForUser(user, options = {}) {
  const scope = String(options.scope || "").trim().toLowerCase();
  const rows = await listHistory(getStore("break-history"));

  if (scope === "admin") {
    if (user.role !== "admin") throw new Error("Forbidden.");
    return applyHistoryFilters(rows, options);
  }

  if (scope === "team") {
    if (user.role !== "tl") throw new Error("Forbidden.");
    return applyHistoryFilters(rows.filter((row) => row.tlEmail === user.email), options);
  }

  throw new Error("Invalid history scope.");
}

export async function startBreakForUser(user, type) {
  const activeStore = getStore("active-breaks");
  const existing = await activeStore.get(user.email, { type: "json", consistency: "strong" });
  if (existing) throw new Error("You already have an active break.");

  const config = BREAK_TYPES[type];
  if (!config) throw new Error("Invalid break type.");

  const startedAt = new Date().toISOString();
  const record = {
    breakId: crypto.randomUUID(),
    type,
    breakLabel: config.breakLabel,
    allowedMinutes: config.allowedMinutes,
    startedAt,
    expectedEndAt: new Date(Date.now() + config.allowedMinutes * 60 * 1000).toISOString(),
    employeeId: user.id,
    employeeName: user.name,
    employeeEmail: user.email,
    department: user.department,
    tlEmail: user.tlEmail || user.email
  };

  await activeStore.setJSON(user.email, record, {
    metadata: {
      breakId: record.breakId,
      employeeEmail: record.employeeEmail,
      tlEmail: record.tlEmail,
      startedAt: record.startedAt,
      allowedMinutes: record.allowedMinutes,
      breakLabel: record.breakLabel,
      employeeName: record.employeeName,
      department: record.department
    }
  });

  return record;
}

export async function endBreakForUser(user) {
  const activeStore = getStore("active-breaks");
  const historyStore = getStore("break-history");
  const activeBreak = await activeStore.get(user.email, { type: "json", consistency: "strong" });
  if (!activeBreak) throw new Error("No active break found.");

  const endedAt = new Date().toISOString();
  const durationSeconds = Math.max(1, Math.floor((new Date(endedAt).getTime() - new Date(activeBreak.startedAt).getTime()) / 1000));
  const durationMinutes = Math.max(1, Math.floor(durationSeconds / 60));
  const overMinutes = Math.max(0, durationMinutes - activeBreak.allowedMinutes);
  const historyRecord = { ...activeBreak, endedAt, durationMinutes, durationSeconds, overMinutes };

  await historyStore.setJSON(`${endedAt}_${activeBreak.breakId}`, historyRecord, {
    metadata: {
      breakId: historyRecord.breakId,
      employeeEmail: historyRecord.employeeEmail,
      employeeName: historyRecord.employeeName,
      tlEmail: historyRecord.tlEmail,
      breakLabel: historyRecord.breakLabel,
      startedAt: historyRecord.startedAt,
      endedAt: historyRecord.endedAt,
      durationMinutes: historyRecord.durationMinutes,
      durationSeconds: historyRecord.durationSeconds,
      overMinutes: historyRecord.overMinutes
    }
  });

  await activeStore.delete(user.email);
  return historyRecord;
}

export function assertLoginPassword(user, password) {
  if (!user) throw new Error("Invalid email or password.");
  if (user.role === "admin") {
    if (password !== ADMIN_PASSWORD) throw new Error("Invalid email or password.");
    return;
  }

  if (String(user.password || "") !== String(password || "")) {
    throw new Error("Invalid email or password.");
  }
}

export function assertAdminLoginPassword(email, password) {
  const normalized = normalizeEmail(email);
  if (normalized === ADMIN_EMAIL) {
    if (password !== ADMIN_PASSWORD) throw new Error("Invalid email or password.");
    return;
  }
  throw new Error("Invalid email or password.");
}

export async function resetTrustedDevice(targetEmail) {
  const normalizedEmail = normalizeEmail(targetEmail);
  if (!normalizedEmail || normalizedEmail === ADMIN_EMAIL) throw new Error("Invalid employee email.");
  await getStore("trusted-devices").delete(normalizedEmail);
  return { email: normalizedEmail };
}

function parseEmployeeCsv(text) {
  return parseCsv(text).slice(1).map((row) => ({
    id: (row[0] || "").trim(),
    name: (row[1] || "").trim(),
    department: (row[2] || "").trim(),
    agentEmail: normalizeEmail(row[3] || ""),
    tlEmail: normalizeEmail(row[4] || ""),
    password: String(row[5] || "").trim()
  })).filter((row) => row.agentEmail);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (const char of String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n")) {
    if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if (char === "\n" && !quoted) { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((entry) => entry.some((value) => String(value || "").trim() !== ""));
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function lookupTlName(employees, tlEmail) {
  const normalized = normalizeEmail(tlEmail);
  if (!normalized) return "-";
  const match = employees.find((employee) => employee.agentEmail === normalized);
  if (match?.name) return match.name;
  return normalized.split("@")[0].split(/[._-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

async function listActive(store) {
  const entries = await store.list();
  const rows = await Promise.all((entries.blobs || []).map(async (item) => {
    if (item.metadata?.employeeEmail && item.metadata?.startedAt) {
      return {
        breakId: item.metadata?.breakId || item.key,
        employeeEmail: item.metadata?.employeeEmail || item.key,
        employeeName: item.metadata?.employeeName || item.key,
        tlEmail: item.metadata?.tlEmail || "",
        startedAt: item.metadata?.startedAt || "",
        allowedMinutes: Number(item.metadata?.allowedMinutes || 0),
        breakLabel: item.metadata?.breakLabel || "Break",
        department: item.metadata?.department || ""
      };
    }

    const record = await store.get(item.key, { type: "json", consistency: "strong" });
    if (record?.employeeEmail && record?.startedAt) {
      await setBlobMetadata(store, item.key, record, {
        breakId: record.breakId,
        employeeEmail: record.employeeEmail,
        employeeName: record.employeeName,
        tlEmail: record.tlEmail,
        startedAt: record.startedAt,
        allowedMinutes: record.allowedMinutes,
        breakLabel: record.breakLabel,
        department: record.department
      });
    }
    return {
      breakId: record?.breakId || item.key,
      employeeEmail: record?.employeeEmail || item.key,
      employeeName: record?.employeeName || item.key,
      tlEmail: record?.tlEmail || "",
      startedAt: record?.startedAt || "",
      allowedMinutes: Number(record?.allowedMinutes || 0),
      breakLabel: record?.breakLabel || "Break",
      department: record?.department || ""
    };
  }));
  return rows.filter((row) => row.employeeEmail && row.startedAt);
}

async function listHistory(store) {
  const entries = await store.list();
  const rows = await Promise.all((entries.blobs || []).map(async (item) => {
    if (item.metadata?.employeeEmail && item.metadata?.startedAt && item.metadata?.endedAt) {
      return {
        breakId: item.metadata?.breakId || item.key,
        employeeEmail: item.metadata?.employeeEmail || "",
        employeeName: item.metadata?.employeeName || "",
        tlEmail: item.metadata?.tlEmail || "",
        breakLabel: item.metadata?.breakLabel || "Break",
        startedAt: item.metadata?.startedAt || "",
        endedAt: item.metadata?.endedAt || "",
        durationMinutes: Number(item.metadata?.durationMinutes || 0),
        durationSeconds: Number(item.metadata?.durationSeconds || 0),
        overMinutes: Number(item.metadata?.overMinutes || 0)
      };
    }

    const record = await store.get(item.key, { type: "json", consistency: "strong" });
    if (record?.employeeEmail && record?.startedAt && record?.endedAt) {
      await setBlobMetadata(store, item.key, record, {
        breakId: record.breakId,
        employeeEmail: record.employeeEmail,
        employeeName: record.employeeName,
        tlEmail: record.tlEmail,
        breakLabel: record.breakLabel,
        startedAt: record.startedAt,
        endedAt: record.endedAt,
        durationMinutes: record.durationMinutes,
        durationSeconds: record.durationSeconds,
        overMinutes: record.overMinutes
      });
    }
    return {
      breakId: record?.breakId || item.key,
      employeeEmail: record?.employeeEmail || "",
      employeeName: record?.employeeName || "",
      tlEmail: record?.tlEmail || "",
      breakLabel: record?.breakLabel || "Break",
      startedAt: record?.startedAt || "",
      endedAt: record?.endedAt || "",
      durationMinutes: Number(record?.durationMinutes || 0),
      durationSeconds: Number(record?.durationSeconds || 0),
      overMinutes: Number(record?.overMinutes || 0)
    };
  }));
  return rows
    .filter((row) => row.employeeEmail && row.startedAt && row.endedAt)
    .sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime());
}

function filterHistoryByDays(rows, days) {
  const safeDays = Number(days || 0);
  if (safeDays <= 0) return rows;
  const cutoff = Date.now() - safeDays * 24 * 60 * 60 * 1000;
  return rows.filter((row) => new Date(row.startedAt).getTime() >= cutoff);
}

function applyHistoryFilters(rows, options = {}) {
  const from = String(options.from || "").trim();
  const to = String(options.to || "").trim();
  const search = String(options.search || "").trim().toLowerCase();

  return rows.filter((row) => {
    if (search && !String(row.employeeName || "").toLowerCase().includes(search)) return false;
    if (!matchesDateRange(row.startedAt, from, to)) return false;
    return true;
  });
}

function matchesDateRange(value, from, to) {
  const date = toLocalDateKey(value);
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function toLocalDateKey(value) {
  if (!value) return "";
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function setBlobMetadata(store, key, record, metadata) {
  try {
    await store.setJSON(key, record, { metadata });
  } catch (_) {
  }
}

async function listTrustedDevices() {
  const entries = await getStore("trusted-devices").list();
  const rows = await Promise.all((entries.blobs || []).map(async (item) => {
    const record = await getStore("trusted-devices").get(item.key, { type: "json", consistency: "strong" });
    return {
      email: item.key,
      deviceId: record?.deviceId || item.metadata?.deviceId || "",
      assignedAt: record?.assignedAt || item.metadata?.assignedAt || "",
      lastSeenAt: record?.lastSeenAt || item.metadata?.lastSeenAt || ""
    };
  }));
  return rows.sort((a, b) => a.email.localeCompare(b.email));
}

async function getUserStats(email) {
  return (await getStore("user-stats").get(normalizeEmail(email), { type: "json", consistency: "strong" })) || { totalBreaks: 0, overbreaks: 0 };
}

async function saveUserStats(email, totalBreaks, overbreaks) {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  await getStore("user-stats").setJSON(normalized, {
    email: normalized,
    totalBreaks: Number(totalBreaks || 0),
    overbreaks: Number(overbreaks || 0)
  });
}

async function getTlStats(email) {
  return (await getStore("tl-stats").get(normalizeEmail(email), { type: "json", consistency: "strong" })) || { teamOverbreaks: 0 };
}

async function saveTlStats(email, teamOverbreaks) {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  await getStore("tl-stats").setJSON(normalized, {
    email: normalized,
    teamOverbreaks: Number(teamOverbreaks || 0)
  });
}

async function updateStatsAfterBreak(historyRecord) {
  const userEmail = normalizeEmail(historyRecord.employeeEmail);
  if (userEmail) {
    const current = await getUserStats(userEmail);
    await saveUserStats(
      userEmail,
      Number(current.totalBreaks || 0) + 1,
      Number(current.overbreaks || 0) + (historyRecord.overMinutes > 0 ? 1 : 0)
    );
  }

  const tlEmail = normalizeEmail(historyRecord.tlEmail);
  if (tlEmail) {
    const currentTl = await getTlStats(tlEmail);
    await saveTlStats(
      tlEmail,
      Number(currentTl.teamOverbreaks || 0) + (historyRecord.overMinutes > 0 ? 1 : 0)
    );
  }
}

async function pushRecentBreakEnd(historyRecord) {
  const compactRecord = {
    breakId: historyRecord.breakId,
    employeeEmail: historyRecord.employeeEmail,
    employeeName: historyRecord.employeeName,
    tlEmail: historyRecord.tlEmail,
    breakLabel: historyRecord.breakLabel,
    startedAt: historyRecord.startedAt,
    endedAt: historyRecord.endedAt,
    durationMinutes: historyRecord.durationMinutes,
    durationSeconds: historyRecord.durationSeconds,
    overMinutes: historyRecord.overMinutes
  };

  await Promise.all([
    appendRecentEvent("recent-break-ends", "company", compactRecord),
    appendRecentEvent("tl-recent-ends", normalizeEmail(historyRecord.tlEmail), compactRecord)
  ]);
}

async function getRecentCompanyEnds() {
  return getRecentEvents("recent-break-ends", "company");
}

async function getRecentTlEnds(tlEmail) {
  return getRecentEvents("tl-recent-ends", normalizeEmail(tlEmail));
}

async function getRecentEvents(storeName, key) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return [];
  const record = await getStore(storeName).get(normalizedKey, { type: "json", consistency: "strong" });
  return Array.isArray(record?.rows) ? record.rows : [];
}

async function appendRecentEvent(storeName, key, row) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return;
  const store = getStore(storeName);
  const existing = await store.get(normalizedKey, { type: "json", consistency: "strong" });
  const currentRows = Array.isArray(existing?.rows) ? existing.rows : [];
  const rows = [row, ...currentRows.filter((item) => item.breakId !== row.breakId)]
    .sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime())
    .slice(0, RECENT_END_LIMIT);
  await store.setJSON(normalizedKey, { rows });
}

async function getCompanyActiveBreaks(activeStore) {
  const cachedRows = await getIndexedRows("company-active-breaks", "company");
  if (cachedRows) return sortActiveRows(cachedRows);

  const rows = await listActive(activeStore);
  await setIndexedRows("company-active-breaks", "company", rows);
  return sortActiveRows(rows);
}

async function getTlActiveBreaks(tlEmail, activeStore) {
  const key = normalizeEmail(tlEmail);
  const cachedRows = await getIndexedRows("tl-active-breaks", key);
  if (cachedRows) return sortActiveRows(cachedRows);

  const companyRows = await getCompanyActiveBreaks(activeStore);
  const rows = companyRows.filter((entry) => entry.tlEmail === key);
  await setIndexedRows("tl-active-breaks", key, rows);
  return sortActiveRows(rows);
}

async function addCompanyActiveBreak(row) {
  await appendIndexedRow("company-active-breaks", "company", row);
}

async function removeCompanyActiveBreak(breakId) {
  await removeIndexedRow("company-active-breaks", "company", breakId);
}

async function addTlActiveBreak(tlEmail, row) {
  const key = normalizeEmail(tlEmail);
  if (!key) return;
  await appendIndexedRow("tl-active-breaks", key, row);
}

async function removeTlActiveBreak(tlEmail, breakId) {
  const key = normalizeEmail(tlEmail);
  if (!key) return;
  await removeIndexedRow("tl-active-breaks", key, breakId);
}

async function getIndexedRows(storeName, key) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return null;
  const record = await getStore(storeName).get(normalizedKey, { type: "json", consistency: "strong" });
  if (!record) return null;
  return Array.isArray(record.rows) ? record.rows : [];
}

async function setIndexedRows(storeName, key, rows) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return;
  await getStore(storeName).setJSON(normalizedKey, { rows: Array.isArray(rows) ? rows : [] });
}

async function appendIndexedRow(storeName, key, row) {
  const rows = (await getIndexedRows(storeName, key)) || [];
  const nextRows = [row, ...rows.filter((item) => item.breakId !== row.breakId)];
  await setIndexedRows(storeName, key, sortActiveRows(nextRows));
}

async function removeIndexedRow(storeName, key, breakId) {
  const rows = (await getIndexedRows(storeName, key)) || [];
  await setIndexedRows(storeName, key, rows.filter((item) => item.breakId !== breakId));
}

function sortActiveRows(rows) {
  return [...rows].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
}
