import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import * as path from 'path'
import * as fs from 'fs'
import * as cron from 'node-cron'
import { initFirebase, getConfig, db } from './services/firebase'
import { logger } from './services/logger'
import { syncWinmax } from './sync/syncArtigos'
import { syncArquivoDigital } from './sync/syncArquivoDigital'
import { syncSAFT } from './sync/syncSAFT'
import jobsRouter    from './routes/jobs'
import artigosRouter from './routes/artigos'
import faturasRouter from './routes/faturas'
import configRouter  from './routes/config'
import arquivoRouter from './routes/arquivo'
import saftRouter    from './routes/saft'
import dadosRouter    from './routes/dados'

for (const dir of ['logs', 'tmp/uploads', 'pdfs', 'pdfs/arquivo', 'saft']) {
  fs.mkdirSync(path.join(process.cwd(), dir), { recursive: true })
}

initFirebase()

const app = express()
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }))
app.use(express.json({ limit: '10mb' }))

// PDFs estáticos (emissão + arquivo)
app.use('/api/pdfs', express.static(path.join(process.cwd(), 'pdfs'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.pdf')) {
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', 'inline')
    }
  }
}))

app.get('/health', (_req: express.Request, res: express.Response) => res.json({
  status: 'ok', versao: '1.0.0', app: 'GesWinmax Backend',
  timestamp: new Date().toISOString(),
}))

app.get('/debug-firestore', async (_req: express.Request, res: express.Response) => {
  try {
    const snap = await db().collection('config').doc('winmax').get()
    res.json({ ok: true, exists: snap.exists, data: snap.data() })
  } catch (e: any) {
    res.json({ ok: false, error: String(e), code: e.code, details: e.details })
  }
})

app.get('/debug-env', (_req: express.Request, res: express.Response) => {
  const key = process.env.FIREBASE_PRIVATE_KEY || ''
  const keyAfter = key.includes('\\n') ? key.split('\\n').join('\n') : key
  res.json({
    project_id: process.env.FIREBASE_PROJECT_ID,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    key_length: key.length,
    key_starts: key.substring(0, 30),
    key_ends: key.substring(key.length - 30),
    has_begin: key.includes('BEGIN PRIVATE KEY'),
    has_end: key.includes('END PRIVATE KEY'),
    newline_count: (key.match(/\n/g) || []).length,
    literal_n_count: (key.match(/\\n/g) || []).length,
    after_replace_newlines: (keyAfter.match(/\n/g) || []).length,
    after_replace_starts: keyAfter.substring(0, 50),
  })
})

app.use('/api/jobs',    jobsRouter)
app.use('/api/artigos', artigosRouter)
app.use('/api/faturas', faturasRouter)
app.use('/api/config',  configRouter)
app.use('/api/arquivo', arquivoRouter)
app.use('/api/dados',   dadosRouter)
app.use('/api/saft',    saftRouter)

async function agendarSync() {
  console.info('[agendarSync] A ler config...')
  const config = await getConfig()
  console.info('[agendarSync] Config lida:', JSON.stringify(config).substring(0, 100))
  const hora = config.sync_hora || '02:00'
  const [h, m] = hora.split(':')

  // Sync de artigos/movimentos diária
  cron.schedule(`${m} ${h} * * *`, async () => {
    logger.info(`⏰ Sync automática (${hora})`)
    await syncWinmax()
  }, { timezone: 'Europe/Lisbon' })

  // Sync do arquivo digital — diária 30 min depois
  const hArq = String(Number(h)).padStart(2, '0')
  const mArq = String((Number(m) + 30) % 60).padStart(2, '0')
  cron.schedule(`${mArq} ${hArq} * * *`, async () => {
    logger.info(`⏰ Sync Arquivo Digital (${hArq}:${mArq})`)
    await syncArquivoDigital()
  }, { timezone: 'Europe/Lisbon' })

  logger.info(`⏰ Sync artigos: ${hora} | Arquivo digital: ${hArq}:${mArq}`)

  // SAF-T: dia 1 de cada mês às 03:30 — importa o mês anterior
  cron.schedule('30 3 1 * *', async () => {
    const hoje = new Date()
    const mesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)
    const ultimoDia   = new Date(hoje.getFullYear(), hoje.getMonth(), 0)
    const di = `01/${String(mesAnterior.getMonth()+1).padStart(2,'0')}/${mesAnterior.getFullYear()}`
    const df = `${String(ultimoDia.getDate()).padStart(2,'0')}/${String(ultimoDia.getMonth()+1).padStart(2,'0')}/${ultimoDia.getFullYear()}`
    logger.info(`⏰ Sync SAF-T automática: ${di} → ${df}`)
    await syncSAFT(di, df)
  }, { timezone: 'Europe/Lisbon' })
  logger.info('⏰ SAF-T mensal: dia 1 de cada mês às 03:30')
}

const PORT = Number(process.env.PORT) || 3001
app.listen(PORT, async () => {
  logger.info(`\n╔══════════════════════════════════════╗`)
  logger.info(`║  GesWinmax Backend — porta ${PORT}       ║`)
  logger.info(`╚══════════════════════════════════════╝\n`)
  logger.info('✅ Backend pronto — sync manual disponível via API')
})

// Evita crash por erros não tratados — mantém o servidor vivo para diagnóstico
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})
