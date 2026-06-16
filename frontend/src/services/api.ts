const API = import.meta.env.VITE_API_URL || '/api'

export async function uploadExcel(file: File): Promise<{ jobId: string }> {
  const fd = new FormData()
  fd.append('excel', file)
  const res = await fetch(`${API}/jobs/emissao`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getJob(jobId: string) {
  const res = await fetch(`${API}/jobs/${jobId}`)
  return res.json()
}

export async function getJobs() {
  const res = await fetch(`${API}/jobs`)
  return res.json()
}

export async function triggerSync(): Promise<{ jobId: string }> {
  const res = await fetch(`${API}/jobs/sync`, { method: 'POST' })
  return res.json()
}

export async function getArtigos(q?: string) {
  const url = q ? `${API}/artigos?q=${encodeURIComponent(q)}` : `${API}/artigos`
  const res = await fetch(url)
  return res.json()
}

export async function getFaturas(filtros?: { cliente?: string; sucesso?: boolean }) {
  const params = new URLSearchParams()
  if (filtros?.cliente)            params.set('cliente', filtros.cliente)
  if (filtros?.sucesso !== undefined) params.set('sucesso', String(filtros.sucesso))
  const res = await fetch(`${API}/faturas?${params}`)
  return res.json()
}

export async function getConfig() {
  const res = await fetch(`${API}/config`)
  return res.json()
}

export async function saveConfig(data: Record<string, string>) {
  const res = await fetch(`${API}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.json()
}
