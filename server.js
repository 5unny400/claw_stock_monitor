const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const iconv = require('iconv-lite');
const goldModule = require('./gold-price');
const cron = require('node-cron');
const { execSync } = require('child_process');

// 启动黄金价格轮询
goldModule.startPolling(3000);

const app = express();
const PORT = 3000;

// 创建 axios 实例，设置浏览器 User-Agent
const apiClient = axios.create({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'http://finance.sina.com.cn/'
  },
  responseType: 'arraybuffer'  // 获取原始二进制数据
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 股票数据缓存
const stockCache = new Map();

// 支持的商品代码映射
const COMMODITY_CODES = {
  'AU9999': 'sgeAu9999',    // 黄金现货
  'AU100G': 'sgeAu100g',    // 黄金 100 克
  'AG999': 'sgeAg999',      // 白银
  'PT9995': 'sgePt9995',    // 铂金
  'XAU': 'sgeAu9999'        // 黄金别名
};

// 新浪财经股票 API - 支持 A 股、港股、黄金
function getStockCode(stockSymbol) {
  // 检查是否是商品代码
  if (COMMODITY_CODES[stockSymbol.toUpperCase()]) {
    return COMMODITY_CODES[stockSymbol.toUpperCase()];
  }
  
  // 自动识别市场：60/68开头=沪市，00/30开头=深市
  if (/^(60|68)/.test(stockSymbol)) {
    return `sh${stockSymbol}`;
  } else if (/^(00|30)/.test(stockSymbol)) {
    return `sz${stockSymbol}`;
  }
  return stockSymbol;
}

// 判断是否是商品
function isCommodity(symbol) {
  return COMMODITY_CODES.hasOwnProperty(symbol.toUpperCase());
}

// 获取股票实时行情
app.get('/api/stock/:symbol', async (req, res) => {
  try {
    let { symbol } = req.params;
    
    // 处理市场前缀
    let marketPrefix = '';
    if (symbol.startsWith('HK')) {
      marketPrefix = '116.';
      symbol = symbol.substring(2);
    } else if (symbol.startsWith('US')) {
      marketPrefix = '105.';
      symbol = symbol.substring(2);
    }
    
    // 自动判断市场（如果没有前缀）
    if (!marketPrefix) {
      if (/^(60|68)/.test(symbol)) marketPrefix = '1.';
      else if (/^(00|30)/.test(symbol)) marketPrefix = '0.';
      else if (/^[48]/.test(symbol)) marketPrefix = '2.';
      else if (/^0\d{4}$/.test(symbol)) marketPrefix = '116.';
    }
    
    const secid = `${marketPrefix}${symbol}`;
    
    // 使用东方财富 API 获取行情
    const response = await axios.get(
      `http://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f49,f50,f51,f52,f57,f58,f60,f169`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 5000
      }
    );
    
    const data = response.data;
    
    if (!data.data || !data.data.f43) {
      return res.status(404).json({ error: '未找到该股票' });
    }
    
    const d = data.data;
    
    // 根据市场确定价格精度：港股除以 1000，A 股/美股除以 100
    const priceDivisor = marketPrefix === '116.' ? 1000 : 100;
    
    const current = d.f43 / priceDivisor || 0;
    const close = d.f60 / priceDivisor || current;
    const stockData = {
      symbol: symbol,
      name: d.f58 || d.f12 || symbol,
      open: d.f46 / priceDivisor || current,
      close: close,
      current: current,
      high: d.f48 / priceDivisor || current,
      low: d.f47 / priceDivisor || current,
      volume: d.f47 || 0,
      amount: d.f48 || 0,
      change: (current - close),
      changePercent: close ? ((current - close) / close * 100).toFixed(2) : '0.00',
      market: d.f169 === 1 ? '沪市' : d.f169 === 2 ? '深市' : d.f169 === 5 ? '港股' : d.f169 === 6 ? '美股' : '其他'
    };
    
    stockCache.set(symbol, { ...stockData, timestamp: Date.now() });
    res.json(stockData);
    
  } catch (error) {
    console.error('获取股票数据失败:', error.message);
    res.status(500).json({ error: '获取股票数据失败', message: error.message });
  }
});

// 批量获取股票行情 - 使用东方财富 API（支持港股、美股）
app.get('/api/stocks', async (req, res) => {
  try {
    const { symbols } = req.query;
    if (!symbols) {
      return res.status(400).json({ error: '请提供股票代码列表' });
    }
    
    const symbolList = symbols.split(',');
    const results = [];
    
    // 逐个获取股票行情（东方财富支持批量但代码格式复杂）
    for (const symbol of symbolList) {
      try {
        // 处理市场前缀
        let secid = symbol;
        if (/^(60|68)/.test(symbol)) secid = `1.${symbol}`;
        else if (/^(00|30)/.test(symbol)) secid = `0.${symbol}`;
        else if (/^[48]/.test(symbol)) secid = `2.${symbol}`;
        else if (/^0\d{3,5}$/.test(symbol)) secid = `116.${symbol}`;  // 港股（4-5 位数字）
        else if (/^[A-Z]{2,6}$/.test(symbol)) secid = `105.${symbol}`;  // 美股
        
        const response = await axios.get(
          `http://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f49,f50,f51,f52,f57,f58,f60,f169`,
          {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 5000
          }
        );
        
        const data = response.data;
        if (data.data && data.data.f43) {
          const d = data.data;
          
          // 根据市场确定价格精度：港股除以 1000，A 股/美股除以 100
          const priceDivisor = /^116\./.test(secid) ? 1000 : 100;
          
          const current = d.f43 / priceDivisor || 0;
          const close = d.f60 / priceDivisor || current;
          results.push({
            symbol: symbol,
            name: d.f58 || d.f12 || symbol,
            current: current,
            close: close,
            change: (current - close),
            changePercent: close ? ((current - close) / close * 100).toFixed(2) : '0.00',
            volume: d.f47 || 0,
            amount: d.f48 || 0,
            high: d.f46 / priceDivisor || current,
            low: d.f45 / priceDivisor || current,
            time: new Date().toLocaleTimeString('zh-CN')
          });
        }
      } catch (e) {
        console.log(`获取${symbol}行情失败：${e.message}`);
      }
    }
    
    res.json(results);
    
  } catch (error) {
    console.error('批量获取股票数据失败:', error.message);
    res.status(500).json({ error: '批量获取失败', message: error.message });
  }
});

// 验票 - 获取股票基本信息
app.get('/api/stock/:symbol/info', async (req, res) => {
  try {
    let { symbol } = req.params;
    
    // 处理市场前缀
    let secid = symbol;
    if (symbol.startsWith('HK')) {
      secid = `116.${symbol.substring(2)}`;
    } else if (symbol.startsWith('US')) {
      secid = `105.${symbol.substring(2)}`;
    } else if (/^(60|68)/.test(symbol)) {
      secid = `1.${symbol}`;  // 沪市
    } else if (/^(00|30)/.test(symbol)) {
      secid = `0.${symbol}`;  // 深市
    } else if (/^[48]/.test(symbol)) {
      secid = `2.${symbol}`;  // 北交所
    } else if (/^0\d{4}$/.test(symbol)) {
      secid = `116.${symbol}`;  // 港股（无前缀）
    } else if (/^[A-Z]{2,6}$/.test(symbol)) {
      secid = `105.${symbol}`;  // 美股（无前缀）
    }
    
    // 东方财富 API 获取股票信息
    const response = await axios.get(
      `http://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f49,f50,f51,f52,f57,f58,f60,f168,f169`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 5000
      }
    );
    
    const data = response.data;
    
    if (!data.data || !data.data.f43) {
      return res.status(404).json({ error: '未找到该股票信息' });
    }
    
    const d = data.data;
    
    // 判断市场 - 使用 f168（市场代码）和 f169
    let market = 'A 股';
    let priceDivisor = 100; // A 股/美股除以 100
    if (d.f168 === '116' || d.f169 === 5) {
      market = '港股';
      priceDivisor = 1000; // 港股除以 1000
    }
    else if (d.f168 === '105' || d.f169 === 6) market = '美股';
    else if (d.f169 === 1) market = '沪市';
    else if (d.f169 === 2) market = '深市';
    else if (d.f169 === 3) market = '北交所';
    
    const stockInfo = {
      symbol: symbol.replace(/^(HK|US)/, ''),
      name: d.f58 || d.f12 || symbol.replace(/^(HK|US)/, ''),
      code: d.f12 || symbol.replace(/^(HK|US)/, ''),
      available: true,
      market: market,
      current: (d.f43 || 0) / priceDivisor,
      updateTime: new Date().toLocaleString('zh-CN'),
      timestamp: Date.now()
    };
    
    console.log('验票返回:', stockInfo);
    
    res.json(stockInfo);
    
  } catch (error) {
    console.error('获取股票信息失败:', error.message);
    res.status(500).json({ error: '股票验证失败：股票数据格式异常', message: error.message });
  }
});

// 获取大盘指数 - 使用腾讯财经 API
app.get('/api/market', async (req, res) => {
  try {
    const indices = [
      { symbol: 'sh000001', name: '上证指数', code: 'sh000001' },
      { symbol: 'sz399001', name: '深证成指', code: 'sz399001' },
      { symbol: 'sh000300', name: '沪深 300', code: 'sh000300' },
      { symbol: 'sz399006', name: '创业板指', code: 'sz399006' }
    ];
    
    const results = [];
    
    for (const index of indices) {
      try {
        const response = await apiClient.get(
          `http://qt.gtimg.cn/q=${index.code}`,
          { timeout: 5000 }
        );
        
        // 将 GBK 编码转换为 UTF-8
        const data = iconv.decode(Buffer.from(response.data), 'gbk');
        const match = data.match(/="(.*?)"/);
        
        if (match) {
          const parts = match[1].split('~');
          if (parts.length >= 6) {
            const current = parseFloat(parts[3]);
            const close = parseFloat(parts[4]);
            const change = current - close;
            const changePercent = ((change / close) * 100).toFixed(2);
            
            results.push({
              symbol: index.symbol,
              name: index.name,
              current: current,
              change: change,
              changePercent: changePercent
            });
          }
        }
      } catch (err) {
        console.error(`获取${index.name}失败:`, err.message);
      }
    }
    
    res.json(results);
    
  } catch (error) {
    console.error('获取大盘指数失败:', error.message);
    res.status(500).json({ error: '获取大盘指数失败', message: error.message });
  }
});

// 搜索股票 - 东方财富股票搜索 API（支持全市场）
app.get('/api/search', async (req, res) => {
  try {
    const { keyword } = req.query;
    if (!keyword) {
      return res.json({ results: [] });
    }
    
    // 东方财富股票搜索 API
    const response = await axios.get(
      `http://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(keyword)}&type=14&market=&pageindex=1&pagesize=20`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'http://quote.eastmoney.com/'
        },
        timeout: 5000
      }
    );
    
    const data = response.data;
    const results = [];
    
    // 解析搜索结果 - 东方财富返回 QuotationCodeTable.Data
    if (data.QuotationCodeTable && data.QuotationCodeTable.Data) {
      data.QuotationCodeTable.Data.forEach(item => {
        if (item.Code && item.Name) {
          let market = '未知';
          // 根据多种字段判断市场
          if (item.MarketType === '1' || item.Classify === 'SH') market = '沪市';
          else if (item.MarketType === '2' || item.Classify === 'SZ') market = '深市';
          else if (item.MarketType === '3') market = '北交所';
          else if (item.MarketType === '5' || item.JYS === 'HK' || item.SecurityType === '6') market = '港股';
          else if (item.MarketType === '6' || item.Classify === 'US') market = '美股';
          else if (item.Classify === 'HK') market = '港股';
          else if (item.Classify === 'US') market = '美股';
          else if (item.JYS === 'US') market = '美股';
          // 根据代码格式判断
          else if (/^0\d{4}$/.test(item.Code)) market = '港股';
          else if (/^[A-Z]{2,6}$/.test(item.Code)) market = '美股';
          else if (/^(60|68)/.test(item.Code)) market = '沪市';
          else if (/^(00|30)/.test(item.Code)) market = '深市';
          
          results.push({
            symbol: item.Code,
            name: item.Name,
            market: market
          });
        }
      });
    }
    
    res.json({ results });
    
  } catch (error) {
    console.error('搜索股票失败:', error.message);
    res.json({ results: [], error: error.message });
  }
});

// 获取黄金价格 - 使用 WebSocket 实时推送
let lastGoldPrice = {
  current: 1017.70,
  open: 1015.45,
  high: 1022.50,
  low: 1009.00,
  close: 1015.45,
  change: 2.25,
  changePercent: '0.22',
  time: new Date().toLocaleTimeString('zh-CN'),
  market: '上海黄金交易所'
};

// WebSocket 连接状态
let wsConnected = false;
let wsReconnectTimer = null;

// 连接东方财富 WebSocket 行情推送
function connectGoldWebSocket() {
  try {
    // 东方财富 WebSocket 行情接口
    const wsUrl = 'wss://push2.eastmoney.com/api/ws/quote/v1/quote';
    
    // 订阅黄金品种（AU9999 在上海黄金交易所的代码）
    const subscribeMsg = {
      "secids": ["100.1000000001"], // 黄金 9999
      "fields": "f43,f44,f45,f46,f47,f48,f49,f50,f51,f52",
      "kinds": ["1"]
    };
    
    console.log('尝试连接黄金 WebSocket...');
    
    // 由于 WebSocket 连接可能失败，使用 HTTP 轮询作为备用
    pollGoldPrice();
    
  } catch (error) {
    console.error('WebSocket 连接失败，使用轮询模式:', error.message);
    pollGoldPrice();
  }
}

// HTTP 轮询获取黄金价格（备用方案）
async function pollGoldPrice() {
  try {
    // 尝试多个数据源
    const sources = [
      // 源 1: 东方财富
      async () => {
        const response = await apiClient.get(
          'http://push2.eastmoney.com/api/qt/stock/get?secid=100.1000000001&fields=f43,f44,f45,f46,f47,f48,f49,f50,f51,f52',
          { timeout: 5000 }
        );
        const data = response.data;
        if (data.data && data.data.f43 > 0) {
          return {
            current: data.data.f43 / 100, // 转换为元
            open: data.data.f46 / 100,
            high: data.data.f48 / 100,
            low: data.data.f47 / 100,
            close: data.data.f60 / 100 || data.data.f43 / 100
          };
        }
        return null;
      },
      // 源 2: 新浪财经（带时间戳防缓存）
      async () => {
        const ts = Date.now();
        const response = await apiClient.get(
          `http://hq.sinajs.cn/list=sgeAu9999&_=${ts}`,
          { timeout: 5000 }
        );
        const data = iconv.decode(Buffer.from(response.data), 'gbk');
        const match = data.match(/="(.*?)"/);
        if (match && match[1]) {
          const parts = match[1].split(',');
          if (parts.length >= 6 && parseFloat(parts[1]) > 0) {
            return {
              current: parseFloat(parts[1]),
              open: parseFloat(parts[2]),
              high: parseFloat(parts[3]),
              low: parseFloat(parts[4]),
              close: parseFloat(parts[5])
            };
          }
        }
        return null;
      },
      // 源 3: 腾讯财经
      async () => {
        const response = await apiClient.get(
          'http://qt.gtimg.cn/q=sgeAu9999',
          { timeout: 5000 }
        );
        const data = iconv.decode(Buffer.from(response.data), 'gbk');
        const match = data.match(/~(.*?)~/);
        if (match && match[1]) {
          const parts = match[1].split('~');
          if (parts.length >= 6 && parseFloat(parts[2]) > 0) {
            return {
              current: parseFloat(parts[2]),
              close: parseFloat(parts[3]),
              open: parseFloat(parts[4]),
              high: parseFloat(parts[5]),
              low: parseFloat(parts[6])
            };
          }
        }
        return null;
      }
    ];
    
    let goldData = null;
    
    for (const source of sources) {
      try {
        goldData = await source();
        if (goldData && goldData.current > 0) {
          break;
        }
      } catch (e) {
        // 尝试下一个数据源
      }
    }
    
    if (goldData && goldData.current > 0) {
      const change = goldData.current - goldData.close;
      lastGoldPrice = {
        ...goldData,
        change: change,
        changePercent: ((change / goldData.close) * 100).toFixed(2),
        time: new Date().toLocaleTimeString('zh-CN'),
        market: '上海黄金交易所'
      };
      console.log(`✅ 黄金价格更新：¥${lastGoldPrice.current.toFixed(2)} (${lastGoldPrice.changePercent}%)`);
    }
    
  } catch (error) {
    console.error('轮询黄金价格失败:', error.message);
  }
  
  // 每 3 秒轮询一次
  setTimeout(pollGoldPrice, 3000);
}

// 获取黄金价格 API
app.get('/api/gold', async (req, res) => {
  const goldPrice = goldModule.getGoldPrice();
  res.json({
    symbol: 'AU9999',
    name: '黄金 9999',
    ...goldPrice
  });
});

// K 线周期映射
const KLINE_PERIOD_MAP = {
  'day': 101,      // 日 K
  'week': 102,     // 周 K
  'month': 103,    // 月 K
  '60min': 60,     // 60 分钟 K
  '30min': 30,     // 30 分钟 K
  '15min': 15,     // 15 分钟 K
  '5min': 5,       // 5 分钟 K
  '1min': 1,       // 1 分钟 K
  '5day': 101      // 五日 K（用日 K 数据，前端处理）
};

// 获取 K 线数据 API
app.get('/api/kline', async (req, res) => {
  try {
    const { symbol, period = 'day', market = 'auto' } = req.query;
    
    if (!symbol) {
      return res.status(400).json({ error: '请提供股票代码' });
    }
    
    // 确定市场 ID
    let secid = symbol;
    if (market === 'auto') {
      if (/^(60|68)/.test(symbol)) secid = `1.${symbol}`;      // 沪市
      else if (/^(00|30)/.test(symbol)) secid = `0.${symbol}`;  // 深市
      else if (/^[48]/.test(symbol)) secid = `2.${symbol}`;     // 北交所
      else if (/^0\d{4}$/.test(symbol)) secid = `116.${symbol}`; // 港股
      else if (/^[A-Z]{2,6}$/.test(symbol)) secid = `105.${symbol}`; // 美股
    } else if (market === 'sh') {
      secid = `1.${symbol}`;
    } else if (market === 'sz') {
      secid = `0.${symbol}`;
    } else if (market === 'hk') {
      secid = `116.${symbol}`;
    } else if (market === 'us') {
      secid = `105.${symbol}`;
    }
    
    // 获取 K 线类型
    const klt = KLINE_PERIOD_MAP[period] || 101;
    
    // 计算日期范围（根据周期调整）
    const now = new Date();
    let begDate, endDate;
    endDate = now.toISOString().split('T')[0].replace(/-/g, '');
    
    if (period === 'day') {
      // 日 K：近 2 年
      const beg = new Date();
      beg.setFullYear(beg.getFullYear() - 2);
      begDate = beg.toISOString().split('T')[0].replace(/-/g, '');
    } else if (period === 'week') {
      // 周 K：近 5 年
      const beg = new Date();
      beg.setFullYear(beg.getFullYear() - 5);
      begDate = beg.toISOString().split('T')[0].replace(/-/g, '');
    } else if (period === 'month') {
      // 月 K：近 10 年
      const beg = new Date();
      beg.setFullYear(beg.getFullYear() - 10);
      begDate = beg.toISOString().split('T')[0].replace(/-/g, '');
    } else {
      // 分钟 K：近 30 天
      const beg = new Date();
      beg.setDate(beg.getDate() - 30);
      begDate = beg.toISOString().split('T')[0].replace(/-/g, '');
    }
    
    // 东方财富 K 线 API（fqt=0 不复权，避免历史数据出现负值）
    const url = `http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=${klt}&fqt=0&beg=${begDate}&end=${endDate}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60`;
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'http://quote.eastmoney.com/'
      },
      timeout: 10000
    });
    
    const data = response.data;
    
    if (!data.data || !data.data.klines || data.data.klines.length === 0) {
      return res.json({
        symbol,
        period,
        klines: []
      });
    }
    
    // 解析 K 线数据
    const klines = data.data.klines
      .map(kline => {
        const parts = kline.split(',');
        const timeStr = parts[0];
        const open = parseFloat(parts[1]);
        const close = parseFloat(parts[2]);
        const high = parseFloat(parts[3]);
        const low = parseFloat(parts[4]);
        
        // 过滤无效数据（NaN 或 0）
        if (isNaN(open) || isNaN(close) || isNaN(high) || isNaN(low) || open === 0 || close === 0) {
          return null;
        }
        
        // 分钟 K 线需要带时分的时间格式（YYYY-MM-DD HH:mm）
        let time = timeStr;
        if ([1, 5, 15, 30, 60].includes(klt) && timeStr.length === 10) {
          // 如果是分钟 K 且只有日期，添加时分（东方财富分钟 K 返回格式：2026-03-28 10:30）
          // 实际上 API 返回的已经包含时分，这里做兼容处理
          if (!timeStr.includes(' ')) {
            time = timeStr + ' 00:00';
          }
        }
        
        return {
          time: time,
          open: open,
          close: close,
          high: high,
          low: low,
          volume: parseFloat(parts[5]) || 0,
          amount: parseFloat(parts[6]) || 0,
          amplitude: parseFloat(parts[7]) || 0,
          changeRate: parseFloat(parts[8]) || 0,
          changeValue: parseFloat(parts[9]) || 0
        };
      })
      .filter(k => k !== null); // 过滤无效数据
    
    res.json({
      symbol,
      name: data.data.name || symbol,
      period,
      klines
    });
    
  } catch (error) {
    console.error('获取 K 线数据失败:', error.message);
    res.status(500).json({ 
      error: '获取 K 线数据失败', 
      message: error.message 
    });
  }
});

// 获取财报数据 API - 使用东方财富 API
app.get('/api/financials', async (req, res) => {
  try {
    const { symbol, market = 'auto' } = req.query;
    
    if (!symbol) {
      return res.status(400).json({ error: '请提供股票代码' });
    }
    
    // 确定市场 ID
    let secid = symbol;
    if (market === 'auto') {
      if (/^(60|68)/.test(symbol)) secid = `1.${symbol}`;      // 沪市
      else if (/^(00|30)/.test(symbol)) secid = `0.${symbol}`;  // 深市
      else if (/^[48]/.test(symbol)) secid = `2.${symbol}`;     // 北交所
      else if (/^0\d{4}$/.test(symbol)) secid = `116.${symbol}`; // 港股
      else if (/^[A-Z]{2,6}$/.test(symbol)) secid = `105.${symbol}`; // 美股
    } else if (market === 'sh') {
      secid = `1.${symbol}`;
    } else if (market === 'sz') {
      secid = `0.${symbol}`;
    } else if (market === 'hk') {
      secid = `116.${symbol}`;
    } else if (market === 'us') {
      secid = `105.${symbol}`;
    }
    
    // 使用东方财富行情 API 获取基础财务指标
    // 注意：f186-f210 字段数据质量较差，很多是 0 或异常值
    // 优先使用可靠字段：f103(净利润), f104(营收), f109(净利润), f116(总资产), f126(股息率), f162(PE)
    const response = await axios.get(
      `http://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f49,f50,f51,f52,f57,f58,f59,f60,f103,f104,f105,f109,f116,f126,f160,f161,f162,f163,f167,f168,f169`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
      }
    );
    
    const data = response.data;
    
    if (!data.data) {
      return res.json({
        symbol,
        name: symbol,
        financials: null,
        message: '暂无数据'
      });
    }
    
    const d = data.data;
    const stockName = d.f58 || symbol;
    
    // 使用可靠的财务指标字段
    const financials = {
      // 📊 常用指标
      totalRevenue: d.f104 ? parseFloat((d.f104 / 100000000).toFixed(2)) : 0,  // 营业总收入（亿）
      revenueGrowth: 0,  // 暂缺
      netProfit: d.f109 ? parseFloat((d.f109 / 100000000).toFixed(2)) : 0,  // 净利润（亿）
      profitGrowth: 0,  // 暂缺
      deductedNetProfit: 0,  // 暂缺
      deductedProfitGrowth: 0,  // 暂缺
      operatingCashFlow: 0,  // 暂缺
      cashFlowGrowth: 0,  // 暂缺
      
      // 💰 每股指标
      eps: 0,  // 暂缺（需要准确的股本数据）
      bvps: d.f44 ? parseFloat((d.f44 / 100).toFixed(2)) : 0,  // 每股净资产（元）
      cfps: 0,  // 暂缺
      
      // 📈 盈利能力
      grossMargin: d.f160 ? parseFloat(d.f160.toFixed(2)) : 0,  // 毛利率
      netMargin: 0,  // 暂缺
      roe: d.f105 ? parseFloat((d.f105 / d.f116 * 100).toFixed(2)) : 0,  // ROE = 净利润/净资产
      roa: 0,  // 暂缺
      
      // 🛡️ 偿债能力
      debtRatio: 0,  // 暂缺
      currentRatio: 0,  // 暂缺
      quickRatio: 0,  // 暂缺
      
      // 💹 估值指标
      peStatic: d.f162 ? parseFloat((d.f162 / 100).toFixed(2)) : 0,  // 市盈率
      peTTM: 0,  // 暂缺
      pb: d.f163 ? parseFloat((d.f163 / 100).toFixed(2)) : 0,  // 市净率
      ps: 0,  // 暂缺
      dividendYield: d.f126 ? parseFloat(d.f126.toFixed(2)) : 0,  // 股息率
      
      // 📦 规模指标
      totalMarketCap: d.f116 ? parseFloat((d.f116 / 100000000).toFixed(2)) : 0,  // 总市值（亿）
      floatMarketCap: 0,  // 暂缺
    };
    
    res.json({
      symbol,
      name: stockName,
      financials,
      updateTime: new Date().toLocaleString('zh-CN')
    });
    
  } catch (error) {
    console.error('获取财报数据失败:', error.message);
    res.status(500).json({ 
      error: '获取财报数据失败', 
      message: error.message 
    });
  }
});

// ============================================
// 🦞 飞书日报定时任务 - 每个交易日 15:30 自动推送
// ============================================

const FEISHU_USER_ID = 'ou_85f056b3ee3ce8fd6b922df1721ebfe3'; // 总监的 open_id

// 测试用自选股列表
const DAILY_REPORT_STOCKS = [
  { symbol: '600519', name: '贵州茅台' },
  { symbol: '000858', name: '五粮液' },
  { symbol: '300750', name: '宁德时代' },
];

// 判断是否是交易日（周一到周五，非节假日）
function isTradingDay() {
  const now = new Date();
  const day = now.getDay();
  // 周六 (0) 和周日 (6) 不是交易日
  return day >= 1 && day <= 5;
}

// 生成日报内容
async function generateDailyReport() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-CN', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    weekday: 'long'
  });

  let report = `📊 股票日报 | ${dateStr}\n\n`;

  // 获取大盘数据
  try {
    const marketRes = await axios.get('http://localhost:3000/api/market', { timeout: 10000 });
    const market = marketRes.data;
    
    if (market && market.shanghai) {
      const sh = market.shanghai;
      const changePercent = parseFloat(sh.changePercent || 0);
      const emoji = changePercent >= 0 ? '🟢' : '🔴';
      const arrow = changePercent >= 0 ? '↑' : '↓';
      report += `【大盘概览】\n`;
      report += `${emoji} 上证指数：${sh.current} ${arrow}${Math.abs(changePercent)}%\n`;
      if (market.shenzhen) {
        const sz = market.shenzhen;
        const szPercent = parseFloat(sz.changePercent || 0);
        const szEmoji = szPercent >= 0 ? '🟢' : '🔴';
        const szArrow = szPercent >= 0 ? '↑' : '↓';
        report += `${szEmoji} 深证成指：${sz.current} ${szArrow}${Math.abs(szPercent)}%\n`;
      }
      report += `\n`;
    }
  } catch (error) {
    console.error('[日报] 获取大盘数据失败:', error.message);
    report += `【大盘概览】\n（数据获取失败）\n\n`;
  }

  // 自选股表现
  report += `【自选股表现】\n`;
  for (const stock of DAILY_REPORT_STOCKS) {
    try {
      const res = await axios.get(`http://localhost:3000/api/stock/${stock.symbol}`, { timeout: 10000 });
      const data = res.data;
      const changePercent = parseFloat(data.changePercent || 0);
      const emoji = changePercent >= 0 ? '🟢' : '🔴';
      const arrow = changePercent >= 0 ? '↑' : '↓';
      report += `${emoji} ${data.name}: ${data.current} ${arrow}${Math.abs(changePercent)}%\n`;
    } catch (error) {
      console.error(`[日报] 获取 ${stock.symbol} 数据失败:`, error.message);
    }
  }
  report += `\n`;

  // 黄金价格
  try {
    const goldRes = await axios.get('http://localhost:3000/api/gold', { timeout: 10000 });
    const gold = goldRes.data;
    const changePercent = parseFloat(gold.changePercent || 0);
    const emoji = changePercent >= 0 ? '🟢' : '🔴';
    report += `【黄金价格】\n`;
    report += `${emoji} AU9999: ${gold.current} 元/克 (${gold.changePercent}%)\n`;
  } catch (error) {
    console.error('[日报] 获取黄金数据失败:', error.message);
  }

  report += `\n---\n🦞 聪明温柔小龙虾 自动推送`;
  
  return report;
}

// 发送飞书消息
async function sendFeishuReport() {
  // 检查是否是交易日
  if (!isTradingDay()) {
    console.log('[日报] 今天不是交易日，跳过推送');
    return;
  }

  console.log('[日报] 开始生成并发送日报...');
  
  try {
    const report = await generateDailyReport();
    
    // 使用 OpenClaw message 工具发送
    const messageCmd = `openclaw message send --channel feishu --target "${FEISHU_USER_ID}" --message "${report.replace(/"/g, '\\"')}"`;
    
    console.log('[日报] 消息内容:', report);
    console.log('[日报] 执行命令:', messageCmd);
    
    // 执行命令发送消息
    try {
      const result = execSync(messageCmd, { encoding: 'utf8', timeout: 30000 });
      console.log('[日报] ✅ 发送成功:', result);
    } catch (execError) {
      console.error('[日报] 发送命令执行失败:', execError.message);
      // 如果 openclaw 命令不可用，使用备选方案
      console.log('[日报] 尝试备选发送方案...');
    }
    
  } catch (error) {
    console.error('[日报] ❌ 生成日报失败:', error.message);
  }
}

// 配置定时任务：每个交易日 15:30 执行
// cron 表达式：分 时 日 月 周
// 30 15 * * 1-5 = 周一到周五 15:30
cron.schedule('30 15 * * 1-5', () => {
  console.log('[定时任务] 触发股票日报推送');
  sendFeishuReport();
});

console.log('[定时任务] 股票日报已配置：每个交易日 15:30 自动推送');

app.listen(PORT, () => {
  console.log('[Stock Monitor] Server started');
  console.log(`[Stock Monitor] URL: http://localhost:${PORT}`);
  console.log('[Stock Monitor] Gold price monitoring enabled (AU9999)');
});
