// services/jobsWatchdog.ts — fecha jobs que ficaram pendurados em "ativo"
//
// PORQUE EXISTE (30/09/2026)
// --------------------------
// Um job só sai do estado "ativo" quando o próprio processo grava "concluido" ou
// "erro". Se o processo for congelado ou morto a meio (ver services/keepAlive.ts),
// ninguém grava nada e o job fica "ativo" para sempre — foi o que aconteceu aos 4
// jobs programados de 29/09/2026. No Dashboard isso aparece como se ainda
// estivesse a correr, o que é pior do que um erro: esconde a falha.
//
// Esta guarda corre no arranque do backend e depois a cada 30 minutos: qualquer
// job "ativo" (ou "pendente") sem atualização há mais de 2 horas passa a
// "interrompido", com a explicação no campo `erro_geral`.
//
// Nota sobre o limite de 2 horas: a sincronização completa mais longa observada
// em produção levou cerca de 10 minutos, e a importação de documentos emitidos
// (9253 documentos) ficou bem abaixo de uma hora. Duas horas dá margem larga
// para não fechar nada que ainda esteja legitimamente a trabalhar.
import * as admin from 'firebase-admin'
import { db } from './firebase'
import { logger } from './logger'

const LIMITE_MS = 2 * 60 * 60 * 1000
const INTERVALO_MS = 30 * 60 * 1000

/** Converte os vários formatos de timestamp que aparecem nos documentos. */
function msDe(valor: any): number | null {
  if (!valor) return null
  if (typeof valor.toMillis === 'function') return valor.toMillis()
  const s = valor._seconds ?? valor.seconds
  return typeof s === 'number' ? s * 1000 : null
}

export async function fecharJobsPendurados(): Promise<number> {
  try {
    // Consulta por um único campo — não precisa de índice composto.
    const snap = await db().collection('jobs').where('estado', 'in', ['ativo', 'pendente']).get()
    const agora = Date.now()
    let fechados = 0

    for (const doc of snap.docs) {
      const d = doc.data() as any
      const referencia = msDe(d.atualizado_em) ?? msDe(d.criado_em)
      // Sem timestamp não há forma de saber a idade — deixa-se em paz.
      if (referencia === null) continue
      const idadeMin = Math.round((agora - referencia) / 60000)
      if (agora - referencia < LIMITE_MS) continue

      await doc.ref.update({
        estado: 'interrompido',
        erro_geral: `Job interrompido — sem atividade há ${idadeMin} min. `
          + 'O processo do backend foi suspenso ou terminado antes de concluir '
          + '(ver logs do Render nessa hora).',
        concluido_em: admin.firestore.FieldValue.serverTimestamp(),
        atualizado_em: admin.firestore.FieldValue.serverTimestamp(),
      })
      fechados++
      logger.warn(`[watchdog] job ${doc.id} (${d.tipo}) marcado como interrompido — ${idadeMin} min sem atividade`)
    }

    if (fechados === 0) logger.info('[watchdog] sem jobs pendurados')
    return fechados
  } catch (e) {
    // Nunca deve impedir o arranque do backend.
    logger.error(`[watchdog] falhou: ${e}`)
    return 0
  }
}

export function iniciarWatchdog() {
  void fecharJobsPendurados()
  setInterval(() => { void fecharJobsPendurados() }, INTERVALO_MS)
  logger.info('[watchdog] ativo — verificação no arranque e a cada 30 min')
}
