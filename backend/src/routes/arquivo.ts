import { Router, Request, Response } from 'express'
import * as admin from 'firebase-admin'
import { db } from '../services/firebase'
import { syncArquivoDigital } from '../sync/syncArquivoDigital'
import { logger } from '../services/logger'

const router = Router()

// GET /api/arquivo — lista documentos do arquivo (com filtros)
router.get('/', async (req: Request, res: Response) => {
  try {
    let q = db().collection('arquivo').orderBy('importado_em', 'desc')

    if (req.query.cliente) {
      q = q.where('cliente_codigo', '==', req.query.cliente) as any
    }
    if (req.query.tipo) {
      q = q.where('tipo_documento', '==', req.query.tipo) as any
    }

    const snap = await q.get()
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  } catch (err) {
    res.status(500).json({ erro: String(err) })
  }
})

// GET /api/arquivo/pesquisar?q=texto — pesquisa por número ou cliente
router.get('/pesquisar', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').toUpperCase().trim()
    const snap = await db().collection('arquivo').orderBy('importado_em', 'desc').get()

    const todos = snap.docs.map(d => ({ id: d.id, ...d.data() as any }))
    const filtrados = q
      ? todos.filter(d =>
          d.numero_documento?.toUpperCase().includes(q) ||
          d.cliente_nome?.toUpperCase().includes(q) ||
          d.cliente_codigo?.includes(q) ||
          d.tipo_documento?.toUpperCase().includes(q)
        )
      : todos

    res.json(filtrados.slice(0, 100))
  } catch (err) {
    res.status(500).json({ erro: String(err) })
  }
})

// POST /api/arquivo/sync — importa/actualiza arquivo do WinMax4
router.post('/sync', async (req: Request, res: Response) => {
  const jobRef = db().collection('jobs').doc()
  await jobRef.set({
    id: jobRef.id, tipo: 'arquivo', estado: 'ativo',
    progresso: 0, log: [],
    criado_em: admin.firestore.FieldValue.serverTimestamp(),
  })

  syncArquivoDigital(jobRef.id, { forceReimport: req.query.force === 'true' })
    .then(() => jobRef.update({ estado: 'concluido', progresso: 100 }))
    .catch(async (e) => jobRef.update({ estado: 'erro', erro_geral: String(e) }))

  res.json({ jobId: jobRef.id, mensagem: 'Importação do arquivo iniciada' })
})

// GET /api/arquivo/pdf/:ficheiro — descarrega PDF do WinMax4 via proxy
router.get('/pdf/:ficheiro', async (req: Request, res: Response) => {
  try {
    const { getConfig } = await import('../services/firebase')
    const config = await getConfig()
    const baseUrl = config.winmax_url || 'https://app102.winmax4.com'
    const ficheiro = req.params.ficheiro
    // URL do ficheiro no Arquivo Digital do WinMax4
    const url = `${baseUrl}/MTransactions/DigitalArchiveFileHandler.aspx?file=${encodeURIComponent(ficheiro)}`
    res.redirect(url)
  } catch (err) {
    res.status(500).json({ erro: String(err) })
  }
})

// GET /api/arquivo/download/:ficheiro — download autenticado via Playwright
router.get('/download/:ficheiro', async (req: Request, res: Response) => {
  const { chromium } = await import('playwright')
  const { getConfig } = await import('../services/firebase')
  const { acquireBrowserLock } = await import('../services/browserLock')
  let browser: any = null
  let releaseLock: (() => void) | null = null
  let destino = ''
  try {
    const config  = await getConfig()
    const baseUrl = config.winmax_url || 'https://app102.winmax4.com'
    const company = config.company_code || 'AUTOAVENIDA'
    const ficheiro = decodeURIComponent(req.params.ficheiro)

    // CORRIGIDO 28/07/2026: esta rota lançava um Chromium sem passar pelo semáforo,
    // podendo correr em paralelo com uma sincronização. Com 512MB de RAM no Render,
    // dois browsers em simultâneo são um risco real de esgotar a memória e derrubar
    // ambos os processos. Agora fica em fila, tal como os syncs.
    releaseLock = await acquireBrowserLock()

    // CORRIGIDO 27/07/2026: ver nota detalhada em syncArquivoDigital.ts — evita
    // crash do Chromium por falta de espaço em /dev/shm em containers.
    browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] })
    const context = await browser.newContext({ acceptDownloads: true })
    const page    = await context.newPage()

    // Login
    await page.goto(`${baseUrl}/MainPage.aspx?CompanyCode=${company}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(2000)
    await page.waitForFunction(() => !!document.getElementById('UserAuthentication_content'), { timeout: 60000 })
    await page.evaluate(({ user, pass }: { user: string; pass: string }) => {
      const f   = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
      const doc = f?.contentDocument
      const u = doc?.getElementById('txtUserLogin')   as HTMLInputElement
      const p = doc?.getElementById('txtUserPassword') as HTMLInputElement
      if (u) { u.value = user; u.dispatchEvent(new Event('change', { bubbles: true })) }
      if (p) { p.value = pass; p.dispatchEvent(new Event('change', { bubbles: true })) }
    }, { user: config.utilizador || '', pass: config.password || '' })
    await page.evaluate(() => {
      const f = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
      ;(f?.contentDocument?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
    })
    await page.waitForTimeout(3000)
    await page.waitForFunction(() => !!document.getElementById('Toolbox_content'), { timeout: 90000 }).catch(() => {})

    // CORRIGIDO 28/07/2026: o endereço "DigitalArchiveFileHandler.aspx?file=..." que
    // aqui se usava NUNCA foi confirmado a partir da aplicação — era uma suposição, e
    // o WinMax4 respondia com 0 bytes. O mecanismo real está documentado no cabeçalho
    // de syncArquivoDigital.ts, por quem explorou isto ao vivo:
    //     "8. Download PDF: clica lnkSelect de cada linha → download interceptado"
    // Ou seja: não há URL direto. É preciso navegar até à listagem, encontrar a linha
    // do ficheiro e clicar no link dela, interceptando o download resultante.
    //
    // Para não percorrer as 200+ páginas da listagem, aproveita-se a data que já vem
    // codificada no próprio nome do ficheiro (ex: 20260724_FFF_4749.pdf -> 24-07-2026)
    // e aplica-se o filtro de data desse dia, reduzindo a poucos registos.
    const m = ficheiro.match(/^(\d{4})(\d{2})(\d{2})_/)
    if (!m) throw new Error(`não foi possível extrair a data do nome do ficheiro "${ficheiro}"`)
    const dataFiltro = `${m[3]}-${m[2]}-${m[1]}`

    // Toolbox -> Arquivo digital
    const { clicarToolboxPorTitulo } = await import('../rpa/toolboxHelper')
    const encontrouAtalho = await clicarToolboxPorTitulo(page, 'Arquivo digital')
    if (!encontrouAtalho) throw new Error('atalho "Arquivo digital" não encontrado no Toolbox')
    await page.waitForTimeout(2000)
    await page.waitForFunction(() => !!document.getElementById('utilsDigitalArchive_content'), { timeout: 60000 })

    // Categoria "Documentos"
    await page.evaluate(() => {
      const f = document.getElementById('utilsDigitalArchive_content') as HTMLIFrameElement
      ;(f?.contentDocument?.getElementById('ibDetailsDocuments') as HTMLElement)?.click()
    })
    await page.waitForTimeout(2000)
    await page.waitForFunction(() => !!document.getElementById('DigitalArchiveDetails_content'), { timeout: 30000 })

    // Filtro pela data do documento
    await page.evaluate(({ d }: { d: string }) => {
      const f   = document.getElementById('DigitalArchiveDetails_content') as HTMLIFrameElement
      const doc = f?.contentDocument
      if (!doc) return
      const de  = doc.getElementById('FilterContentDate_txtFrom1_1') as HTMLInputElement
      const ate = doc.getElementById('FilterContentDate_txtTo1_1')   as HTMLInputElement
      if (de)  { de.value  = d; de.dispatchEvent(new Event('change', { bubbles: true })) }
      if (ate) { ate.value = d; ate.dispatchEvent(new Event('change', { bubbles: true })) }
    }, { d: dataFiltro })
    await page.waitForTimeout(400)
    await page.evaluate(() => {
      const f = document.getElementById('DigitalArchiveDetails_content') as HTMLIFrameElement
      ;(f?.contentDocument?.getElementById('wucFileList1_wucButtonFilter_linkButton1') as HTMLElement)?.click()
    })
    await page.waitForTimeout(3000)

    // Procura a linha do ficheiro (pode haver mais do que uma página nesse dia)
    const downloadPromise = page.waitForEvent('download', { timeout: 60000 })
    let clicou = false
    for (let pag = 0; pag < 20 && !clicou; pag++) {
      clicou = await page.evaluate(({ nome }: { nome: string }) => {
        const f    = document.getElementById('DigitalArchiveDetails_content') as HTMLIFrameElement
        const grid = f?.contentDocument?.getElementById('wucFileList1_fileList') as HTMLTableElement
        if (!grid) return false
        for (const tr of Array.from(grid.querySelectorAll('tbody tr'))) {
          const texto = (tr as HTMLElement).innerText || ''
          if (!texto.includes(nome)) continue
          const link = tr.querySelector('a[id*="lnkSelect"], a') as HTMLElement | null
          if (link) { link.click(); return true }
        }
        return false
      }, { nome: ficheiro })

      if (clicou) break

      const avancou = await page.evaluate(() => {
        const f = document.getElementById('DigitalArchiveDetails_content') as HTMLIFrameElement
        const btn = f?.contentDocument?.getElementById('wucFileList1_ibNext') as HTMLElement
        if (!btn) return false
        btn.click()
        return true
      })
      if (!avancou) break
      await page.waitForTimeout(1500)
    }

    if (!clicou) throw new Error(`o ficheiro "${ficheiro}" não foi encontrado na listagem de ${dataFiltro}`)

    const download = await downloadPromise

    const os      = await import('os')
    const pathMod = await import('path')
    const fs      = await import('fs')
    destino = pathMod.join(os.tmpdir(), `arquivo-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`)
    await download.saveAs(destino)

    await browser.close().catch(() => {})
    browser = null
    releaseLock?.()
    releaseLock = null

    const nomeSeguro = ficheiro.replace(/[^\w.\-]/g, '_')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${nomeSeguro}"`)
    res.sendFile(destino, (err?: Error) => {
      if (err) logger.error(`Erro ao enviar PDF ${ficheiro}: ${err}`)
      fs.rmSync(destino, { force: true })
    })
  } catch (err) {
    logger.error(`❌ Download PDF do arquivo falhou: ${err}`)
    if (destino) {
      const fs = await import('fs')
      fs.rmSync(destino, { force: true })
    }
    // Mensagem legível — este URL é aberto diretamente num separador do browser,
    // por isso devolver JSON cru não ajuda nada quem está a ver.
    if (!res.headersSent) {
      res.status(500).type('html').send(`
        <html lang="pt"><head><meta charset="utf-8"><title>Erro ao obter PDF</title></head>
        <body style="font-family:system-ui,sans-serif;padding:2rem;color:#374151">
          <h2 style="color:#dc2626">Não foi possível obter o PDF</h2>
          <p>O documento não pôde ser descarregado do WinMax4.</p>
          <p style="color:#6b7280;font-size:.9rem">Detalhe técnico: ${String(err).replace(/</g, '&lt;')}</p>
          <p style="color:#6b7280;font-size:.9rem">Se houver uma sincronização a decorrer, tenta de novo quando terminar.</p>
        </body></html>
      `)
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
    releaseLock?.()
  }
})

// GET /api/arquivo/diagnostico — inspeciona a listagem real do Arquivo Digital e
// devolve o HTML de uma linha, para se perceber COMO o WinMax4 liga aos ficheiros.
//
// Existe porque o endereço usado no download (`DigitalArchiveFileHandler.aspx?file=`)
// nunca foi confirmado a partir da aplicação — foi construído por suposição. Este
// endpoint mostra o mecanismo verdadeiro (href, onclick, ids) em vez de adivinharmos.
router.get('/diagnostico', async (_req: Request, res: Response) => {
  const { chromium } = await import('playwright')
  const { getConfig } = await import('../services/firebase')
  const { acquireBrowserLock } = await import('../services/browserLock')
  const { clicarToolboxPorTitulo } = await import('../rpa/toolboxHelper')
  let browser: any = null
  let releaseLock: (() => void) | null = null
  try {
    const config  = await getConfig()
    const baseUrl = config.winmax_url || 'https://app102.winmax4.com'
    const company = config.company_code || 'AUTOAVENIDA'

    releaseLock = await acquireBrowserLock()
    browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] })
    const context = await browser.newContext()
    const page    = await context.newPage()

    await page.goto(`${baseUrl}/MainPage.aspx?CompanyCode=${company}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(2000)
    await page.waitForFunction(() => !!document.getElementById('UserAuthentication_content'), { timeout: 60000 })
    await page.evaluate(({ user, pass }: { user: string; pass: string }) => {
      const f   = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
      const doc = f?.contentDocument
      const u = doc?.getElementById('txtUserLogin')   as HTMLInputElement
      const p = doc?.getElementById('txtUserPassword') as HTMLInputElement
      if (u) { u.value = user; u.dispatchEvent(new Event('change', { bubbles: true })) }
      if (p) { p.value = pass; p.dispatchEvent(new Event('change', { bubbles: true })) }
    }, { user: config.utilizador || '', pass: config.password || '' })
    await page.evaluate(() => {
      const f = document.getElementById('UserAuthentication_content') as HTMLIFrameElement
      ;(f?.contentDocument?.getElementById('wucButtonConfirm_linkButton1') as HTMLElement)?.click()
    })
    await page.waitForTimeout(3000)
    await page.waitForFunction(() => !!document.getElementById('Toolbox_content'), { timeout: 90000 })

    const encontrou = await clicarToolboxPorTitulo(page, 'Arquivo digital')
    if (!encontrou) throw new Error('Atalho "Arquivo digital" não encontrado no Toolbox')
    await page.waitForTimeout(3000)
    await page.waitForFunction(() => !!document.getElementById('utilsDigitalArchive_content'), { timeout: 60000 })

    // Abre a categoria "Documentos" e espera pela grelha
    await page.evaluate(() => {
      const f = document.getElementById('utilsDigitalArchive_content') as HTMLIFrameElement
      const doc = f?.contentDocument
      const botoes = Array.from(doc?.querySelectorAll('input[type="image"], a, td') || [])
      const alvo = botoes.find(b => (b as HTMLElement).innerText?.includes('Documentos')
        || b.getAttribute('title')?.includes('Documentos')) as HTMLElement | undefined
      alvo?.click()
    }).catch(() => {})
    await page.waitForTimeout(4000)

    // Devolve o HTML bruto da primeira linha da grelha, para se ver o mecanismo real
    const info = await page.evaluate(() => {
      const procurarGrelha = (): { origem: string; html: string } | null => {
        for (const idIframe of ['DigitalArchiveDetails_content', 'utilsDigitalArchive_content']) {
          const f = document.getElementById(idIframe) as HTMLIFrameElement
          const doc = f?.contentDocument
          if (!doc) continue
          const grid = doc.getElementById('wucFileList1_fileList') as HTMLTableElement
          const linha = grid?.querySelector('tbody tr')
          if (linha) return { origem: idIframe, html: linha.outerHTML }
          // Se não há grelha, devolve o esqueleto do iframe para se perceber o estado
          if (doc.body) return { origem: `${idIframe} (sem grelha)`, html: doc.body.innerHTML.slice(0, 3000) }
        }
        return null
      }
      return procurarGrelha()
    })

    res.json({
      encontrado: !!info,
      origem: info?.origem || null,
      html: info?.html || null,
      nota: 'Procura aqui por href, onclick ou __doPostBack — é isso que revela como o WinMax4 abre cada ficheiro.',
    })
  } catch (err) {
    logger.error(`❌ Diagnóstico do arquivo falhou: ${err}`)
    res.status(500).json({ erro: String(err) })
  } finally {
    if (browser) await browser.close().catch(() => {})
    releaseLock?.()
  }
})

export default router
