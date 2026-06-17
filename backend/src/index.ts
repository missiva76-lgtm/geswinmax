import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import * as path from 'path'
import * as fs from 'fs'
import * as cron from 'node-cron'
import { initFirebase, getConfig } from './services/firebase'
import { logger } from './services/logger'
import { syncWinmax } from './sync/syncArtigos'
import jobsRouter    from './routes/jobs'
import artigosRouter from './routes/artigos'
import faturasRouter from './routes/faturas'
import configRouter  from './routes/config'

for (const dir of ['logs', 'tmp/uploads', 'pdfs']) {
  fs.mkdirSync(path.join(process.cwd(), dir), { recursive: true })
}

initFirebase()

const app = express()
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }))
app.use(express.json({ limit: '10mb' }))

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

app.use('/api/jobs',    jobsRouter)
app.use('/api/artigos', artigosRouter)
app.use('/api/faturas', faturasRouter)
app.use('/api/config',  configRouter)

async function agendarSync() {
  const config = await getConfig()
  const hora = config.sync_hora || '02:00'
  const [h, m] = hora.split(':')
  cron.schedule(`${m} ${h} * * *`, async () => {
    logger.info(`⏰ Sync automática (${hora})`)
    await syncWinmax()
  }, { timezone: 'Europe/Lisbon' })
  logger.info(`⏰ Sync agendada para as ${hora}`)
}

const PORT = Number(process.env.PORT) || 3001
app.listen(PORT, async () => {
  logger.info(`\n╔══════════════════════════════════════╗`)
  logger.info(`║  GesWinmax Backend — porta ${PORT}       ║`)
  logger.info(`╚══════════════════════════════════════╝\n`)
  await agendarSync()
})
