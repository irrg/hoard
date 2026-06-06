export const BASE_URL = "https://bundleofholding.com";
export async function loginWeb(email, password) {
    const body = new URLSearchParams({
        users_email: email,
        password,
        remember: "1",
        submit: "Open the way!",
    });
    const r = await fetch(`${BASE_URL}/user/login`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0",
        },
        body: body.toString(),
        redirect: "manual",
    });
    // Successful login returns a redirect with Set-Cookie
    if (r.status !== 302 && r.status !== 303) {
        throw new Error(`Login failed: expected redirect, got HTTP ${r.status}`);
    }
    const setCookieHeaders = r.headers.getSetCookie?.() ??
        [r.headers.get("set-cookie") ?? ""].filter(Boolean);
    if (setCookieHeaders.length === 0) {
        throw new Error("Login failed: no session cookie returned");
    }
    return setCookieHeaders.map((c) => c.split(";")[0].trim()).join("; ");
}
