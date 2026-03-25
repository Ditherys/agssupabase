import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { HISTORY_DAYS, SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase.config.js";

const POLL_MS = 15000;
const ACTIVE_BREAK_TYPES = {
  "15m": { allowedMinutes: 15, breakLabel: "15-Minute Break" },
  "60m": { allowedMinutes: 60, breakLabel: "1-Hour Break" }
};

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const state = {
  remember: false,
  profile: null,
  dashboard: null,
  pollTimer: null,
  clockTimer: null,
  audioContext: null,
  dismissedAgentAlert: "",
  dismissedTlAlert: "",
  teamHistoryFilter: "",
  teamHistoryFrom: "",
  teamHistoryTo: "",
  adminHistoryFrom: "",
  adminHistoryTo: "",
  adminDeviceSearch: "",
  teamHistoryDetailed: null,
  adminHistoryDetailed: null,
  teamHistoryDebounce: null,
  realtimeChannel: null
};

const els = {
  loginOverlay: document.getElementById("login-overlay"),
  loginForm: document.getElementById("login-form"),
  loginBtn: document.getElementById("login-btn"),
  email: document.getElementById("email"),
  password: document.getElementById("password"),
  remember: document.getElementById("remember"),
  loginError: document.getElementById("login-error"),
  notificationBtn: document.getElementById("notification-btn"),
  logoutBtn: document.getElementById("logout-btn"),
  syncLabel: document.getElementById("sync-label"),
  rolePill: document.getElementById("role-pill"),
  userName: document.getElementById("user-name"),
  userEmail: document.getElementById("user-email"),
  userDepartment: document.getElementById("user-department"),
  userTl: document.getElementById("user-tl"),
  currentStatusTag: document.getElementById("current-status-tag"),
  currentBreakCallout: document.getElementById("current-break-callout"),
  currentBreakType: document.getElementById("current-break-type"),
  currentBreakElapsed: document.getElementById("current-break-elapsed"),
  currentBreakReturn: document.getElementById("current-break-return"),
  agentAlert: document.getElementById("agent-alert"),
  agentAlertText: document.getElementById("agent-alert-text"),
  agentAlertClose: document.getElementById("agent-alert-close"),
  tlAlert: document.getElementById("tl-alert"),
  tlAlertText: document.getElementById("tl-alert-text"),
  tlAlertClose: document.getElementById("tl-alert-close"),
  start15Btn: document.getElementById("start-15-btn"),
  start60Btn: document.getElementById("start-60-btn"),
  endBreakBtn: document.getElementById("end-break-btn"),
  statTotalBreaks: document.getElementById("stat-total-breaks"),
  statOverbreaks: document.getElementById("stat-overbreaks"),
  statTeamLive: document.getElementById("stat-team-live"),
  statTeamOverbreaks: document.getElementById("stat-team-overbreaks"),
  myHistoryBody: document.getElementById("my-history-body"),
  adminSection: document.getElementById("admin-section"),
  adminDeviceSearch: document.getElementById("admin-device-search"),
  adminDeviceBody: document.getElementById("admin-device-body"),
  adminLiveBody: document.getElementById("admin-live-body"),
  adminHistoryBody: document.getElementById("admin-history-body"),
  adminHistoryFrom: document.getElementById("admin-history-from"),
  adminHistoryTo: document.getElementById("admin-history-to"),
  adminHistoryClear: document.getElementById("admin-history-clear"),
  adminHistoryExport: document.getElementById("admin-history-export"),
  tlSection: document.getElementById("tl-section"),
  teamLiveTag: document.getElementById("team-live-tag"),
  teamLiveBody: document.getElementById("team-live-body"),
  teamHistorySearch: document.getElementById("team-history-search"),
  teamHistoryFrom: document.getElementById("team-history-from"),
  teamHistoryTo: document.getElementById("team-history-to"),
  teamHistoryClear: document.getElementById("team-history-clear"),
  teamHistoryExport: document.getElementById("team-history-export"),
  teamHistoryBody: document.getElementById("team-history-body"),
  teamOverbreakBody: document.getElementById("team-overbreak-body"),
  toast: document.getElementById("toast")
};

bootstrap();

function bootstrap() {
  els.loginForm.addEventListener("submit", onLoginSubmit);
  els.notificationBtn.addEventListener("click", enableNotifications);
  els.logoutBtn.addEventListener("click", logout);
  document.addEventListener("visibilitychange", onVisibilityChange);
  els.teamHistorySearch?.addEventListener("input", onTeamHistoryFilterChange);
  els.teamHistoryFrom?.addEventListener("input", onTeamHistoryDateChange);
  els.teamHistoryTo?.addEventListener("input", onTeamHistoryDateChange);
  els.teamHistoryClear?.addEventListener("click", clearTeamHistoryFilter);
  els.teamHistoryExport?.addEventListener("click", exportTeamHistoryCsv);
  els.adminHistoryFrom?.addEventListener("input", onAdminHistoryDateChange);
  els.adminHistoryTo?.addEventListener("input", onAdminHistoryDateChange);
  els.adminHistoryClear?.addEventListener("click", clearAdminHistoryFilter);
  els.adminHistoryExport?.addEventListener("click", exportAdminHistoryCsv);
  els.adminDeviceSearch?.addEventListener("input", onAdminDeviceSearchChange);
  els.agentAlertClose.addEventListener("click", () => {
    state.dismissedAgentAlert = state.dashboard?.activeBreak?.breakId || "";
    renderAlerts();
  });
  els.tlAlertClose.addEventListener("click", () => {
    state.dismissedTlAlert = getCurrentTlAlertKey();
    renderAlerts();
  });
  els.start15Btn.addEventListener("click", () => startBreak("15m"));
  els.start60Btn.addEventListener("click", () => startBreak("60m"));
  els.endBreakBtn.addEventListener("click", endBreak);

  const saved = readSavedSession();
  if (!saved?.email) {
    els.email.focus();
    setSync("Waiting for sign-in");
    return;
  }

  state.remember = saved.remember;
  restoreSession(saved.email);
}

async function restoreSession(email) {
  try {
    hideLogin();
    setSync("Restoring session...");
    state.profile = await fetchProfile(email);
    if (!state.profile) throw new Error("Saved session not found.");
    await maybeRequestNotificationPermission();
    await loadDashboard();
  } catch (error) {
    clearSession();
    state.profile = null;
    state.dashboard = null;
    showLogin();
    showLoginError(error.message || "Please sign in again.");
    setSync("Waiting for sign-in");
  }
}

async function onLoginSubmit(event) {
  event.preventDefault();
  const email = els.email.value.trim().toLowerCase();
  const password = els.password.value;
  const remember = els.remember.checked;
  const deviceId = getDeviceId();

  if (!email || !password) return showLoginError("Enter your email and password.");

  els.loginBtn.disabled = true;
  showLoginError("");
  setSync("Signing in...");

  try {
    const profile = await loginWithSupabase(email, password, deviceId);
    state.profile = profile;
    state.remember = remember;
    saveSession(profile.email, remember);
    await maybeRequestNotificationPermission();
    await loadDashboard();
    showToast("Signed in successfully.");
  } catch (error) {
    clearSession();
    state.profile = null;
    state.dashboard = null;
    showLogin();
    showLoginError(error.message || "Login failed.");
    setSync("Waiting for sign-in");
  } finally {
    els.loginBtn.disabled = false;
  }
}

async function loginWithSupabase(email, password, deviceId) {
  const profile = await fetchProfile(email);
  if (!profile || String(profile.password || "") !== String(password || "")) {
    throw new Error("Invalid email or password.");
  }

  await assertTrustedDevice(profile, deviceId);
  return profile;
}

async function fetchProfile(email) {
  const { data, error } = await supabase
    .from("employees")
    .select("employee_id, full_name, department, email, tl_email, role, password")
    .eq("email", email)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    id: data.employee_id,
    name: data.full_name,
    department: data.department || "",
    email: data.email,
    tlEmail: data.tl_email || "",
    tlName: "-",
    role: data.role || "agent",
    password: data.password
  };
}

async function assertTrustedDevice(profile, deviceId) {
  if (profile.role === "admin") return;

  const normalizedDeviceId = String(deviceId || "").trim();
  if (!normalizedDeviceId) throw new Error("Missing device information.");

  const { data, error } = await supabase
    .from("trusted_devices")
    .select("id, device_id, assigned_at")
    .eq("employee_email", profile.email)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data && data.device_id !== normalizedDeviceId) {
    throw new Error("This account is already linked to another device.");
  }

  const payload = {
    employee_email: profile.email,
    device_id: normalizedDeviceId,
    last_seen_at: new Date().toISOString()
  };

  if (!data) {
    const { error: insertError } = await supabase
      .from("trusted_devices")
      .insert({ ...payload, assigned_at: new Date().toISOString() });
    if (insertError) throw new Error(insertError.message);
    return;
  }

  const { error: updateError } = await supabase
    .from("trusted_devices")
    .update(payload)
    .eq("employee_email", profile.email);

  if (updateError) throw new Error(updateError.message);
}

async function loadDashboard({ silent = false } = {}) {
  if (!state.profile) throw new Error("Not signed in.");

  const dashboard = await buildDashboard(state.profile);
  state.dashboard = dashboard;
  if (!silent) {
    state.teamHistoryDetailed = null;
    state.adminHistoryDetailed = null;
  }
  render();
  startClock();
  startRealtime();
  startPolling();

  if (!silent && state.profile.role === "tl" && hasTeamHistoryFilters()) {
    refreshTeamHistoryDetail();
  }
  if (!silent && state.profile.role === "admin" && hasAdminHistoryFilters()) {
    refreshAdminHistoryDetail();
  }
}

async function buildDashboard(profile) {
  const sinceIso = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const dashboard = {
    activeBreak: null,
    myHistory: [],
    myHistoryCount: 0,
    myOverbreakCount: 0,
    teamLive: [],
    teamHistory: [],
    teamOverbreaks: [],
    teamOverbreakCount: 0,
    adminActiveBreaks: [],
    adminHistory: [],
    trustedDevices: []
  };

  if (profile.role !== "admin") {
    dashboard.activeBreak = await getSingleRow("active_breaks", "employee_email", profile.email);
    dashboard.myHistory = await getRows("break_history", (query) => query
      .eq("employee_email", profile.email)
      .gte("started_at", sinceIso)
      .order("ended_at", { ascending: false })
      .limit(25));
    dashboard.myHistoryCount = await getCount("break_history", (query) => query.eq("employee_email", profile.email));
    dashboard.myOverbreakCount = await getCount("break_history", (query) => query.eq("employee_email", profile.email).gt("over_minutes", 0));
  }

  if (profile.role === "tl") {
    dashboard.teamLive = await getRows("active_breaks", (query) => query
      .eq("tl_email", profile.email)
      .order("started_at", { ascending: true }));
    dashboard.teamHistory = await getRows("break_history", (query) => query
      .eq("tl_email", profile.email)
      .gte("started_at", sinceIso)
      .order("ended_at", { ascending: false })
      .limit(50));
    dashboard.teamOverbreaks = await getRows("break_history", (query) => query
      .eq("tl_email", profile.email)
      .gt("over_minutes", 0)
      .gte("started_at", sinceIso)
      .order("ended_at", { ascending: false })
      .limit(30));
    dashboard.teamOverbreakCount = await getCount("break_history", (query) => query.eq("tl_email", profile.email).gt("over_minutes", 0));
  }

  if (profile.role === "admin") {
    dashboard.adminActiveBreaks = await getRows("active_breaks", (query) => query.order("started_at", { ascending: true }));
    dashboard.adminHistory = await getRows("break_history", (query) => query
      .gte("started_at", sinceIso)
      .order("ended_at", { ascending: false })
      .limit(200));
    dashboard.trustedDevices = await getRows("trusted_devices", (query) => query.order("employee_email", { ascending: true }));
  }

  return dashboard;
}

async function getRows(table, build) {
  let query = supabase.from(table).select("*");
  query = build(query);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data.map(normalizeRow) : [];
}

async function getSingleRow(table, column, value) {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq(column, value)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? normalizeRow(data) : null;
}

async function getCount(table, build) {
  let query = supabase.from(table).select("*", { count: "exact", head: true });
  query = build(query);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return Number(count || 0);
}

function normalizeRow(row) {
  if (!row) return row;
  return {
    breakId: row.break_id || row.breakId || "",
    employeeId: row.employee_id || row.employeeId || "",
    employeeName: row.employee_name || row.employeeName || row.full_name || "",
    employeeEmail: row.employee_email || row.employeeEmail || row.email || "",
    department: row.department || "",
    tlEmail: row.tl_email || row.tlEmail || "",
    breakType: row.break_type || row.breakType || "",
    breakLabel: row.break_label || row.breakLabel || "",
    allowedMinutes: Number(row.allowed_minutes ?? row.allowedMinutes ?? 0),
    startedAt: row.started_at || row.startedAt || "",
    expectedEndAt: row.expected_end_at || row.expectedEndAt || "",
    endedAt: row.ended_at || row.endedAt || "",
    durationMinutes: Number(row.duration_minutes ?? row.durationMinutes ?? 0),
    durationSeconds: Number(row.duration_seconds ?? row.durationSeconds ?? 0),
    overMinutes: Number(row.over_minutes ?? row.overMinutes ?? 0),
    assignedAt: row.assigned_at || row.assignedAt || "",
    lastSeenAt: row.last_seen_at || row.lastSeenAt || "",
    deviceId: row.device_id || row.deviceId || "",
    email: row.employee_email || row.email || ""
  };
}

function render() {
  const { profile, dashboard } = state;
  if (!profile || !dashboard) return;

  hideLogin();
  els.rolePill.textContent = `Role: ${profile.role.toUpperCase()}`;
  els.userName.textContent = profile.name;
  els.userEmail.textContent = profile.email;
  els.userDepartment.textContent = profile.department || "-";
  els.userTl.textContent = profile.tlEmail || "-";

  renderCurrentBreak(dashboard.activeBreak);
  renderMyHistory(dashboard.myHistory || []);
  renderAdminPanel(profile.role, dashboard.trustedDevices || []);
  renderTlPanels(profile.role, dashboard.teamLive || [], getFilteredTeamHistory(), dashboard.teamOverbreaks || []);
  renderAlerts();
  processNotifications();

  els.statTotalBreaks.textContent = String(dashboard.myHistoryCount || 0);
  els.statOverbreaks.textContent = String(dashboard.myOverbreakCount || 0);
  els.statTeamLive.textContent = profile.role === "tl" ? String((dashboard.teamLive || []).length) : "-";
  els.statTeamOverbreaks.textContent = profile.role === "tl" ? String(dashboard.teamOverbreakCount || 0) : "-";
  setSync(`Last sync ${formatTime(new Date().toISOString())}`);
  updateNotificationButton();
}

function renderCurrentBreak(activeBreak) {
  if (state.profile?.role === "admin") {
    els.currentStatusTag.className = "tag";
    els.currentStatusTag.textContent = "Admin Mode";
    els.currentBreakCallout.className = "callout live";
    els.currentBreakCallout.innerHTML = "<strong>Admin-only access</strong><p>Use the admin panel below to reset trusted devices. Admin accounts do not start or end breaks.</p>";
    els.currentBreakType.textContent = "-";
    els.currentBreakElapsed.textContent = "-";
    els.currentBreakReturn.textContent = "-";
    els.start15Btn.disabled = true;
    els.start60Btn.disabled = true;
    els.endBreakBtn.disabled = true;
    return;
  }

  const isActive = Boolean(activeBreak);
  els.start15Btn.disabled = isActive;
  els.start60Btn.disabled = isActive;
  els.endBreakBtn.disabled = !isActive;

  if (!isActive) {
    els.currentStatusTag.className = "tag good";
    els.currentStatusTag.textContent = "Available";
    els.currentBreakCallout.className = "callout ok";
    els.currentBreakCallout.innerHTML = "<strong>Ready for next break</strong><p>No active break right now.</p>";
    els.currentBreakType.textContent = "-";
    els.currentBreakElapsed.textContent = "-";
    els.currentBreakReturn.textContent = "-";
    return;
  }

  const overMinutes = getOverMinutes(activeBreak.startedAt, activeBreak.allowedMinutes);
  const isOver = overMinutes > 0;
  els.currentStatusTag.className = `tag ${isOver ? "bad" : ""}`.trim();
  els.currentStatusTag.textContent = isOver ? `Over by ${overMinutes}m` : "On Break";
  els.currentBreakCallout.className = `callout ${isOver ? "warn" : "live"}`;
  els.currentBreakCallout.innerHTML = `<strong>${activeBreak.breakLabel} in progress</strong><p>${isOver ? "This break has passed the allowed time." : "You are currently on break. End the break when you return."}</p>`;
  els.currentBreakType.textContent = activeBreak.breakLabel;
  els.currentBreakElapsed.textContent = formatMinutes(getElapsedMinutes(activeBreak.startedAt));
  els.currentBreakReturn.textContent = formatDateTime(activeBreak.expectedEndAt);
}

function renderMyHistory(rows) {
  if (state.profile?.role === "admin") {
    els.myHistoryBody.innerHTML = '<tr><td colspan="6"><div class="empty">Admin accounts do not have break history.</div></td></tr>';
    return;
  }
  if (!rows.length) {
    els.myHistoryBody.innerHTML = '<tr><td colspan="6"><div class="empty">No break history yet.</div></td></tr>';
    return;
  }
  els.myHistoryBody.innerHTML = rows.map((item) => `<tr><td>${formatDate(item.startedAt)}</td><td>${escapeHtml(item.breakLabel)}</td><td>${formatTime(item.startedAt)}</td><td>${formatTime(item.endedAt)}</td><td>${formatDuration(item)}</td><td>${item.overMinutes > 0 ? `<span class="tag bad">Over by ${item.overMinutes}m</span>` : '<span class="tag good">Within limit</span>'}</td></tr>`).join("");
}

function renderAdminPanel(role, devices) {
  const isAdmin = role === "admin";
  els.adminSection.classList.toggle("hidden", !isAdmin);
  if (!isAdmin) return;

  const filteredDevices = getFilteredAdminDevices(devices);
  if (!filteredDevices.length) {
    const emptyMessage = devices.length && state.adminDeviceSearch
      ? "No matching trusted device found."
      : "No trusted devices have been assigned yet.";
    els.adminDeviceBody.innerHTML = `<tr><td colspan="5"><div class="empty">${emptyMessage}</div></td></tr>`;
  } else {
    els.adminDeviceBody.innerHTML = filteredDevices.map((item) => `<tr><td>${escapeHtml(item.employeeEmail || item.email)}</td><td>${escapeHtml(item.deviceId || "-")}</td><td>${item.assignedAt ? formatDateTime(item.assignedAt) : "-"}</td><td>${item.lastSeenAt ? formatDateTime(item.lastSeenAt) : "-"}</td><td><button class="btn sec" type="button" data-reset-email="${escapeHtml(item.employeeEmail || item.email)}">Reset Device</button></td></tr>`).join("");
    els.adminDeviceBody.querySelectorAll("[data-reset-email]").forEach((button) => {
      button.addEventListener("click", () => resetDevice(button.getAttribute("data-reset-email")));
    });
  }
  renderAdminBreaks(state.dashboard?.adminActiveBreaks || [], getFilteredAdminHistory());
}

function renderAdminBreaks(activeRows, historyRows) {
  els.adminLiveBody.innerHTML = activeRows.length
    ? activeRows.map((item) => `<tr><td>${escapeHtml(item.employeeName)}</td><td>${escapeHtml(item.employeeEmail)}</td><td>${escapeHtml(item.department || "-")}</td><td>${escapeHtml(item.breakLabel)}</td><td>${formatTime(item.startedAt)}</td><td>${formatElapsed(item.startedAt)}</td><td>${getOverMinutes(item.startedAt, item.allowedMinutes) > 0 ? `<span class="tag bad">Over by ${getOverMinutes(item.startedAt, item.allowedMinutes)}m</span>` : '<span class="tag good">Within limit</span>'}</td></tr>`).join("")
    : '<tr><td colspan="7"><div class="empty">No active breaks right now.</div></td></tr>';

  els.adminHistoryBody.innerHTML = historyRows.length
    ? historyRows.map((item) => `<tr><td>${escapeHtml(item.employeeName)}</td><td>${escapeHtml(item.employeeEmail)}</td><td>${escapeHtml(item.breakLabel)}</td><td>${formatDate(item.startedAt)}</td><td>${formatTime(item.startedAt)}</td><td>${formatTime(item.endedAt)}</td><td>${formatDuration(item)}</td><td>${item.overMinutes > 0 ? `<span class="tag bad">Over by ${item.overMinutes}m</span>` : '<span class="tag good">Within limit</span>'}</td></tr>`).join("")
    : '<tr><td colspan="8"><div class="empty">No break history yet.</div></td></tr>';
}

function renderTlPanels(role, liveRows, historyRows, overbreakRows) {
  const isTl = role === "tl";
  els.tlSection.classList.toggle("hidden", !isTl);
  if (!isTl) return;

  els.teamLiveTag.textContent = `${liveRows.length} active`;
  els.teamLiveBody.innerHTML = liveRows.length
    ? liveRows.map((item) => `<tr><td>${escapeHtml(item.employeeName)}</td><td>${escapeHtml(item.department || "-")}</td><td>${escapeHtml(item.breakLabel)}</td><td>${formatTime(item.startedAt)}</td><td>${formatElapsed(item.startedAt)}</td><td>${getOverMinutes(item.startedAt, item.allowedMinutes) > 0 ? `<span class="tag bad">Over by ${getOverMinutes(item.startedAt, item.allowedMinutes)}m</span>` : '<span class="tag good">Within limit</span>'}</td></tr>`).join("")
    : '<tr><td colspan="6"><div class="empty">No team members are currently on break.</div></td></tr>';

  els.teamHistoryBody.innerHTML = historyRows.length
    ? historyRows.map((item) => `<tr><td>${escapeHtml(item.employeeName)}</td><td>${escapeHtml(item.breakLabel)}</td><td>${formatDate(item.startedAt)}</td><td>${formatTime(item.startedAt)}</td><td>${formatTime(item.endedAt)}</td><td>${formatDuration(item)}</td><td>${item.overMinutes > 0 ? `<span class="tag bad">Over by ${item.overMinutes}m</span>` : '<span class="tag good">Within limit</span>'}</td></tr>`).join("")
    : '<tr><td colspan="7"><div class="empty">No team break history yet.</div></td></tr>';

  els.teamOverbreakBody.innerHTML = overbreakRows.length
    ? overbreakRows.map((item) => `<tr><td>${escapeHtml(item.employeeName)}</td><td>${escapeHtml(item.breakLabel)}</td><td>${formatDate(item.startedAt)}</td><td>${formatDuration(item)}</td><td><span class="tag bad">${item.overMinutes}m</span></td></tr>`).join("")
    : '<tr><td colspan="5"><div class="empty">No overbreak records yet.</div></td></tr>';
}

async function startBreak(type) {
  try {
    disableBreakButtons(true);
    const existing = await getSingleRow("active_breaks", "employee_email", state.profile.email);
    if (existing) throw new Error("You already have an active break.");

    const config = ACTIVE_BREAK_TYPES[type];
    if (!config) throw new Error("Invalid break type.");

    const startedAt = new Date().toISOString();
    const record = {
      break_id: crypto.randomUUID(),
      employee_id: state.profile.id,
      employee_name: state.profile.name,
      employee_email: state.profile.email,
      department: state.profile.department || "",
      tl_email: state.profile.tlEmail || state.profile.email,
      break_type: type,
      break_label: config.breakLabel,
      allowed_minutes: config.allowedMinutes,
      started_at: startedAt,
      expected_end_at: new Date(Date.now() + config.allowedMinutes * 60000).toISOString()
    };

    const { error } = await supabase.from("active_breaks").insert(record);
    if (error) throw new Error(error.message);
    await loadDashboard({ silent: true });
    showToast(`${config.breakLabel} started.`);
  } catch (error) {
    showToast(error.message || "Unable to start break.");
  } finally {
    disableBreakButtons(false);
  }
}

async function endBreak() {
  const activeBreak = state.dashboard?.activeBreak;
  if (!activeBreak) return;

  try {
    disableBreakButtons(true);
    applyOptimisticEndBreak(activeBreak);
    const endedAt = new Date().toISOString();
    const durationSeconds = Math.max(1, Math.floor((new Date(endedAt).getTime() - new Date(activeBreak.startedAt).getTime()) / 1000));
    const durationMinutes = Math.max(1, Math.floor(durationSeconds / 60));
    const overMinutes = Math.max(0, durationMinutes - activeBreak.allowedMinutes);

    const historyRecord = {
      break_id: activeBreak.breakId,
      employee_id: activeBreak.employeeId,
      employee_name: activeBreak.employeeName,
      employee_email: activeBreak.employeeEmail,
      department: activeBreak.department,
      tl_email: activeBreak.tlEmail,
      break_type: activeBreak.breakType,
      break_label: activeBreak.breakLabel,
      allowed_minutes: activeBreak.allowedMinutes,
      started_at: activeBreak.startedAt,
      ended_at: endedAt,
      duration_minutes: durationMinutes,
      duration_seconds: durationSeconds,
      over_minutes: overMinutes
    };

    const { error: insertError } = await supabase.from("break_history").insert(historyRecord);
    if (insertError) throw new Error(insertError.message);

    const { error: deleteError } = await supabase.from("active_breaks").delete().eq("employee_email", state.profile.email);
    if (deleteError) throw new Error(deleteError.message);

    await loadDashboard({ silent: true });
    refreshVisibleHistoryAfterBreak();
    showToast("Break ended.");
  } catch (error) {
    showToast(error.message || "Unable to end break.");
  } finally {
    disableBreakButtons(false);
  }
}

async function logout() {
  stopPolling();
  stopRealtime();
  clearSession();
  state.profile = null;
  state.dashboard = null;
  showLogin();
  setSync("Signed out");
}

async function resetDevice(email) {
  if (!email) return;
  try {
    const { error } = await supabase.from("trusted_devices").delete().eq("employee_email", email);
    if (error) throw new Error(error.message);
    await loadDashboard({ silent: true });
    showToast(`Trusted device reset for ${email}.`);
  } catch (error) {
    showToast(error.message || "Unable to reset device.");
  }
}

function startPolling() {
  if (!shouldPollInCurrentTab()) {
    stopPollingOnly();
    return;
  }
  stopPollingOnly();
  state.pollTimer = window.setInterval(async () => {
    if (!state.profile || !shouldPollInCurrentTab()) return;
    try {
      await loadDashboard({ silent: true });
    } catch (_) {
    }
  }, POLL_MS);
}

function stopPollingOnly() {
  if (state.pollTimer) window.clearInterval(state.pollTimer);
  state.pollTimer = null;
}

function stopPolling() {
  stopPollingOnly();
  if (state.clockTimer) window.clearInterval(state.clockTimer);
  state.clockTimer = null;
}

function shouldPollInCurrentTab() {
  if (!state.profile) return true;
  if (state.profile.role !== "agent") return true;
  return document.visibilityState === "visible";
}

async function onVisibilityChange() {
  if (!state.profile) return;
  if (shouldPollInCurrentTab()) {
    await loadDashboard({ silent: true });
  } else {
    stopPollingOnly();
  }
}

function startRealtime() {
  stopRealtime();
  if (!state.profile) return;

  state.realtimeChannel = supabase
    .channel(`ags-breaks-${state.profile.email}-${Date.now()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "active_breaks" }, async () => {
      try { await loadDashboard({ silent: true }); } catch (_) {}
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "break_history" }, async () => {
      try {
        await loadDashboard({ silent: true });
        refreshVisibleHistoryAfterBreak();
      } catch (_) {}
    })
    .subscribe();
}

function stopRealtime() {
  if (!state.realtimeChannel) return;
  supabase.removeChannel(state.realtimeChannel);
  state.realtimeChannel = null;
}

function startClock() {
  if (state.clockTimer) window.clearInterval(state.clockTimer);
  state.clockTimer = window.setInterval(() => {
    if (!state.dashboard) return;
    setSync(`Last sync ${formatTime(new Date().toISOString())}`);
    renderCurrentBreak(state.dashboard.activeBreak || null);
    renderAlerts();
    if (state.profile?.role === "tl") {
      renderTlPanels(state.profile.role, state.dashboard.teamLive || [], getFilteredTeamHistory(), state.dashboard.teamOverbreaks || []);
    }
  }, 1000);
}

function applyOptimisticEndBreak(activeBreak) {
  const endedAt = new Date().toISOString();
  const durationSeconds = Math.max(1, Math.floor((new Date(endedAt).getTime() - new Date(activeBreak.startedAt).getTime()) / 1000));
  const durationMinutes = Math.max(1, Math.floor(durationSeconds / 60));
  const overMinutes = Math.max(0, durationMinutes - activeBreak.allowedMinutes);
  const historyItem = { ...activeBreak, endedAt, durationMinutes, durationSeconds, overMinutes };

  state.dashboard = {
    ...state.dashboard,
    activeBreak: null,
    myHistory: [historyItem, ...(state.dashboard?.myHistory || [])].slice(0, 25),
    myHistoryCount: (state.dashboard?.myHistoryCount || 0) + 1,
    myOverbreakCount: (state.dashboard?.myOverbreakCount || 0) + (overMinutes > 0 ? 1 : 0)
  };

  render();
}

function refreshVisibleHistoryAfterBreak() {
  if (state.profile?.role === "tl" && hasTeamHistoryFilters()) refreshTeamHistoryDetail();
  if (state.profile?.role === "admin" && hasAdminHistoryFilters()) refreshAdminHistoryDetail();
}

function saveSession(email, remember) {
  const payload = JSON.stringify({ email, remember });
  if (remember) {
    localStorage.setItem("ags_supabase_session", payload);
    sessionStorage.removeItem("ags_supabase_session");
  } else {
    sessionStorage.setItem("ags_supabase_session", payload);
    localStorage.removeItem("ags_supabase_session");
  }
}

function readSavedSession() {
  const raw = localStorage.getItem("ags_supabase_session") || sessionStorage.getItem("ags_supabase_session");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { clearSession(); return null; }
}

function clearSession() {
  localStorage.removeItem("ags_supabase_session");
  sessionStorage.removeItem("ags_supabase_session");
}

function getDeviceId() {
  const key = "ags_break_device_id";
  let value = localStorage.getItem(key);
  if (!value) {
    value = typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : `device_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(key, value);
  }
  return value;
}

function renderAlerts() {
  const activeBreak = state.dashboard?.activeBreak || null;
  const teamLive = state.dashboard?.teamLive || [];
  const activeOverbreak = activeBreak && getOverMinutes(activeBreak.startedAt, activeBreak.allowedMinutes) > 0 ? activeBreak : null;
  const tlOverbreaks = teamLive.filter((item) => getOverMinutes(item.startedAt, item.allowedMinutes) > 0);
  const currentTlAlertKey = getCurrentTlAlertKey();

  const showAgentAlert = Boolean(activeOverbreak && state.dismissedAgentAlert !== activeOverbreak.breakId);
  els.agentAlert.classList.toggle("show", showAgentAlert);
  if (showAgentAlert) {
    els.agentAlertText.textContent = `You are overbreak by ${getOverMinutes(activeOverbreak.startedAt, activeOverbreak.allowedMinutes)} minute(s). Please end your break when you return.`;
  }

  const showTlAlert = Boolean(state.profile?.role === "tl" && tlOverbreaks.length && state.dismissedTlAlert !== currentTlAlertKey);
  els.tlAlert.classList.toggle("show", showTlAlert);
  if (showTlAlert) {
    const names = tlOverbreaks.slice(0, 3).map((item) => item.employeeName).join(", ");
    const more = tlOverbreaks.length > 3 ? ` and ${tlOverbreaks.length - 3} more` : "";
    els.tlAlertText.textContent = `${names}${more} ${tlOverbreaks.length === 1 ? "is" : "are"} already overbreak.`;
  }
}

function getCurrentTlAlertKey() {
  const teamLive = state.dashboard?.teamLive || [];
  return teamLive
    .filter((item) => getOverMinutes(item.startedAt, item.allowedMinutes) > 0)
    .map((item) => item.breakId || item.employeeEmail)
    .sort()
    .join("|");
}

async function maybeRequestNotificationPermission() {
  if (!("Notification" in window) || Notification.permission !== "default") return;
  try { await Notification.requestPermission(); } catch (_) {}
}

async function enableNotifications() {
  await maybeRequestNotificationPermission();
  updateNotificationButton();
  if (Notification.permission === "granted") showToast("Browser alerts enabled.");
}

function updateNotificationButton() {
  if (!("Notification" in window)) {
    els.notificationBtn.disabled = true;
    els.notificationBtn.textContent = "Alerts Unsupported";
    return;
  }
  if (Notification.permission === "granted") {
    els.notificationBtn.disabled = true;
    els.notificationBtn.textContent = "Alerts Enabled";
    return;
  }
  els.notificationBtn.disabled = false;
  els.notificationBtn.textContent = "Enable Alerts";
}

function onTeamHistoryFilterChange(event) {
  state.teamHistoryFilter = event.target.value.trim().toLowerCase();
  if (state.profile?.role === "tl") scheduleTeamHistoryRefresh();
}

function onTeamHistoryDateChange() {
  state.teamHistoryFrom = els.teamHistoryFrom?.value || "";
  state.teamHistoryTo = els.teamHistoryTo?.value || "";
  if (state.profile?.role === "tl") refreshTeamHistoryDetail();
}

function clearTeamHistoryFilter() {
  state.teamHistoryFilter = "";
  state.teamHistoryFrom = "";
  state.teamHistoryTo = "";
  state.teamHistoryDetailed = null;
  window.clearTimeout(state.teamHistoryDebounce);
  if (els.teamHistorySearch) els.teamHistorySearch.value = "";
  if (els.teamHistoryFrom) els.teamHistoryFrom.value = "";
  if (els.teamHistoryTo) els.teamHistoryTo.value = "";
  if (state.profile?.role === "tl") renderTlPanels(state.profile.role, state.dashboard?.teamLive || [], getFilteredTeamHistory(), state.dashboard?.teamOverbreaks || []);
}

function getFilteredTeamHistory() {
  const rows = state.teamHistoryDetailed || state.dashboard?.teamHistory || [];
  return rows.filter((item) => {
    if (state.teamHistoryFilter && !String(item.employeeName || "").toLowerCase().includes(state.teamHistoryFilter)) return false;
    return matchesDateRange(item.startedAt, state.teamHistoryFrom, state.teamHistoryTo);
  });
}

async function exportTeamHistoryCsv() {
  const rows = await fetchHistoryRows("team", {
    search: state.teamHistoryFilter,
    from: state.teamHistoryFrom,
    to: state.teamHistoryTo
  });
  if (!rows.length) return showToast("No team history to export.");

  const header = ["Name", "Break Type", "Date", "Started", "Ended", "Duration", "Status"];
  const csvRows = [header.join(",")];
  rows.forEach((item) => {
    csvRows.push([
      csvValue(item.employeeName),
      csvValue(item.breakLabel),
      csvValue(formatDate(item.startedAt)),
      csvValue(formatTime(item.startedAt)),
      csvValue(formatTime(item.endedAt)),
      csvValue(formatDuration(item)),
      csvValue(item.overMinutes > 0 ? `Over by ${item.overMinutes}m` : "Within limit")
    ].join(","));
  });
  downloadCsv("team_break_history.csv", csvRows.join("\n"));
}

async function exportAdminHistoryCsv() {
  const rows = await fetchHistoryRows("admin", {
    from: state.adminHistoryFrom,
    to: state.adminHistoryTo
  });
  if (!rows.length) return showToast("No admin history to export.");

  const header = ["Name", "Email", "Break Type", "Date", "Started", "Ended", "Duration", "Status"];
  const csvRows = [header.join(",")];
  rows.forEach((item) => {
    csvRows.push([
      csvValue(item.employeeName),
      csvValue(item.employeeEmail),
      csvValue(item.breakLabel),
      csvValue(formatDate(item.startedAt)),
      csvValue(formatTime(item.startedAt)),
      csvValue(formatTime(item.endedAt)),
      csvValue(formatDuration(item)),
      csvValue(item.overMinutes > 0 ? `Over by ${item.overMinutes}m` : "Within limit")
    ].join(","));
  });
  downloadCsv("all_break_history.csv", csvRows.join("\n"));
}

function onAdminHistoryDateChange() {
  state.adminHistoryFrom = els.adminHistoryFrom?.value || "";
  state.adminHistoryTo = els.adminHistoryTo?.value || "";
  if (state.profile?.role === "admin") refreshAdminHistoryDetail();
}

function onAdminDeviceSearchChange(event) {
  state.adminDeviceSearch = event.target.value.trim().toLowerCase();
  if (state.profile?.role === "admin") renderAdminPanel(state.profile.role, state.dashboard?.trustedDevices || []);
}

function clearAdminHistoryFilter() {
  state.adminHistoryFrom = "";
  state.adminHistoryTo = "";
  state.adminHistoryDetailed = null;
  if (els.adminHistoryFrom) els.adminHistoryFrom.value = "";
  if (els.adminHistoryTo) els.adminHistoryTo.value = "";
  if (state.profile?.role === "admin") renderAdminBreaks(state.dashboard?.adminActiveBreaks || [], getFilteredAdminHistory());
}

function getFilteredAdminHistory() {
  const rows = state.adminHistoryDetailed || state.dashboard?.adminHistory || [];
  return rows.filter((item) => matchesDateRange(item.startedAt, state.adminHistoryFrom, state.adminHistoryTo));
}

function getFilteredAdminDevices(rows) {
  if (!state.adminDeviceSearch) return rows;
  return rows.filter((item) => String(item.employeeEmail || item.email || "").toLowerCase().includes(state.adminDeviceSearch));
}

function hasTeamHistoryFilters() {
  return Boolean(state.teamHistoryFilter || state.teamHistoryFrom || state.teamHistoryTo);
}

function hasAdminHistoryFilters() {
  return Boolean(state.adminHistoryFrom || state.adminHistoryTo);
}

function scheduleTeamHistoryRefresh() {
  window.clearTimeout(state.teamHistoryDebounce);
  state.teamHistoryDebounce = window.setTimeout(() => refreshTeamHistoryDetail(), 250);
}

async function refreshTeamHistoryDetail() {
  if (state.profile?.role !== "tl") return;
  if (!hasTeamHistoryFilters()) {
    state.teamHistoryDetailed = null;
    renderTlPanels(state.profile.role, state.dashboard?.teamLive || [], getFilteredTeamHistory(), state.dashboard?.teamOverbreaks || []);
    return;
  }
  try {
    state.teamHistoryDetailed = await fetchHistoryRows("team", {
      search: state.teamHistoryFilter,
      from: state.teamHistoryFrom,
      to: state.teamHistoryTo
    });
    renderTlPanels(state.profile.role, state.dashboard?.teamLive || [], getFilteredTeamHistory(), state.dashboard?.teamOverbreaks || []);
  } catch (error) {
    showToast(error.message || "Unable to load team history.");
  }
}

async function refreshAdminHistoryDetail() {
  if (state.profile?.role !== "admin") return;
  if (!hasAdminHistoryFilters()) {
    state.adminHistoryDetailed = null;
    renderAdminBreaks(state.dashboard?.adminActiveBreaks || [], getFilteredAdminHistory());
    return;
  }
  try {
    state.adminHistoryDetailed = await fetchHistoryRows("admin", {
      from: state.adminHistoryFrom,
      to: state.adminHistoryTo
    });
    renderAdminBreaks(state.dashboard?.adminActiveBreaks || [], getFilteredAdminHistory());
  } catch (error) {
    showToast(error.message || "Unable to load admin history.");
  }
}

async function fetchHistoryRows(scope, filters = {}) {
  let query = supabase.from("break_history").select("*").order("ended_at", { ascending: false });
  if (scope === "team") {
    if (state.profile?.role !== "tl") throw new Error("Forbidden.");
    query = query.eq("tl_email", state.profile.email);
  }
  if (scope === "admin") {
    if (state.profile?.role !== "admin") throw new Error("Forbidden.");
  }
  if (filters.search) query = query.ilike("employee_name", `%${filters.search}%`);
  if (filters.from) query = query.gte("started_at", `${filters.from}T00:00:00`);
  if (filters.to) query = query.lte("started_at", `${filters.to}T23:59:59`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data.map(normalizeRow) : [];
}

function processNotifications() {
  const activeBreak = state.dashboard?.activeBreak || null;
  if (activeBreak && getOverMinutes(activeBreak.startedAt, activeBreak.allowedMinutes) > 0) {
    notifyOnce(`agent:${activeBreak.breakId}`, {
      title: "AGS Break Tracker",
      body: `You are already overbreak on ${activeBreak.breakLabel}.`
    });
  }

  if (state.profile?.role === "tl") {
    (state.dashboard?.teamLive || []).forEach((item) => {
      notifyOnce(`tl-start:${item.breakId || item.employeeEmail}`, {
        title: "Team Break Started",
        body: `${item.employeeName} started ${item.breakLabel}.`
      });
      if (getOverMinutes(item.startedAt, item.allowedMinutes) > 0) {
        notifyOnce(`tl:${item.breakId || item.employeeEmail}`, {
          title: "Team Overbreak Alert",
          body: `${item.employeeName} is already overbreak.`
        });
      }
    });

    (state.dashboard?.teamHistory || []).slice(0, 10).forEach((item) => {
      notifyOnce(`tl-end:${item.breakId || item.employeeEmail}`, {
        title: "Team Break Ended",
        body: `${item.employeeName} ended ${item.breakLabel}.`
      });
    });
  }
}

function notifyOnce(key, payload) {
  if (!key || sessionStorage.getItem(`ags_alert_${key}`) === "sent") return;
  sessionStorage.setItem(`ags_alert_${key}`, "sent");
  playAlertTone();
  if ("Notification" in window && Notification.permission === "granted") {
    try { new Notification(payload.title, { body: payload.body, silent: false }); } catch (_) {}
  }
}

function playAlertTone() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    state.audioContext ||= new AudioCtx();
    const context = state.audioContext;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.32);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.34);
  } catch (_) {}
}

function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function showLogin() { els.loginOverlay.classList.remove("hidden"); }
function hideLogin() { els.loginOverlay.classList.add("hidden"); }
function showLoginError(message) { els.loginError.style.display = message ? "block" : "none"; els.loginError.textContent = message; }
function setSync(text) { els.syncLabel.textContent = text; }
function disableBreakButtons(disabled) { els.start15Btn.disabled = disabled || Boolean(state.dashboard?.activeBreak); els.start60Btn.disabled = disabled || Boolean(state.dashboard?.activeBreak); els.endBreakBtn.disabled = disabled || !state.dashboard?.activeBreak; }
function showToast(message) { els.toast.textContent = message; els.toast.classList.add("show"); window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 3000); }
function formatDateTime(value) { return value ? new Date(value).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-"; }
function formatDate(value) { return new Date(value).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }); }
function formatTime(value) { return new Date(value).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function getElapsedMinutes(startedAt) { return Math.max(1, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000)); }
function getOverMinutes(startedAt, allowedMinutes) { return Math.max(0, getElapsedMinutes(startedAt) - allowedMinutes); }
function formatMinutes(minutes) { if (!Number.isFinite(minutes)) return "-"; const hours = Math.floor(minutes / 60); const mins = minutes % 60; return !hours ? `${mins}m` : !mins ? `${hours}h` : `${hours}h ${mins}m`; }
function formatElapsed(startedAt) { return formatDuration({ durationSeconds: Math.max(1, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)) }); }
function formatDuration(item) { const totalSeconds = Number(item?.durationSeconds || 0) || Math.max(0, Number(item?.durationMinutes || 0) * 60); if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "-"; const hours = Math.floor(totalSeconds / 3600); const minutes = Math.floor((totalSeconds % 3600) / 60); const seconds = totalSeconds % 60; const parts = []; if (hours) parts.push(`${hours}h`); if (minutes || hours) parts.push(`${minutes}m`); parts.push(`${seconds}s`); return parts.join(" "); }
function escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function csvValue(value) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }
function matchesDateRange(value, from, to) { if (!value) return false; const isoDate = new Date(value).toISOString().slice(0, 10); if (from && isoDate < from) return false; if (to && isoDate > to) return false; return true; }
