import crypto from 'crypto'
import axios from 'axios'

interface PriceData {
  symbol: string
  price: string
}

interface AssetBalance {
  asset: string
  free: string
  locked: string
}

interface AccountInfo {
  balances: AssetBalance[]
}

interface ParsedAsset {
  asset: string
  free: number
  locked: number
  total: number
  usdtValue: number
  type: string
  currentPrice: number | null
}

interface PortfolioData {
  totalUSDT: number
  assets: ParsedAsset[]
  lastUpdated: Date
}

export class BinanceService {
  private baseURL = 'https://api.binance.com'
  private apiKey: string
  private apiSecret: string
  private priceCache: Map<string, { data: any; timestamp: number }>
  private priceCacheDuration = 1000 // 1 second

  constructor() {
    this.apiKey = process.env.BINANCE_API_KEY || ''
    this.apiSecret = process.env.BINANCE_SECRET_KEY || ''
    this.priceCache = new Map()
  }

  private createSignature(queryString: string): string {
    if (!this.apiSecret || !queryString) return ''
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex')
  }

  private async makeRequest(endpoint: string, queryParams: Record<string, any> = {}, httpMethod = 'GET', retries = 3): Promise<any> {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('Missing BINANCE_API_KEY or BINANCE_SECRET_KEY environment variables')
    }

    let queryString = ''
    if (Object.keys(queryParams).length > 0) {
      queryString = Object.entries(queryParams)
        .map(([key, value]) => `${key}=${value}`)
        .join('&')
    }

    const timestamp = Date.now()
    const finalQueryString = queryString 
      ? `${queryString}&timestamp=${timestamp}` 
      : `timestamp=${timestamp}`
    const signature = this.createSignature(finalQueryString)
    const fullQueryWithSignature = `${finalQueryString}&signature=${signature}`

    let url: string
    const config: any = {
      method: httpMethod,
      headers: {
        'X-MBX-APIKEY': this.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 30000,
      validateStatus: function (status: number) {
        return status < 500
      }
    }

    if (httpMethod === 'GET') {
      url = `${this.baseURL}${endpoint}?${fullQueryWithSignature}`
    } else {
      url = `${this.baseURL}${endpoint}`
      config.data = fullQueryWithSignature
    }

    config.url = url

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`🔍 Making ${httpMethod} request to: ${endpoint} (attempt ${attempt}/${retries})`)
        const response = await axios(config)
        console.log(`📡 Response status: ${response.status} for ${endpoint}`)
        
        if (response.status >= 400) {
          console.error(`❌ API Error ${response.status}:`, response.data)
          if (response.status === 429) {
            console.log(`⏰ Rate limited, waiting ${attempt * 2} seconds...`)
            await new Promise(resolve => setTimeout(resolve, attempt * 2000))
            continue
          }
          throw new Error(`API Error ${response.status}: ${response.data.msg || response.statusText}`)
        }
        
        return response.data
      } catch (error: any) {
        if (error.response) {
          console.error(`❌ API Error ${error.response.status}:`, error.response.data)
          if (error.response.status === 429 && attempt < retries) {
            console.log(`⏰ Rate limited, waiting ${attempt * 2} seconds...`)
            await new Promise(resolve => setTimeout(resolve, attempt * 2000))
            continue
          }
          throw new Error(`API Error: ${error.response.data.msg || error.response.statusText}`)
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
          console.error(`❌ Network error (${error.code}): ${error.message}`)
          if (attempt < retries) {
            console.log(`🔄 Retrying in ${attempt * 2} seconds...`)
            await new Promise(resolve => setTimeout(resolve, attempt * 2000))
            continue
          }
          throw new Error(`Network Error: ${error.message}`)
        } else if (error.request) {
          console.error(`❌ No response received. This might be due to:`)
          console.error(`   - Network connectivity issues`)
          console.error(`   - Invalid API key or permissions`)
          console.error(`   - IP address restrictions`)
          console.error(`   - Firewall blocking the connection`)
          if (attempt < retries) {
            console.log(`🔄 Retrying in ${attempt * 3} seconds...`)
            await new Promise(resolve => setTimeout(resolve, attempt * 3000))
            continue
          }
          throw new Error(`Network Error: No response from server after ${retries} attempts`)
        } else {
          console.error(`❌ Request setup error:`, error.message)
          throw error
        }
      }
    }
  }

  async getAccountInfo(): Promise<AccountInfo> {
    return await this.makeRequest('/api/v3/account')
  }

  async getAllPrices(): Promise<PriceData[]> {
    const cacheKey = 'allPrices'
    const cached = this.priceCache.get(cacheKey)
    
    if (cached && (Date.now() - cached.timestamp) < this.priceCacheDuration) {
      console.log('💰 Using cached price data')
      return cached.data
    }

    try {
      const response = await axios.get(`${this.baseURL}/api/v3/ticker/price`)
      const prices = response.data
      this.priceCache.set(cacheKey, {
        data: prices,
        timestamp: Date.now()
      })
      return prices
    } catch (error: any) {
      console.error('Error fetching all prices:', error.message)
      throw error
    }
  }

  async getSymbolPrices(symbols: string[]): Promise<PriceData[]> {
    if (symbols.length === 0) return []
    
    const cacheKey = symbols.sort().join(',')
    const cached = this.priceCache.get(cacheKey)
    
    if (cached && (Date.now() - cached.timestamp) < this.priceCacheDuration) {
      return cached.data
    }

    try {
      const prices: PriceData[] = []
      for (const symbol of symbols) {
        try {
          const response = await axios.get(`${this.baseURL}/api/v3/ticker/price?symbol=${symbol}`)
          prices.push(response.data)
        } catch (error: any) {
          console.warn(`Failed to fetch price for ${symbol}:`, error.message)
        }
      }
      
      if (prices.length > 0) {
        this.priceCache.set(cacheKey, {
          data: prices,
          timestamp: Date.now()
        })
        return prices
      }
      
      return await this.getAllPrices()
    } catch (error: any) {
      console.error('Error fetching symbol prices:', error.message)
      throw error
    }
  }

  async calculateTotalAssets(): Promise<PortfolioData> {
    console.log('Fetching account information...')
    
    const accountInfo = await this.getAccountInfo()
    
    const heldAssets = accountInfo.balances
      .filter((balance: AssetBalance) => {
        const free = parseFloat(balance.free) || 0
        const locked = parseFloat(balance.locked) || 0
        return (free + locked) > 0
      })
      .map((balance: AssetBalance) => balance.asset)
    
    console.log(`Found ${heldAssets.length} spot assets, fetching prices...`)
    
    const prices = heldAssets.length > 0 && heldAssets.length < 50 
      ? await this.getSymbolPrices(heldAssets.map(asset => asset === 'USDT' ? 'USDTUSDT' : `${asset}USDT`).filter(symbol => symbol !== 'USDTUSDT'))
      : await this.getAllPrices()

    const priceMap = new Map<string, number>()
    prices.forEach((price: PriceData) => {
      priceMap.set(price.symbol, parseFloat(price.price))
    })

    let totalUSDT = 0
    const assets: ParsedAsset[] = []

    for (const balance of accountInfo.balances) {
      const free = parseFloat(balance.free) || 0
      const locked = parseFloat(balance.locked) || 0
      const total = free + locked
      
      if (total > 0) {
        let usdtValue = 0
        let currentPrice: number | null = null
        
        if (balance.asset === 'USDT') {
          usdtValue = total
          currentPrice = 1.0
        } else {
          const usdtPair = `${balance.asset}USDT`
          const btcPair = `${balance.asset}BTC`
          
          if (priceMap.has(usdtPair)) {
            currentPrice = priceMap.get(usdtPair)!
            usdtValue = total * currentPrice
          } else if (priceMap.has(btcPair) && priceMap.has('BTCUSDT')) {
            const btcPrice = priceMap.get(btcPair)!
            const btcUsdtPrice = priceMap.get('BTCUSDT')!
            currentPrice = btcPrice * btcUsdtPrice
            usdtValue = total * currentPrice
          }
        }
        
        if (usdtValue > 0.01) {
          assets.push({
            asset: balance.asset,
            free,
            locked,
            total,
            usdtValue,
            type: '现货',
            currentPrice
          })
          totalUSDT += usdtValue
        }
      }
    }

    const sortedAssets = assets.sort((a, b) => b.usdtValue - a.usdtValue)

    return {
      totalUSDT,
      assets: sortedAssets,
      lastUpdated: new Date()
    }
  }
}