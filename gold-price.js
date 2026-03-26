// 黄金价格实时监控模块
// 通过华安黄金 ETF(518880) 获取实时黄金价格
// 1 份 ETF ≈ 0.01 克黄金

const axios = require('axios');
const iconv = require('iconv-lite');

const ETF_TO_GRAM = 0.01; // ETF 与黄金克数的换算比例

let lastGoldPrice = {
  current: 1017.70,
  open: 1015.45,
  high: 1022.50,
  low: 1009.00,
  close: 1015.45,
  change: 2.25,
  changePercent: '0.22',
  time: new Date().toLocaleTimeString('zh-CN'),
  market: '上海黄金交易所',
  etfPrice: 10.177
};

// 创建 axios 实例
const apiClient = axios.create({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'http://quote.eastmoney.com/'
  }
});

// 获取黄金价格 - 上海黄金交易所现货价格
async function fetchGoldPrice() {
  const sources = [
    // 源 1: 上海黄金交易所 - AU9999 现货（东方财富接口）
    async () => {
      try {
        const response = await apiClient.get(
          'http://push2.eastmoney.com/api/qt/stock/get?secid=118.AU9999&fields=f43,f44,f45,f46,f47,f48,f49,f50,f51,f52,f60',
          { timeout: 5000 }
        );
        const data = response.data;
        if (data.data && data.data.f43 > 0) {
          // f43: 当前价（分），f60: 昨收（分），转换为元
          const current = data.data.f43 / 100;
          const close = data.data.f60 / 100 || current;
          return {
            current: current,
            close: close,
            open: data.data.f46 / 100 || close,
            high: data.data.f48 / 100 || current,
            low: data.data.f47 / 100 || current,
            time: new Date().toLocaleTimeString('zh-CN'),
            note: 'AU9999 现货'
          };
        }
      } catch (e) {
        // 忽略错误
      }
      return null;
    },
    // 源 2: 新浪财经 - 黄金 9999
    async () => {
      try {
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
              close: parseFloat(parts[2]) || parseFloat(parts[1]),
              open: parseFloat(parts[2]) || parseFloat(parts[1]),
              high: parseFloat(parts[3]),
              low: parseFloat(parts[4]),
              time: parts[31] || '',
              note: '新浪 SGE'
            };
          }
        }
      } catch (e) {
        // 忽略错误
      }
      return null;
    },
    // 源 3: 腾讯财经 - 黄金 9999
    async () => {
      try {
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
              low: parseFloat(parts[6]),
              time: new Date().toLocaleTimeString('zh-CN'),
              note: '腾讯 SGE'
            };
          }
        }
      } catch (e) {
        // 忽略错误
      }
      return null;
    },
    // 源 4: 东方财富 - 黄金 ETF 作为备用（换算成克）
    async () => {
      try {
        const response = await apiClient.get(
          'http://push2.eastmoney.com/api/qt/stock/get?secid=1.518880&fields=f43,f44,f45,f46,f47,f48,f49,f50,f51,f52,f60,f169',
          { timeout: 5000 }
        );
        const data = response.data;
        if (data.data && data.data.f43 > 0) {
          const etfPrice = data.data.f43 / 100;
          const etfClose = (data.data.f60 || data.data.f43) / 100;
          // ETF 换算成黄金现货价格（1 份≈0.01 克）
          return {
            current: etfPrice / ETF_TO_GRAM,
            close: etfClose / ETF_TO_GRAM,
            open: (data.data.f46 / 100) / ETF_TO_GRAM,
            high: (data.data.f48 / 100) / ETF_TO_GRAM,
            low: (data.data.f47 / 100) / ETF_TO_GRAM,
            time: new Date().toLocaleTimeString('zh-CN'),
            note: '华安黄金 ETF'
          };
        }
      } catch (e) {
        // 忽略错误
      }
      return null;
    },
    // 源 2: 新浪财经 - 黄金 ETF（实时）
    async () => {
      const ts = Date.now();
      const response = await apiClient.get(
        `http://hq.sinajs.cn/list=sh518880&_=${ts}`,
        { timeout: 5000 }
      );
      const data = iconv.decode(Buffer.from(response.data), 'gbk');
      const match = data.match(/="(.*?)"/);
      if (match && match[1]) {
        const parts = match[1].split(',');
        if (parts.length >= 32) {
          const etfCurrent = parseFloat(parts[3]) || 0;
          const etfClose = parseFloat(parts[2]) || 0;
          if (etfCurrent > 0 && etfClose > 0) {
            return {
              etfCurrent,
              etfClose,
              etfOpen: parseFloat(parts[1]) || etfClose,
              etfHigh: parseFloat(parts[4]) || etfCurrent,
              etfLow: parseFloat(parts[5]) || etfCurrent,
              time: parts[31] || ''
            };
          }
        }
      }
      return null;
    },
    // 源 3: 腾讯财经 - 黄金 9999（实时）
    async () => {
      const response = await apiClient.get(
        'http://qt.gtimg.cn/q=sgeAu9999',
        { timeout: 5000 }
      );
      const data = iconv.decode(Buffer.from(response.data), 'gbk');
      const match = data.match(/~(.*?)~/);
      if (match && match[1]) {
        const parts = match[1].split('~');
        if (parts.length >= 6) {
          const current = parseFloat(parts[2]) || 0;
          const close = parseFloat(parts[3]) || 0;
          if (current > 0 && close > 0) {
            return {
              etfCurrent: current * ETF_TO_GRAM,
              etfClose: close * ETF_TO_GRAM,
              etfOpen: parseFloat(parts[4]) * ETF_TO_GRAM,
              etfHigh: parseFloat(parts[5]) * ETF_TO_GRAM,
              etfLow: parseFloat(parts[6]) * ETF_TO_GRAM,
              time: new Date().toLocaleTimeString('zh-CN')
            };
          }
        }
      }
      return null;
    }
  ];
  
  for (let i = 0; i < sources.length; i++) {
    try {
      const result = await sources[i]();
      if (result && result.current > 0 && result.close > 0) {
        const change = result.current - result.close;
        
        lastGoldPrice = {
          current: result.current,
          open: result.open,
          high: result.high,
          low: result.low,
          close: result.close,
          change: change,
          changePercent: ((change / result.close) * 100).toFixed(2),
          time: result.time,
          market: `上海黄金交易所 (${result.note || '现货'})`,
          unit: '元/克'
        };
        
        console.log(`✅ 黄金价格更新 (${result.note}): ¥${result.current.toFixed(2)}/克 (${lastGoldPrice.changePercent}%)`);
        return lastGoldPrice;
      }
    } catch (e) {
      // 静默失败，尝试下一个数据源
    }
  }
  
  console.log('⚠️ 所有数据源失败，使用上次数据');
  return lastGoldPrice;
}

// 定时更新
function startPolling(intervalMs = 3000) {
  console.log('🥇 开始轮询黄金价格...');
  
  // 立即获取一次
  fetchGoldPrice().then(price => {
    console.log(`✅ 黄金价格：¥${price.current.toFixed(2)}/克 (${price.changePercent}%) | ${price.market}`);
  });
  
  // 定时轮询
  setInterval(() => {
    fetchGoldPrice().then(price => {
      console.log(`✅ 黄金价格：¥${price.current.toFixed(2)}/克 (${price.changePercent}%) | ${price.market}`);
    });
  }, intervalMs);
}

module.exports = {
  fetchGoldPrice,
  startPolling,
  getGoldPrice: () => lastGoldPrice
};
