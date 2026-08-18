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
  const body = (await res.json()) as ApiResponse<T> | { detail: string }
  if ("success" in body) {
    if (!body.success) throw new Error(body.error)
    return body.data
  }
  throw new Error(body.detail)
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
