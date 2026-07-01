import { useState, useEffect } from 'react'
import { Save, Eye, EyeOff, Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import { getConfig, saveConfig } from '../services/api'

const API = import.meta.env.VITE_API_URL || '/api'

interface TipoDoc {
  codigo: string
  descricao: string
  valor: string
}

function SyncButton() {
  const [estado, setEstado] = useState<'idle'|'running'|'done'|'erro'>('idle')
  const [msg, setMsg] = useState('')

  const handleSync = async () => {
    if (!confirm('Confirmas a sincronização completa? Todos os dados serão apagados e reimportados do WinMax4.')) return
    setEstado('running')
    setMsg('A iniciar sync...')
    try {
      const r = await fetch(`${API}/jobs/sync?force=true`, { method: 'POST' }).then(res => res.json())
      const jobId = r?.jobId
      if (!jobId) throw new Error('Sem jobId')
      setMsg('Sync em curso...')
      const poll = async (n = 0): Promise<void> => {
        if (n > 120) { setEstado('erro'); setMsg('Timeout — verifica o Dashboard'); return }
        const job = await fetch(`${API}/jobs/${jobId}`).then(res => res.json()).catch(() => null)
        if (job?.estado === 'concluido') { setEstado('done'); setMsg('✅ Sync concluída com sucesso!'); return }
        if (job?.estado === 'erro') { setEstado('erro'); setMsg('❌ Erro na sync — verifica o Dashboard'); return }
        setMsg(`Em curso... (${Math.round(n * 3)}s)`)
        setTimeout(() => poll(n + 1), 3000)
      }
      poll()
    } catch(e: any) {
      setEstado('erro')
      setMsg('Erro: ' + e.message)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button onClick={handleSync} disabled={estado === 'running'}
        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white transition-all disabled:opacity-50
          ${estado === 'done' ? 'bg-green-600' : estado === 'erro' ? 'bg-red-600' : 'bg-amber-600 hover:bg-amber-700'}`}>
        {estado === 'running' ? (
          <><span className="animate-spin">⟳</span> A sincronizar...</>
        ) : estado === 'done' ? (
          <>✓ Sync concluída</>
        ) : (
          <>🔄 Sync Completo Agora</>
        )}
      </button>
      {msg && <span className={`text-xs ${estado === 'erro' ? 'text-red-600' : estado === 'done' ? 'text-green-600' : 'text-amber-600'}`}>{msg}</span>}
    </div>
  )
}

export default function Configuracoes() {
  const [config, setConfig] = useState({
    winmax_url: 'https://app102.winmax4.com',
    company_code: 'AUTOAVENIDA',
    utilizador: '',
    password: '',
    template_pdf: '5046\\Auto_avenida233.rpx',
    tipo_documento_default: 'FAA',
    sync_data_inicio: '01-01-2000',
    sync_data_fim: '',
    sync_hora: '02:00',
  })
  const [tipos, setTipos]   = useState<TipoDoc[]>([])
  const [saved, setSaved]   = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [editIdx, setEditIdx]   = useState<number | null>(null)
  const [novoTipo, setNovoTipo] = useState<TipoDoc>({ codigo: '', descricao: '', valor: '' })
  const [adicionando, setAdicionando] = useState(false)

  useEffect(() => {
    getConfig().then(c => {
      setConfig(prev => ({ ...prev, ...c }))
      if (c.tipos_documento) setTipos(c.tipos_documento)
      else setTipos([
        { codigo: 'FAA', descricao: 'Fatura a Clientes',   valor: '37' },
        { codigo: 'FR',  descricao: 'Fatura Recibo',       valor: '55' },
        { codigo: 'FS',  descricao: 'Fatura Simplificada', valor: '46' },
        { codigo: 'FTB', descricao: 'Fat Recibo B',        valor: '45' },
        { codigo: 'NCC', descricao: 'Nota de Crédito',     valor: '40' },
        { codigo: 'GT',  descricao: 'Guia de Transporte',  valor: '49' },
      ])
    }).catch(() => {})
  }, [])

  const handleSave = async () => {
    // Não envia password se estiver vazia (preserva a password já guardada)
    const dados: any = { ...config, tipos_documento: tipos }
    if (!dados.password) delete dados.password
    await saveConfig(dados)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const eliminarTipo = (idx: number) => setTipos(t => t.filter((_, i) => i !== idx))

  const guardarEdicao = (idx: number, novo: TipoDoc) => {
    setTipos(t => t.map((item, i) => i === idx ? novo : item))
    setEditIdx(null)
  }

  const adicionarTipo = () => {
    if (!novoTipo.codigo || !novoTipo.valor) return
    setTipos(t => [...t, novoTipo])
    setNovoTipo({ codigo: '', descricao: '', valor: '' })
    setAdicionando(false)
  }

  const handleChange = (field: string, value: string) => {
    setConfig(prev => ({ ...prev, [field]: value }))
  }

  const Campo = ({ label, field, type = 'text', placeholder = '' }: {
    label: string; field: string; type?: string; placeholder?: string
  }) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <div className="relative">
        <input
          type={field === 'password' && !showPass ? 'password' : type}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"
          placeholder={placeholder}
          value={(config as any)[field] ?? ''}
          onChange={e => handleChange(field, e.target.value)}
          autoComplete={field === 'password' ? 'new-password' : 'off'}/>
        {field === 'password' && (
          <button type="button" onClick={() => setShowPass(!showPass)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400">
            {showPass ? <EyeOff size={14}/> : <Eye size={14}/>}
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-6">Configurações</h2>
      <p className="text-xs text-gray-300 mb-4">v20260620.1201</p>
      <div className="space-y-6">

        {/* WinMax4 */}
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <p className="text-sm font-medium text-gray-700 mb-4">Ligação WinMax4</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Campo label="URL base" field="winmax_url" placeholder="https://app102.winmax4.com"/>
            <Campo label="Company code" field="company_code" placeholder="AUTOAVENIDA"/>
            <Campo label="Utilizador" field="utilizador" placeholder="ADMIN"/>
            <Campo label="Password (deixa vazio para manter)" field="password" placeholder="Nova password (opcional)"/>
          </div>
        </div>

        {/* Faturação */}
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <p className="text-sm font-medium text-gray-700 mb-4">Faturação</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tipo de documento padrão</label>
              <select
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none"
                value={config.tipo_documento_default}
                onChange={e => setConfig(c => ({ ...c, tipo_documento_default: e.target.value }))}>
                {tipos.map(t => <option key={t.codigo} value={t.codigo}>{t.codigo} — {t.descricao}</option>)}
              </select>
            </div>
            <Campo label="Template PDF (.rpx)" field="template_pdf"/>
          </div>
        </div>

        {/* Tipos de Documento */}
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-medium text-gray-700">Tipos de documento</p>
            <button onClick={() => setAdicionando(true)}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
              <Plus size={13}/> Adicionar
            </button>
          </div>

          <div className="space-y-1">
            {tipos.map((t, idx) => (
              <div key={idx} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 bg-gray-50">
                {editIdx === idx ? (
                  <>
                    <input className="w-16 px-2 py-1 text-xs border border-gray-200 rounded"
                      value={t.codigo} onChange={e => setTipos(ts => ts.map((x, i) => i === idx ? { ...x, codigo: e.target.value } : x))}/>
                    <input className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded"
                      value={t.descricao} onChange={e => setTipos(ts => ts.map((x, i) => i === idx ? { ...x, descricao: e.target.value } : x))}/>
                    <input className="w-16 px-2 py-1 text-xs border border-gray-200 rounded"
                      value={t.valor} placeholder="valor WinMax" onChange={e => setTipos(ts => ts.map((x, i) => i === idx ? { ...x, valor: e.target.value } : x))}/>
                    <button onClick={() => setEditIdx(null)} className="text-green-600"><Check size={13}/></button>
                    <button onClick={() => setEditIdx(null)} className="text-gray-400"><X size={13}/></button>
                  </>
                ) : (
                  <>
                    <span className="w-12 text-xs font-mono font-medium text-gray-700">{t.codigo}</span>
                    <span className="flex-1 text-xs text-gray-600">{t.descricao}</span>
                    <span className="text-xs text-gray-400 font-mono">val:{t.valor}</span>
                    <button onClick={() => setEditIdx(idx)} className="text-gray-400 hover:text-blue-600"><Pencil size={12}/></button>
                    <button onClick={() => eliminarTipo(idx)} className="text-gray-400 hover:text-red-500"><Trash2 size={12}/></button>
                  </>
                )}
              </div>
            ))}

            {adicionando && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-200 bg-blue-50">
                <input className="w-16 px-2 py-1 text-xs border border-gray-200 rounded"
                  placeholder="Código" value={novoTipo.codigo}
                  onChange={e => setNovoTipo(n => ({ ...n, codigo: e.target.value.toUpperCase() }))}/>
                <input className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded"
                  placeholder="Descrição" value={novoTipo.descricao}
                  onChange={e => setNovoTipo(n => ({ ...n, descricao: e.target.value }))}/>
                <input className="w-20 px-2 py-1 text-xs border border-gray-200 rounded"
                  placeholder="Val. WinMax" value={novoTipo.valor}
                  onChange={e => setNovoTipo(n => ({ ...n, valor: e.target.value }))}/>
                <button onClick={adicionarTipo} className="text-green-600"><Check size={13}/></button>
                <button onClick={() => setAdicionando(false)} className="text-gray-400"><X size={13}/></button>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-2">O "Val. WinMax" é o valor interno do WinMax4 para este tipo de documento.</p>
        </div>

        {/* Sync */}
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <p className="text-sm font-medium text-gray-700 mb-4">Sincronização automática</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Campo label="Data de início" field="sync_data_inicio" placeholder="01-01-2000"/>
            <Campo label="Data de fim (vazio = hoje)" field="sync_data_fim" placeholder="DD-MM-YYYY"/>
            <Campo label="Hora da sync diária" field="sync_hora" placeholder="02:00"/>
          </div>
        </div>
      </div>

      {/* Sync Completo */}
      <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-5">
        <p className="text-sm font-semibold text-amber-800 mb-1">🔄 Sincronização Completa</p>
        <p className="text-xs text-amber-600 mb-4">
          Limpa todos os dados existentes (artigos, movimentos) e reimporta tudo do WinMax4 desde a data de início configurada acima. 
          Pode demorar 3-5 minutos.
        </p>
        <div className="flex items-center gap-3">
          <SyncButton/>
          <span className="text-xs text-amber-500">Use quando os dados parecerem incorretos ou desatualizados</span>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button onClick={handleSave}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
          <Save size={14}/> Guardar configurações
        </button>
        {saved && <span className="text-sm text-green-600">✓ Guardado</span>}
      </div>
    </div>
  )
}
