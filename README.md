# GesWinmax

App de gestão de faturação WinMax4 — AUTOAVENIDA.
React + Firebase + Render (Node.js + Playwright).

## Estrutura
```
geswinmax/
├── frontend/          React + Vite + Tailwind → Netlify
└── backend/           Node.js + Express + Playwright → Render
```

## Setup rápido

### 1. Firebase
1. Cria projeto em console.firebase.google.com
2. Activa Authentication (Email/Password)
3. Cria Firestore database
4. Cria Storage bucket
5. Gera Service Account key (JSON) → para o backend
6. Adiciona app web → copia as env vars → para o frontend

### 2. Backend (Render)
1. Push para GitHub
2. Em render.com → New Web Service → liga o repo
3. Root dir: `backend`
4. Build: `npm install && npx playwright install chromium --with-deps && npm run build`
5. Start: `npm start`
6. Adiciona as variáveis de ambiente (ver `backend/.env.example`)

### 3. Frontend (Netlify)
1. Em netlify.com → New site → liga o repo
2. Build: `npm run build` | Publish: `dist` | Base: `frontend`
3. Adiciona as variáveis de ambiente (ver `frontend/.env.example`)
4. VITE_API_URL = URL do Render

### 4. Primeiro utilizador
No Firebase Console → Authentication → Add user
Cria o teu email e password para aceder à app.

## Módulos
- **Emissão** — Upload Excel → RPA → PDFs no Firebase Storage
- **Dashboard** — KPIs, jobs recentes, sync status
- **Dados WinMax4** — Artigos + movimentos (sync diária automática)
- **Arquivo digital** — Documentos emitidos pesquisáveis com PDF
- **Configurações** — Todas as variáveis editáveis na app

## Excel de emissão
Colunas obrigatórias: `cliente_codigo`, `cliente_nome`, `tipo_documento`, `artigo_ref`, `quantidade`, `preco_unitario`
Colunas opcionais: `desconto_pct`, `comentario`

Descricao e IVA vêm automaticamente da ficha do artigo no WinMax4.
