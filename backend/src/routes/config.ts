import { Router, Request, Response } from 'express'
import { db } from '../services/firebase'
import { TIPOS_DOCUMENTO } from '../rpa/winmaxRPA'

const router = Router()

// GET /api/config
router.get('/', async (_req: Request, res: Response) => {
  try {
    const doc = await db().collection('config').doc('winmax').get()
    const data = doc.exists ? doc.data() as Record<string, any> : {}
    const { password: _, ...safe } = data
    // CORRIGIDO 19/08/2026: havia TRÊS listas de tipos de documento desalinhadas —
    // esta (8 tipos), a do frontend (6, sem FRB) e a TIPO_DOC do winmaxRPA (17, a
    // única que o robô usa de facto ao emitir). Passa a existir uma fonte única:
    // TIPOS_DOCUMENTO em rpa/winmaxRPA.ts.
    //
    // Além disso, os defaults só se aplicavam quando NADA estava gravado. Como já
    // havia configuração guardada com a lista antiga, os tipos novos nunca
    // apareciam. Agora acrescentam-se ao que está gravado os que faltarem,
    // preservando as descrições que o utilizador tenha personalizado.
    const guardados: Array<{ codigo: string; descricao: string; valor: string }> =
      Array.isArray(safe.tipos_documento) ? safe.tipos_documento : []
    const codigosGuardados = new Set(guardados.map(t => (t.codigo || '').toUpperCase()))
    const emFalta = TIPOS_DOCUMENTO.filter(t => !codigosGuardados.has(t.codigo))
    safe.tipos_documento = [...guardados, ...emFalta]

    res.json(safe)
  } catch (err) { res.status(500).json({ erro: String(err) }) }
})

// PUT /api/config
router.put('/', async (req: Request, res: Response) => {
  try {
    await db().collection('config').doc('winmax').set(req.body, { merge: true })
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ erro: String(err) }) }
})

// PUT /api/config/tipos-documento — actualiza lista de tipos
router.put('/tipos-documento', async (req: Request, res: Response) => {
  try {
    await db().collection('config').doc('winmax').set(
      { tipos_documento: req.body.tipos_documento }, { merge: true }
    )
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ erro: String(err) }) }
})

export default router
