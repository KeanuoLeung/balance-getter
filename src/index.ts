import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { BinanceService } from './binance-service.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const binanceService = new BinanceService()

app.use(express.json())

// Home route - HTML
app.get('/', (req, res) => {
  res.type('html').send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8"/>
        <title>Express on Vercel</title>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
          <a href="/api-data">API Data</a>
          <a href="/healthz">Health</a>
        </nav>
        <h1>Welcome to Express on Vercel 🚀</h1>
        <p>This is a minimal example without a database or forms.</p>
        <img src="/logo.png" alt="Logo" width="120" />
      </body>
    </html>
  `)
})

app.get('/about', function (req, res) {
  res.sendFile(path.join(__dirname, '..', 'components', 'about.htm'))
})

// Example API endpoint - JSON
app.get('/api-data', (req, res) => {
  res.json({
    message: 'Here is some sample API data',
    items: ['apple', 'banana', 'cherry'],
  })
})

// Health check
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() })
})

// API 1: Query token prices
app.post('/api/token-prices', async (req, res) => {
  try {
    const { tokens } = req.body
    
    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({ 
        error: 'Please provide a tokens array',
        example: { tokens: ['ada', 'bnb'] }
      })
    }
    
    const symbols = tokens.map(token => {
      const upperToken = token.toUpperCase()
      return upperToken === 'USDT' ? 'USDTUSDT' : `${upperToken}USDT`
    }).filter(symbol => symbol !== 'USDTUSDT')
    
    console.log(`🔍 Querying token prices: ${tokens.join(', ')}`)
    
    const prices = await binanceService.getSymbolPrices(symbols)
    
    const result = prices.map(price => ({
      token: price.symbol.replace('USDT', '').toLowerCase(),
      price: parseFloat(price.price)
    }))
    
    console.log(`✅ Successfully retrieved ${result.length} token prices`)
    res.json(result)
    
  } catch (error: any) {
    console.error('❌ Failed to get token prices:', error.message)
    res.status(500).json({ 
      error: 'Failed to get prices',
      message: error.message 
    })
  }
})

// API 2: Get current holdings
app.get('/api/holdings', async (_req, res) => {
  try {
    console.log('📊 Getting current holdings...')
    
    const portfolio = await binanceService.calculateTotalAssets()
    
    const holdings = portfolio.assets.map(asset => ({
      token: asset.asset.toLowerCase(),
      type: asset.type,
      amount: asset.total
    }))
    
    console.log(`✅ Successfully retrieved ${holdings.length} holdings`)
    res.json(holdings)
    
  } catch (error: any) {
    console.error('❌ Failed to get holdings:', error.message)
    res.status(500).json({ 
      error: 'Failed to get holdings',
      message: error.message 
    })
  }
})

// API 3: Health check
app.get('/api/health', (_req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    endpoints: [
      'POST /api/token-prices',
      'GET /api/holdings',
      'GET /api/health'
    ]
  })
})

export default app
