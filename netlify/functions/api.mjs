import { assertLoginPassword, assertTrustedDevice, buildDashboard, createSession, deleteSession, endBreakForUser, findUserByEmail, getEmployees, getHistoryForUser, json, parseBody, requireUser, resetTrustedDevice, startBreakForUser } from "./_lib/shared.mjs";

export default async (request) => {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "";

  try {
    if (request.method === "POST" && action === "login") {
      const body = await parseBody(request);
      const employees = await getEmployees();
      const user = findUserByEmail(employees, body.email);
      if (!user) return json({ error: "Invalid email or password." }, 401);
      assertLoginPassword(user, body.password);
      await assertTrustedDevice(user.email, body.deviceId);
      const session = await createSession(user, Boolean(body.remember));
      return json({ token: session.token, expiresAt: session.expiresAt, profile: user });
    }

    if (request.method === "POST" && action === "logout") {
      try {
        const { token } = await requireUser(request);
        await deleteSession(token);
      } catch (_) {
      }
      return json({ ok: true });
    }

    const { user } = await requireUser(request);

    if (request.method === "GET" && action === "dashboard") return json({ profile: user, dashboard: await buildDashboard(user) });
    if (request.method === "GET" && action === "live") return json({ profile: user, dashboard: await buildDashboard(user) });
    if (request.method === "GET" && action === "history") {
      const scope = url.searchParams.get("scope") || "";
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const search = url.searchParams.get("search") || "";
      return json({ rows: await getHistoryForUser(user, { scope, from, to, search }) });
    }
    if (request.method === "POST" && action === "reset-device") {
      if (user.role !== "admin") return json({ error: "Forbidden." }, 403);
      const body = await parseBody(request);
      await resetTrustedDevice(body.email);
      return json({ ok: true, dashboard: await buildDashboard(user), resetEmail: body.email });
    }
    if (request.method === "POST" && action === "start-break") {
      if (user.role === "admin") return json({ error: "Admins cannot start breaks." }, 403);
      const body = await parseBody(request);
      await startBreakForUser(user, body.type);
      return json({ profile: user, dashboard: await buildDashboard(user) });
    }
    if (request.method === "POST" && action === "end-break") {
      if (user.role === "admin") return json({ error: "Admins cannot end breaks." }, 403);
      await endBreakForUser(user);
      return json({ profile: user, dashboard: await buildDashboard(user) });
    }

    return json({ error: "Not found." }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return json({ error: message }, message === "Unauthorized" || message === "Session expired" ? 401 : 400);
  }
};
