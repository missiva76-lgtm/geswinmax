const API = import.meta.env.VITE_API_URL || '/api'

export class ServerWakingError extends Error {
  constructor() { super('O servidor está a acordar. Aguarda um momento...') }
}

// Retry automático para 503/CORS (Render a acordar) — tenta até 4x com 15s de intervalo
async function fetchWithRetry(url: string, options?: RequestInit, retries = 4): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options)
      if (res.status !== 503) return res
    } catch {
      // TypeError: Failed to fetch — pode ser CORS em resposta 503 do Render
    }
    if (i < retries - 1) {
      console.warn(`[GesWinmax] Servidor indisponível — retry ${i + 1}/${retries - 1} em 15s...`)
      await new Promise(r => setTimeout(r, 15000))
    }
  }
  throw new ServerWakingError()
}

export async function uploadExcel(file: File): Promise<{ jobId: string }> {
  const fd = new FormData()
  fd.append('excel', file)
  const res = await fetchWithRetry(`${API}/jobs/emissao`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getJob(jobId: string) {
  const res = await fetch(`${API}/jobs/${jobId}`)
  return res.json()
}

export async function getJobs() {
  try {
    const res = await fetchWithRetry(`${API}/jobs`)
    if (!res.ok) return []
    return res.json()
  } catch { return [] }
}

export async function triggerSync(): Promise<{ jobId: string }> {
  const res = await fetchWithRetry(`${API}/jobs/sync`, { method: 'POST' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getArtigos(q?: string) {
  const url = q ? `${API}/artigos?q=${encodeURIComponent(q)}` : `${API}/artigos`
  const res = await fetchWithRetry(url)
  if (!res.ok) return []
  return res.json()
}

export async function getFaturas(filtros?: { cliente?: string; sucesso?: boolean }) {
  const params = new URLSearchParams()
  if (filtros?.cliente)               params.set('cliente', filtros.cliente)
  if (filtros?.sucesso !== undefined)  params.set('sucesso', String(filtros.sucesso))
  const res = await fetchWithRetry(`${API}/faturas?${params}`)
  if (!res.ok) return []
  return res.json()
}

export async function getConfig() {
  try {
    const res = await fetchWithRetry(`${API}/config`)
    if (!res.ok) return {}
    return res.json()
  } catch { return {} }
}

export async function saveConfig(data: Record<string, string>) {
  const res = await fetchWithRetry(`${API}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.json()
}

export async function getArquivo(q?: string) {
  const url = q
    ? `${API}/arquivo/pesquisar?q=${encodeURIComponent(q)}`
    : `${API}/arquivo`
  const res = await fetchWithRetry(url)
  if (!res.ok) return []
  return res.json()
}

export async function triggerSyncArquivo(): Promise<{ jobId: string }> {
  const res = await fetchWithRetry(`${API}/arquivo/sync`, { method: 'POST' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getSaft() {
  const res = await fetchWithRetry(`${API}/saft`)
  if (!res.ok) return []
  return res.json()
}

export async function getSaftMensal() {
  const res = await fetchWithRetry(`${API}/saft/mensal`)
  if (!res.ok) return []
  return res.json()
}

export async function triggerSyncSaft(): Promise<{ jobId: string }> {
  const res = await fetchWithRetry(`${API}/saft/sync`, { method: 'POST' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
