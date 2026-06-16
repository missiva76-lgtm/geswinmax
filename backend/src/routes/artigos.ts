import { Router, Request, Response } from 'express'
import { db } from '../services/firebase'

const router = Router()

// GET /api/artigos?q=SERV — pesquisa artigos
router.get('/', async (req: Request, res: Response) => {
  const q = String(req.query.q || '').toUpperCase()
  let query = db().collection('artigos').orderBy('codigo').limit(100)
  const snap = await query.get()
  const artigos = snap.docs.map(d => d.data())
  const filtrados = q
    ? artigos.filter(a => a.codigo?.includes(q) || a.descricao?.toUpperCase().includes(q))
    : artigos
  res.json(filtrados)
})

// GET /api/artigos/:codigo — detalhe de um artigo
router.get('/:codigo', async (req: Request, res: Response) => {
  const doc = await db().collection('artigos').doc(req.params.codigo.replace(/\//g,'_')).get()
  if (!doc.exists) return res.status(404).json({ erro: 'Artigo não encontrado' })
  res.json(doc.data())
})

export default router
