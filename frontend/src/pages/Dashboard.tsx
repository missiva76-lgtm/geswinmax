import { useState, useEffect } from 'react'
import { FileSpreadsheet, Package, RefreshCw, AlertCircle, CheckCircle, Clock, BarChart2, Archive, Database } from 'lucide-react'
import { getJobs, getFaturas, getArtigos, getArquivo, getSaft } from '../services/api'
import { Job, FaturaResultado } from '../types'

function tsToDate(ts: any): Date | null {
  if (!ts) return null
  const secs = ts.seconds ?? ts._seconds ?? ts
  if (!secs || secs === 0) return null
  return new Date(secs * 1000)
}

function fmtDate(ts: any, opts?: Intl.DateTimeFormatOptions): string {
  const d = tsToDate(ts)
  if (!d) return '—'
  return d.toLocaleString('pt-PT', opts || { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const TIPO_LABEL: Record<string, string> = {
  emissao: 'Emissão',
  sync:    'Sync WinMax4',
  saft:    'SAF-T',
  arquivo: 'Arquivo Digital',
}

const TIPO_COR: Record<string, string> = {
  emissao: 'bg-blue-100 text-blue-700',
  sync:    'bg-teal-100 text-teal-700',
  saft:    'bg-orange-100 text-orange-700',
  arquivo: 'bg-purple-100 text-purple-700',
}

export default function Dashboard() {
  const [jobs, setJobs]       = useState<Job[]>([])
  const [faturas, setFaturas] = useState<FaturaResultado[]>([])
  const [loading, setLoading] = useState(true)
  const [modulos, setModulos] = useState({ artigos: 0, arquivo: 0, saft: 0 })

  const carregar = async () => {
    setLoading(true)
    await Promise.all([
      getJobs().then(setJobs).catch(() => {}),
      getFaturas().then(setFaturas).catch(() => {}),
      getArtigos().then(r => setModulos(m => ({ ...m, artigos: Array.isArray(r) ? r.length : 0 }))).catch(() => {}),
      getArquivo().then(r => setModulos(m => ({ ...m, arquivo: Array.isArray(r) ? r.length : 0 }))).catch(() => {}),
      getSaft().then(r => setModulos(m => ({ ...m, saft: Array.isArray(r) ? r.length : 0 }))).catch(() => {}),
    ])
    setLoading(false)
  }

  useEffect(() => { carregar() }, [])

  const emitidas   = faturas.filter(f => f.sucesso).length
  const erros      = faturas.filter(f => !f.sucesso).length
  const ultimaSync = jobs.find(j => j.tipo === 'sync' && j.estado === 'concluido')
  const jobsHoje   = jobs.filter(j => {
    const d = tsToDate(j.criado_em)
    if (!d) return false
    return d.toDateString() === new Date().toDateString()
  }).length

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 uppercase tracking-wide">Dashboard</h2>
          <p className="text-sm text-gray-400 mt-0.5">GesWinmax — AUTOAVENIDA</p>
        </div>
        <button onClick={carregar} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-all"
          style={{ background: '#0d7b6b' }}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''}/>
          Atualizar
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Faturas emitidas', value: emitidas, cor: '#0d7b6b', bg: '#f0fdf4' },
          { label: 'Com erro',         value: erros,    cor: erros > 0 ? '#dc2626' : '#6b7280', bg: erros > 0 ? '#fef2f2' : '#f9fafb' },
          { label: 'Jobs hoje',        value: jobsHoje, cor: '#2563eb', bg: '#eff6ff' },
          { label: 'Última sync',      value: ultimaSync ? fmtDate(ultimaSync.criado_em, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—', cor: '#7c3aed', bg: '#f5f3ff' },
        ].map((s, i) => (
          <div key={i} className="rounded-xl p-4 border" style={{ background: s.bg, borderColor: s.cor + '30' }}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{s.label}</p>
            <p className="text-2xl font-bold" style={{ color: s.cor }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Módulos */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Dados WinMax4', icon: Database, valor: modulos.artigos > 0 ? `${modulos.artigos} artigos` : '—', ok: modulos.artigos > 0, cor: '#7c3aed' },
          { label: 'Arquivo Digital', icon: Archive, valor: modulos.arquivo > 0 ? `${modulos.arquivo} docs` : '—', ok: modulos.arquivo > 0, cor: '#2563eb' },
          { label: 'SAF-T', icon: BarChart2, valor: modulos.saft > 0 ? `${modulos.saft} registos` : '—', ok: modulos.saft > 0, cor: '#d97706' },
        ].map((m, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-3 shadow-sm">
            <div className="p-2.5 rounded-xl" style={{ background: m.cor + '15' }}>
              <m.icon size={18} style={{ color: m.cor }}/>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{m.label}</p>
              <p className="text-base font-bold text-gray-800">{m.valor}</p>
              <p className="text-xs mt-0.5" style={{ color: m.ok ? '#0d7b6b' : '#d97706' }}>
                {m.ok ? '✓ Sincronizado' : '⚠ Sem dados'}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Jobs recentes */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-50 flex items-center justify-between">
          <p className="text-sm font-bold uppercase tracking-wide text-gray-700">Jobs recentes</p>
          <span className="text-xs text-gray-400">{jobs.length} total</span>
        </div>
        {loading && <p className="px-5 py-8 text-sm text-gray-400 text-center">A carregar...</p>}
        {!loading && jobs.length === 0 && <p className="px-5 py-8 text-sm text-gray-400 text-center">Sem jobs ainda</p>}
        {(() => {
          const seen: Record<string, number> = {}
          return jobs.filter(j => { seen[j.tipo] = (seen[j.tipo]||0)+1; return seen[j.tipo] <= 2 })
        })().map((job) => (
          <div key={job.id} className="flex items-center gap-3 px-5 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${TIPO_COR[job.tipo] || 'bg-gray-100 text-gray-600'}`}>
              {TIPO_LABEL[job.tipo] || job.tipo}
            </span>
            <p className="flex-1 text-xs text-gray-500">{fmtDate(job.criado_em)}</p>
            {job.estado === 'concluido' && <CheckCircle size={15} className="text-teal-500"/>}
            {job.estado === 'erro'      && <AlertCircle size={15} className="text-red-500"/>}
            {job.estado === 'ativo'     && <Clock       size={15} className="text-blue-500 animate-pulse"/>}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium
              ${job.estado === 'concluido' ? 'bg-teal-50 text-teal-700' :
                job.estado === 'erro'      ? 'bg-red-50 text-red-600'   :
                job.estado === 'ativo'     ? 'bg-blue-50 text-blue-600' :
                                            'bg-gray-50 text-gray-600'}`}>
              {job.estado}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
