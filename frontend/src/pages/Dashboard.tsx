import { useState, useEffect } from 'react'
import { FileSpreadsheet, Package, RefreshCw, AlertCircle, CheckCircle, Clock, BarChart2, Archive, Database, Link } from 'lucide-react'
import { getJobs, getFaturas, getArtigos, getArquivo, getSaft } from '../services/api'
import { Job, FaturaResultado } from '../types'

function Stat({ label, value, cor }: { label: string; value: string | number; cor?: string }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${cor || 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

// Converte timestamp Firestore (seconds ou _seconds) para Date
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

export default function Dashboard() {
  const [jobs, setJobs]       = useState<Job[]>([])
  const [faturas, setFaturas] = useState<FaturaResultado[]>([])
  const [loading, setLoading] = useState(true)
  const [modulos, setModulos] = useState({
    artigos: 0, arquivo: 0, saft: 0
  })

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
    const hoje = new Date()
    return d.toDateString() === hoje.toDateString()
  }).length

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Dashboard</h2>
          <p className="text-sm text-gray-400">GesWinmax — AUTOAVENIDA</p>
        </div>
        <button onClick={carregar} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''}/>
          Atualizar
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Faturas emitidas" value={emitidas} cor="text-green-600"/>
        <Stat label="Com erro"         value={erros}    cor={erros > 0 ? 'text-red-500' : 'text-gray-900'}/>
        <Stat label="Jobs hoje"        value={jobsHoje}/>
        <Stat label="Última sync"      value={ultimaSync ? fmtDate(ultimaSync.criado_em, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'}/>
      </div>

      {/* Indicadores de módulos */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-purple-50 rounded-lg"><Database size={16} className="text-purple-500"/></div>
          <div>
            <p className="text-xs text-gray-500">Dados WinMax4</p>
            <p className="text-lg font-semibold text-gray-800">{modulos.artigos > 0 ? `${modulos.artigos} artigos` : '—'}</p>
            <p className="text-xs text-gray-400">{modulos.artigos > 0 ? '✅ Sincronizado' : '⚠️ Sem dados'}</p>
          </div>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-lg"><Archive size={16} className="text-blue-500"/></div>
          <div>
            <p className="text-xs text-gray-500">Arquivo Digital</p>
            <p className="text-lg font-semibold text-gray-800">{modulos.arquivo > 0 ? `${modulos.arquivo} docs` : '—'}</p>
            <p className="text-xs text-gray-400">{modulos.arquivo > 0 ? '✅ Importado' : '⚠️ Sem dados'}</p>
          </div>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-orange-50 rounded-lg"><BarChart2 size={16} className="text-orange-500"/></div>
          <div>
            <p className="text-xs text-gray-500">SAF-T</p>
            <p className="text-lg font-semibold text-gray-800">{modulos.saft > 0 ? `${modulos.saft} registos` : '—'}</p>
            <p className="text-xs text-gray-400">{modulos.saft > 0 ? '✅ Importado' : '⚠️ Sem dados'}</p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl">
        <div className="px-5 py-3.5 border-b border-gray-50">
          <p className="text-sm font-medium text-gray-700">Jobs recentes</p>
        </div>
        {loading && (
          <p className="px-5 py-8 text-sm text-gray-400 text-center">A carregar...</p>
        )}
        {!loading && jobs.length === 0 && (
          <p className="px-5 py-8 text-sm text-gray-400 text-center">Sem jobs ainda</p>
        )}
        {jobs.slice(0, 15).map((job) => (
          <div key={job.id} className="flex items-center gap-3 px-5 py-3 border-b border-gray-50 last:border-0">
            {job.tipo === 'emissao' && <FileSpreadsheet size={14} className="text-blue-400 shrink-0"/>}
            {job.tipo === 'sync'    && <Package         size={14} className="text-purple-400 shrink-0"/>}
            {job.tipo === 'saft'    && <BarChart2       size={14} className="text-orange-400 shrink-0"/>}
            {!['emissao','sync','saft'].includes(job.tipo) && <Package size={14} className="text-gray-400 shrink-0"/>}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-800">{TIPO_LABEL[job.tipo] || job.tipo}</p>
              <p className="text-xs text-gray-400">{fmtDate(job.criado_em)}</p>
            </div>
            {job.estado === 'concluido' && <CheckCircle size={14} className="text-green-500"/>}
            {job.estado === 'erro'      && <AlertCircle size={14} className="text-red-500"/>}
            {job.estado === 'ativo'     && <Clock       size={14} className="text-blue-500 animate-pulse"/>}
            <span className={`text-xs px-2 py-0.5 rounded-full
              ${job.estado === 'concluido' ? 'bg-green-50 text-green-700' :
                job.estado === 'erro'      ? 'bg-red-50 text-red-600'     :
                job.estado === 'ativo'     ? 'bg-blue-50 text-blue-600'   :
                                            'bg-gray-50 text-gray-600'}`}>
              {job.estado}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
