export type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`)
  const body: ApiResponse<T> = await res.json()
  if (!body.success) throw new Error(body.error)
  return body.data
}

export async function apiPost<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  const body: ApiResponse<T> = await res.json()
  if (!body.success) throw new Error(body.error)
  return body.data
}
