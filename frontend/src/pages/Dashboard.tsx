import { useState, useEffect } from 'react'
import { FileSpreadsheet, Package, RefreshCw, AlertCircle, CheckCircle, Clock } from 'lucide-react'
import { getJobs, getFaturas, triggerSync } from '../services/api'
import { Job, FaturaResultado } from '../types'

function Stat({ label, value, cor }: { label: string; value: string | number; cor?: string }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${cor || 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

export default function Dashboard() {
  const [jobs, setJobs]     = useState<Job[]>([])
  const [faturas, setFaturas] = useState<FaturaResultado[]>([])
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    getJobs().then(setJobs).catch(() => {})
    getFaturas().then(setFaturas).catch(() => {})
  }, [])

  const emitidas = faturas.filter(f => f.sucesso).length
  const erros    = faturas.filter(f => !f.sucesso).length
  const ultimaSync = jobs.find(j => j.tipo === 'sync' && j.estado === 'concluido')

  const handleSync = async () => {
    setSyncing(true)
    await triggerSync().catch(() => {})
    setTimeout(() => setSyncing(false), 3000)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Dashboard</h2>
          <p className="text-sm text-gray-400">GesWinmax — AUTOAVENIDA</p>
        </div>
        <button onClick={handleSync} disabled={syncing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
          <RefreshCw size={13} className={syncing ? 'animate-spin' : ''}/>
          {syncing ? 'A sincronizar...' : 'Sincronizar agora'}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Faturas emitidas" value={emitidas} cor="text-green-600"/>
        <Stat label="Com erro" value={erros} cor={erros > 0 ? 'text-red-500' : 'text-gray-900'}/>
        <Stat label="Jobs executados" value={jobs.length}/>
        <Stat label="Última sync"
          value={ultimaSync
            ? new Date((ultimaSync.criado_em?.seconds || 0) * 1000).toLocaleDateString('pt-PT')
            : '—'}/>
      </div>

      {/* Jobs recentes */}
      <div className="bg-white border border-gray-100 rounded-xl">
        <div className="px-5 py-3.5 border-b border-gray-50">
          <p className="text-sm font-medium text-gray-700">Jobs recentes</p>
        </div>
        {jobs.length === 0 && (
          <p className="px-5 py-8 text-sm text-gray-400 text-center">Sem jobs ainda</p>
        )}
        {jobs.slice(0, 10).map((job) => (
          <div key={job.id} className="flex items-center gap-3 px-5 py-3 border-b border-gray-50 last:border-0">
            {job.tipo === 'emissao' && <FileSpreadsheet size={14} className="text-blue-400 shrink-0"/>}
            {job.tipo === 'sync'    && <Package         size={14} className="text-purple-400 shrink-0"/>}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-800 capitalize">{job.tipo}</p>
              <p className="text-xs text-gray-400">
                {new Date((job.criado_em?.seconds || 0) * 1000).toLocaleString('pt-PT')}
              </p>
            </div>
            {job.estado === 'concluido' && <CheckCircle size={14} className="text-green-500"/>}
            {job.estado === 'erro'      && <AlertCircle size={14} className="text-red-500"/>}
            {job.estado === 'ativo'     && <Clock       size={14} className="text-blue-500"/>}
            <span className={`text-xs px-2 py-0.5 rounded-full
              ${job.estado === 'concluido' ? 'bg-green-50 text-green-700' :
                job.estado === 'erro'      ? 'bg-red-50 text-red-600' :
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
