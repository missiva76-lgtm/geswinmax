import { Router, Request, Response } from 'express'
import { db } from '../services/firebase'

const router = Router()

// GET /api/artigos?q=SERV — pesquisa artigos (sem limite)
router.get('/', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').toUpperCase().trim()
    // Sem limite — devolve todos os artigos
    const snap = await db().collection('artigos').orderBy('codigo').get()
    const artigos = snap.docs.map(d => d.data())
    const filtrados = q
      ? artigos.filter(a => a.codigo?.toUpperCase().includes(q) || a.descricao?.toUpperCase().includes(q) || a.familia?.toUpperCase().includes(q))
      : artigos
    res.json(filtrados)
  } catch (err) {
    res.status(500).json({ erro: String(err) })
  }
})

// GET /api/artigos/:codigo — detalhe de um artigo
router.get('/:codigo', async (req: Request, res: Response) => {
  try {
    const doc = await db().collection('artigos').doc(req.params.codigo.replace(/\//g,'_')).get()
    if (!doc.exists) return res.status(404).json({ erro: 'Artigo não encontrado' })
    res.json(doc.data())
  } catch (err) {
    res.status(500).json({ erro: String(err) })
  }
})

export default router
