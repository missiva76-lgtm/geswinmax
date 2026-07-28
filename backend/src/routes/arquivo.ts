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

    // CORRIGIDO 28/07/2026: antes clicava-se num link e esperava-se pelo evento
    // 'download' do Playwright (60s). Isso é frágil — se o Chromium decidir abrir o
    // PDF no visualizador interno em vez de o descarregar, o evento NUNCA dispara e
    // a rota rebenta por timeout (erro 500 observado em produção). Passa-se a usar a
    // mesma abordagem que já funciona de forma fiável na emissão de faturas
    // (winmaxRPA.ts): aproveitar os cookies da sessão já autenticada e ir buscar o
    // ficheiro por HTTP direto, sem depender do comportamento do browser.
    const cookies = await context.cookies()
    const cookieHeader = cookies.map((c: any) => `${c.name}=${c.value}`).join('; ')
    const urlFicheiro = `${baseUrl}/MTransactions/DigitalArchiveFileHandler.aspx?file=${encodeURIComponent(ficheiro)}`

    const resp = await fetch(urlFicheiro, { headers: { Cookie: cookieHeader } })
    if (!resp.ok) throw new Error(`o WinMax4 respondeu ${resp.status} ao pedir o ficheiro`)

    const tipoConteudo = resp.headers.get('content-type') || ''
    const buffer = Buffer.from(await resp.arrayBuffer())

    // Se vier HTML em vez de PDF, quase de certeza que a sessão não ficou válida e
    // o WinMax4 devolveu a página de login — ou o endereço do ficheiro está errado.
    // Capturamos um excerto da resposta real para se poder distinguir os dois casos,
    // em vez de ficar só a saber que "não é um PDF".
    if (tipoConteudo.includes('text/html') || buffer.subarray(0, 4).toString() !== '%PDF') {
      const excerto = buffer.toString('utf8', 0, 800)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 400)
      logger.error(`❌ Arquivo: resposta não-PDF para "${ficheiro}" (content-type: ${tipoConteudo}, ${buffer.length} bytes). Excerto: ${excerto}`)
      throw new Error(
        `a resposta do WinMax4 não é um PDF (content-type: ${tipoConteudo || 'desconhecido'}, ${buffer.length} bytes). ` +
        `Resposta recebida: ${excerto || '(vazia)'}`
      )
    }

    const os      = await import('os')
    const pathMod = await import('path')
    const fs      = await import('fs')
    destino = pathMod.join(os.tmpdir(), `arquivo-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`)
    fs.writeFileSync(destino, buffer)

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
