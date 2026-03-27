const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const iconv = require('iconv-lite');
const goldModule = require('./gold-price');

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
    const current = d.f43 / 100 || 0;
    const close = d.f60 / 100 || current;
    const stockData = {
      symbol: symbol,
      name: d.f58 || d.f12 || symbol,
      open: d.f46 / 100 || current,
      close: close,
      current: current,
      high: d.f48 / 100 || current,
      low: d.f47 / 100 || current,
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
          const current = d.f43 / 100 || 0;
          const close = d.f60 / 100 || current;
          results.push({
            symbol: symbol,
            name: d.f58 || d.f12 || symbol,
            current: current,
            close: close,
            change: (current - close),
            changePercent: close ? ((current - close) / close * 100).toFixed(2) : '0.00',
            volume: d.f47 || 0,
            amount: d.f48 || 0,
            high: d.f48 / 100 || current,
            low: d.f47 / 100 || current,
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
    if (d.f168 === '116' || d.f169 === 5) market = '港股';
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
      current: (d.f43 || 0) / 100,
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
  '1min': 1        // 1 分钟 K
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
    
    // 东方财富 K 线 API
    const url = `http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=${klt}&fqt=1&beg=${begDate}&end=${endDate}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60`;
    
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
    const klines = data.data.klines.map(kline => {
      const parts = kline.split(',');
      return {
        time: parts[0],                    // 日期
        open: parseFloat(parts[1]),        // 开盘价
        close: parseFloat(parts[2]),       // 收盘价
        high: parseFloat(parts[3]),        // 最高价
        low: parseFloat(parts[4]),         // 最低价
        volume: parseFloat(parts[5]) || 0, // 成交量
        amount: parseFloat(parts[6]) || 0, // 成交额
        amplitude: parseFloat(parts[7]) || 0, // 振幅
        changeRate: parseFloat(parts[8]) || 0, // 涨跌幅
        changeValue: parseFloat(parts[9]) || 0 // 涨跌额
      };
    });
    
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

app.listen(PORT, () => {
  console.log(`📈 股票盯票验票系统已启动`);
  console.log(`🌐 访问地址：http://localhost:${PORT}`);
  console.log(`🥇 黄金监控：实时价格 (华安黄金 ETF 518880)`);
});
