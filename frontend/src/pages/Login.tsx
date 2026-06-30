import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth, signInWithEmailAndPassword } from '../services/firebase'

export default function Login() {
  const [email, setEmail]     = useState('')
  const [pass, setPass]       = useState('')
  const [erro, setErro]       = useState('')
  const [loading, setLoading] = useState(false)
  const navigate              = useNavigate()

  const login = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro('')
    setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email, pass)
      navigate('/', { replace: true })
    } catch (err: any) {
      const codigo = err?.code || ''
      if (codigo === 'auth/user-not-found' || codigo === 'auth/wrong-password' || codigo === 'auth/invalid-credential') {
        setErro('Email ou password incorretos')
      } else if (codigo === 'auth/too-many-requests') {
        setErro('Demasiadas tentativas. Tenta mais tarde.')
      } else if (codigo === 'auth/network-request-failed') {
        setErro('Erro de rede. Verifica a ligação.')
      } else {
        setErro(`Erro: ${err?.message || codigo}`)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'linear-gradient(135deg, #f0fdf4 0%, #e0f2f1 100%)' }}>
      <div className="w-full max-w-sm">

        {/* Logo e cabeçalho */}
        <div className="text-center mb-8">
          {/* Logo card */}
          <div className="inline-flex items-center gap-3 bg-white rounded-2xl px-6 py-4 shadow-md border border-teal-100 mb-6">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: '#0d7b6b' }}>
              {/* Ícone camião/assistência */}
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="3" width="15" height="13" rx="1"/>
                <path d="M16 8h4l3 5v3h-7V8z"/>
                <circle cx="5.5" cy="18.5" r="2.5"/>
                <circle cx="18.5" cy="18.5" r="2.5"/>
              </svg>
            </div>
            <div className="text-left">
              <p className="text-xl font-black text-gray-900 tracking-tight">
                AMG<span style={{ color: '#0d7b6b' }}>24</span>
              </p>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-widest">GesWinmax</p>
            </div>
          </div>

          <h1 className="text-xl font-black text-gray-800 uppercase tracking-wide">AMG24 - Assistência Automóvel</h1>
          <p className="text-sm text-gray-500 mt-1">Acesso Restrito ao Sistema AMG</p>
        </div>

        {/* Formulário */}
        <div className="bg-white rounded-2xl p-8 shadow-lg border border-gray-100">
          <form onSubmit={login} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wide">Email</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 transition-all"
                style={{ '--tw-ring-color': '#0d7b6b' } as any}/>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wide">Password</label>
              <input type="password" required value={pass} onChange={e => setPass(e.target.value)}
                autoComplete="current-password"
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 transition-all"/>
            </div>
            {erro && (
              <p className="text-xs text-red-600 bg-red-50 px-4 py-2.5 rounded-xl border border-red-100">{erro}</p>
            )}
            <button type="submit" disabled={loading}
              className="w-full py-3 text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-all uppercase tracking-wide shadow-sm hover:shadow-md"
              style={{ background: loading ? '#6b7280' : '#0d7b6b' }}>
              {loading ? 'A entrar...' : 'Entrar'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">GesWinmax — Sistema de Gestão AMG24</p>
      </div>
    </div>
  )
}
