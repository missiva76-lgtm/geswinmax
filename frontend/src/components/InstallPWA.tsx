import { useState, useEffect } from 'react'
import { Download, X, Share } from 'lucide-react'

// Evento não-standard do Chrome/Edge — não existe nos tipos do TypeScript
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISPENSADO_KEY = 'geswinmax_install_dispensado'

/**
 * Botão próprio de instalação da app (PWA).
 *
 * Porque existe: no Android, o Chrome deixou de mostrar o banner automático de
 * instalação de forma fiável, e a opção no menu (⋮) nem sempre aparece. Este
 * componente captura o evento `beforeinstallprompt` e mostra um botão nosso,
 * que dispara a instalação diretamente.
 *
 * Serve também de diagnóstico: se o Chrome NÃO disparar o evento (ou seja, se
 * não considerar a app instalável), mostramos na mesma um botão que abre
 * instruções manuais — isso confirma-nos que o problema está do lado do
 * browser/dispositivo, e não da configuração do site.
 */
export default function InstallPWA() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [instalada, setInstalada]     = useState(false)
  const [dispensado, setDispensado]   = useState(false)
  const [verInstrucoes, setVerInstr]  = useState(false)

  useEffect(() => {
    // Já está instalada? (a app abre em modo standalone, sem barra do browser)
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as any).standalone === true
    if (standalone) { setInstalada(true); return }

    // O utilizador já dispensou este aviso antes?
    try {
      if (sessionStorage.getItem(DISPENSADO_KEY) === '1') setDispensado(true)
    } catch { /* sessionStorage pode estar bloqueado — segue sem isto */ }

    // CORRIGIDO 28/07/2026: o evento 'beforeinstallprompt' dispara antes do React
    // montar, por isso é capturado por um script no index.html e guardado em
    // window.__pwaInstallPrompt. Aqui lemos o que já foi capturado, e ficamos
    // também à escuta caso ainda venha a disparar.
    const jaCapturado = (window as any).__pwaInstallPrompt as BeforeInstallPromptEvent | null
    if (jaCapturado) setPromptEvent(jaCapturado)

    const onDisponivel = () => {
      const ev = (window as any).__pwaInstallPrompt as BeforeInstallPromptEvent | null
      if (ev) setPromptEvent(ev)
    }
    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setPromptEvent(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalada(true)
      setPromptEvent(null)
      ;(window as any).__pwaInstallPrompt = null
    }

    window.addEventListener('pwa-install-available', onDisponivel)
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('pwa-install-available', onDisponivel)
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const instalar = async () => {
    if (!promptEvent) { setVerInstr(true); return }
    await promptEvent.prompt()
    const escolha = await promptEvent.userChoice.catch(() => ({ outcome: 'dismissed' as const }))
    if (escolha.outcome === 'accepted') setInstalada(true)
    setPromptEvent(null)
    ;(window as any).__pwaInstallPrompt = null
  }

  const dispensar = () => {
    setDispensado(true)
    try { sessionStorage.setItem(DISPENSADO_KEY, '1') } catch { /* ignora */ }
  }

  if (instalada || dispensado) return null

  const podeInstalarDireto = !!promptEvent

  return (
    <>
      {/* Barra fixa no fundo — visível em todos os ecrãs */}
      <div className="fixed bottom-0 left-0 right-0 z-40 md:left-60">
        <div className="m-3 rounded-xl shadow-lg border border-gray-200 bg-white px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#0d7b6b' }}>
            <Download size={17} className="text-white"/>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800">Instalar GesWinmax</p>
            <p className="text-xs text-gray-500">
              {podeInstalarDireto
                ? 'Acesso rápido a partir do ecrã principal'
                : 'Ver como adicionar ao ecrã principal'}
            </p>
          </div>
          <button onClick={instalar}
            className="px-3 py-1.5 text-xs font-medium text-white rounded-lg shrink-0"
            style={{ background: '#0d7b6b' }}>
            {podeInstalarDireto ? 'Instalar' : 'Como?'}
          </button>
          <button onClick={dispensar} className="text-gray-400 hover:text-gray-600 shrink-0" aria-label="Dispensar">
            <X size={16}/>
          </button>
        </div>
      </div>

      {/* Instruções manuais — usado quando o browser não oferece instalação direta */}
      {verInstrucoes && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4"
          onClick={() => setVerInstr(false)}>
          <div className="bg-white rounded-xl max-w-sm w-full p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800">Adicionar ao ecrã principal</h3>
              <button onClick={() => setVerInstr(false)} className="text-gray-400"><X size={16}/></button>
            </div>

            <div className="space-y-3 text-xs text-gray-600">
              <div>
                <p className="font-medium text-gray-700 mb-1">Android (Chrome)</p>
                <p>Toca no menu <strong>⋮</strong> e faz <strong>scroll até ao fim da lista</strong> — a opção costuma estar lá no fundo, com o nome <strong>&quot;Instalar e criar um atalho&quot;</strong> ou <strong>&quot;Adicionar ao ecrã principal&quot;</strong>.</p>
              </div>
              <div>
                <p className="font-medium text-gray-700 mb-1 flex items-center gap-1">iPhone / iPad (Safari) <Share size={12}/></p>
                <p>Toca no ícone <strong>Partilhar</strong> (quadrado com seta) e escolhe <strong>&quot;Adicionar ao ecrã principal&quot;</strong>.</p>
              </div>
              <p className="text-gray-400 pt-1 border-t border-gray-100">
                Se a opção não aparecer, tenta limpar os dados do site nas definições do browser e voltar a abrir.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
