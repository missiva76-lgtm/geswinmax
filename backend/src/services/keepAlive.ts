// services/keepAlive.ts — mantém a instância do Render acordada enquanto há trabalho
//
// PROBLEMA QUE ISTO RESOLVE (diagnosticado em 30/09/2026)
// -------------------------------------------------------
// No plano gratuito do Render a instância é suspensa após ~15 minutos SEM
// pedidos HTTP de entrada. As sincronizações programadas eram arrancadas por um
// pedido do cron (cron-job.org), o backend respondia de imediato e continuava o
// trabalho em segundo plano — a partir daí não entrava mais nenhum pedido, pelo
// que a instância era suspensa com o job a meio.
//
// O sintoma era inequívoco: o job ficava eternamente em "ativo", com UMA única
// linha de log (a inicial) e sem erro nenhum, porque o processo era congelado
// antes de escrever qualquer outra coisa. Verificado em 29/09/2026 nos 4 jobs
// programados. Não era falta de memória (nenhum evento "Out of memory" no
// Render) nem o Firestore (escritas a 0% da cota, pico de 10/dia = criação dos
// jobs + 1 linha de log cada).
//
// Nas sincronizações MANUAIS o problema nunca apareceu porque o browser do
// utilizador consulta a API a cada poucos segundos — esse tráfego é que mantinha
// a instância acordada.
//
// COMO FUNCIONA
// -------------
// Enquanto existir pelo menos um trabalho registado, o backend faz um pedido ao
// seu PRÓPRIO URL público a cada 5 minutos. Esse pedido entra pelo edge do
// Render, conta como tráfego de entrada e impede a suspensão. Quando o último
// trabalho termina, os pings param — logo não se gastam horas de plano fora das
// janelas de sincronização.
import { logger } from './logger'

const INTERVALO_MS = 5 * 60 * 1000

/** Contador de trabalhos em curso (pode haver mais de um em teoria). */
let emCurso = new Set<string>()
let timer: NodeJS.Timeout | null = null

/**
 * URL público do próprio serviço. No Render a variável RENDER_EXTERNAL_URL é
 * definida automaticamente; BACKEND_URL serve de alternativa manual.
 */
function urlProprio(): string | null {
  const url = process.env.RENDER_EXTERNAL_URL || process.env.BACKEND_URL || ''
  return url.startsWith('http') ? url.replace(/\/+$/, '') : null
}

async function ping() {
  const base = urlProprio()
  if (!base) return
  try {
    const r = await fetch(`${base}/health`, { method: 'GET' })
    logger.info(`[keepAlive] ping ${base}/health → ${r.status} (trabalhos em curso: ${emCurso.size})`)
  } catch (e) {
    // Um ping falhado não é grave — o objetivo é apenas gerar tráfego.
    logger.warn(`[keepAlive] ping falhou: ${e}`)
  }
}

/** Registar o início de um trabalho longo. Devolve o id usado, para conveniência. */
export function keepAliveInicio(tag: string): string {
  const id = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  emCurso.add(id)
  if (!timer) {
    const base = urlProprio()
    if (!base) {
      logger.warn('[keepAlive] RENDER_EXTERNAL_URL/BACKEND_URL não definido — keep-alive INATIVO')
    } else {
      logger.info(`[keepAlive] ativado (${tag}) — ping a cada 5 min a ${base}/health`)
    }
    timer = setInterval(ping, INTERVALO_MS)
    // Um ping imediato marca o arranque nos logs do Render, útil no diagnóstico.
    void ping()
  }
  return id
}

/** Registar o fim de um trabalho longo. Para os pings quando já não há nenhum. */
export function keepAliveFim(id: string) {
  emCurso.delete(id)
  if (emCurso.size === 0 && timer) {
    clearInterval(timer)
    timer = null
    logger.info('[keepAlive] desativado — sem trabalhos em curso')
  }
}

/**
 * Envolve uma promessa de trabalho longo com o keep-alive, garantindo que os
 * pings param mesmo quando o trabalho falha.
 */
export async function comKeepAlive<T>(tag: string, fn: () => Promise<T>): Promise<T> {
  const id = keepAliveInicio(tag)
  try {
    return await fn()
  } finally {
    keepAliveFim(id)
  }
}

/** Para uso em diagnósticos. */
export function keepAliveEstado() {
  return { ativo: !!timer, trabalhos: emCurso.size, url: urlProprio() }
}
