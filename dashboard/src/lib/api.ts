export type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }

const ADMIN_PASSWORD_KEY = "near2far_admin_password"

export function getAdminPassword(): string | null {
  return localStorage.getItem(ADMIN_PASSWORD_KEY)
}

export function setAdminPassword(password: string): void {
  localStorage.setItem(ADMIN_PASSWORD_KEY, password)
}

function authHeaders(): HeadersInit {
  const password = getAdminPassword()
  return password ? { Authorization: `Bearer ${password}` } : {}
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok && !res.headers.get("content-type")?.includes("application/json")) {
    // A non-JSON error body means something in front of the backend rejected the request
    // (nginx body-size limit, a proxy timeout, etc.) rather than the app itself.
    throw new Error(`Request failed (${res.status} ${res.statusText})`)
  }

  const body = (await res.json()) as ApiResponse<T> | { detail: unknown }
  if ("success" in body) {
    if (!body.success) throw new Error(body.error)
    return body.data
  }
  // FastAPI's own 422 validation-error responses (as opposed to this app's manual
  // HTTPException(400, str(...)) pattern used elsewhere) put `detail` as an array of
  // {msg, loc, ...} objects rather than a plain string — stringify those into something
  // actually readable instead of the default "[object Object]"-ish message.
  const detail = body.detail
  const message =
    typeof detail === "string"
      ? detail
      : Array.isArray(detail)
        ? detail.map((d) => (d && typeof d === "object" && "msg" in d ? String(d.msg) : String(d))).join(", ")
        : JSON.stringify(detail)
  throw new Error(message)
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: authHeaders() })
  return unwrap<T>(res)
}

export async function apiPost<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  })
  return unwrap<T>(res)
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "DELETE",
    headers: authHeaders(),
  })
  return unwrap<T>(res)
}

export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const body = new FormData()
  body.append("file", file)
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: authHeaders(),
    body,
  })
  return unwrap<T>(res)
}
