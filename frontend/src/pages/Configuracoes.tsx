import { useState, useEffect } from 'react'
import { Save, Eye, EyeOff } from 'lucide-react'
import { getConfig, saveConfig } from '../services/api'

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
  const [saved, setSaved] = useState(false)
  const [showPass, setShowPass] = useState(false)

  useEffect(() => {
    getConfig().then(c => setConfig(prev => ({ ...prev, ...c }))).catch(() => {})
  }, [])

  const handleSave = async () => {
    await saveConfig(config)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const Campo = ({ label, field, type = 'text', placeholder = '' }: {
    label: string; field: keyof typeof config; type?: string; placeholder?: string
  }) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <div className="relative">
        <input
          type={field === 'password' && !showPass ? 'password' : type}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"
          placeholder={placeholder}
          value={(config as any)[field] || ''}
          onChange={e => setConfig(c => ({ ...c, [field]: e.target.value }))}/>
        {field === 'password' && (
          <button onClick={() => setShowPass(!showPass)}
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

      <div className="space-y-6">
        {/* WinMax4 */}
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <p className="text-sm font-medium text-gray-700 mb-4">Ligação WinMax4</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Campo label="URL base" field="winmax_url" placeholder="https://app102.winmax4.com"/>
            <Campo label="Company code" field="company_code" placeholder="AUTOAVENIDA"/>
            <Campo label="Utilizador" field="utilizador" placeholder="ADMIN"/>
            <Campo label="Password" field="password" placeholder="••••••••"/>
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
                {['FAA','FR','FS','FTB','NCC','GT'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <Campo label="Template PDF (ficheiro .rpx)" field="template_pdf"/>
          </div>
        </div>

        {/* Sync */}
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <p className="text-sm font-medium text-gray-700 mb-4">Sincronização automática</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Campo label="Data de início" field="sync_data_inicio" placeholder="01-01-2000"/>
            <Campo label="Data de fim (vazio = hoje)" field="sync_data_fim" placeholder="DD-MM-YYYY"/>
            <Campo label="Hora da sync diária" field="sync_hora" placeholder="02:00"/>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            A sync importa artigos, existências e movimentos de venda/compra do WinMax4 para esta app.
          </p>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button onClick={handleSave}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
          <Save size={14}/> Guardar configurações
        </button>
        {saved && <span className="text-sm text-green-600">✓ Guardado</span>}
      </div>
    </div>
  )
}
