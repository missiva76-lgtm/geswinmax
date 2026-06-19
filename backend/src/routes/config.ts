import { Router, Request, Response } from 'express'
import { db } from '../services/firebase'

const router = Router()

// GET /api/config
router.get('/', async (_req: Request, res: Response) => {
  try {
    const doc = await db().collection('config').doc('winmax').get()
    const data = doc.exists ? doc.data() as Record<string, any> : {}
    const { password: _, ...safe } = data
    // Tipos de documento default se não existirem
    if (!safe.tipos_documento) {
      safe.tipos_documento = [
        { codigo: 'FAA', descricao: 'Fatura a Clientes', valor: '37' },
        { codigo: 'FR',  descricao: 'Fatura Recibo',     valor: '55' },
        { codigo: 'FS',  descricao: 'Fatura Simplificada', valor: '46' },
        { codigo: 'FTB', descricao: 'Fat Recibo B',      valor: '45' },
        { codigo: 'NCC', descricao: 'Nota de Crédito',   valor: '40' },
        { codigo: 'GT',  descricao: 'Guia de Transporte', valor: '49' },
        { codigo: 'FFF', descricao: 'Fatura Fornecedor', valor: '55' },
        { codigo: 'FRB', descricao: 'Fatura Reboque',      valor: '53' },
      ]
    }
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
