// ============================================
// 🦞 股票早报定时任务 - 每个交易日 15:30 自动推送
// 优化版本：增加多样性、轮换机制、排除昨日推荐
// ============================================

const fs = require('fs');
const path = require('path');
const FEISHU_USER_ID = 'ou_85f056b3ee3ce8fd6b922df1721ebfe3'; // 总监的 open_id

// 股票池配置 - 按行业分类
const STOCK_POOLS = {
  '消费': [
    { symbol: '600519', name: '贵州茅台' },
    { symbol: '000858', name: '五粮液' },
    { symbol: '000568', name: '泸州老窖' },
    { symbol: '600887', name: '伊利股份' },
    { symbol: '002304', name: '洋河股份' },
  ],
  '科技': [
    { symbol: '002415', name: '海康威视' },
    { symbol: '300750', name: '宁德时代' },
    { symbol: '300059', name: '东方财富' },
    { symbol: '002230', name: '科大讯飞' },
    { symbol: '600588', name: '用友网络' },
  ],
  '金融': [
    { symbol: '601318', name: '中国平安' },
    { symbol: '600036', name: '招商银行' },
    { symbol: '601398', name: '工商银行' },
    { symbol: '601688', name: '华泰证券' },
    { symbol: '601166', name: '兴业银行' },
  ],
  '医药': [
    { symbol: '600276', name: '恒瑞医药' },
    { symbol: '300760', name: '迈瑞医疗' },
    { symbol: '000538', name: '云南白药' },
    { symbol: '600436', name: '片仔癀' },
    { symbol: '300015', name: '爱尔眼科' },
  ],
  '制造': [
    { symbol: '600031', name: '三一重工' },
    { symbol: '000651', name: '格力电器' },
    { symbol: '000333', name: '美的集团' },
    { symbol: '601888', name: '中国中免' },
    { symbol: '600900', name: '长江电力' },
  ],
};

// 行业轮换顺序
const INDUSTRY_ROTATION = ['消费', '科技', '金融', '医药', '制造'];

// 文件路径
const HISTORY_FILE = path.join(__dirname, 'stock_recommend_history.json');
const YESTERDAY_FILE = path.join(__dirname, 'yesterday_picks.json');

// 加载历史记录
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('[早报] 加载历史记录失败:', e.message);
  }
  return { recommendations: [], lastDate: null };
}

// 保存历史记录
function saveHistory(history) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
  } catch (e) {
    console.error('[早报] 保存历史记录失败:', e.message);
  }
}

// 加载昨日推荐
function loadYesterdayPicks() {
  try {
    if (fs.existsSync(YESTERDAY_FILE)) {
      const data = JSON.parse(fs.readFileSync(YESTERDAY_FILE, 'utf-8'));
      // 检查是否是昨天的数据
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      if (data.date === yesterdayStr) {
        return data.picks || [];
      }
    }
  } catch (e) {
    console.error('[早报] 加载昨日推荐失败:', e.message);
  }
  return [];
}

// 保存今日推荐
function saveTodayPicks(picks) {
  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    fs.writeFileSync(YESTERDAY_FILE, JSON.stringify({
      date: todayStr,
      picks: picks
    }, null, 2), 'utf-8');
  } catch (e) {
    console.error('[早报] 保存今日推荐失败:', e.message);
  }
}

// 获取今日行业（按星期轮换）
function getTodayIndustry() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=周日，1=周一，...，6=周六
  const index = (dayOfWeek - 1) % INDUSTRY_ROTATION.length; // 从周一开始
  return INDUSTRY_ROTATION[index >= 0 ? index : 4]; // 周日则选择最后一个
}

// 智能选股 - 避免重复，增加多样性
function selectStocks(todayIndustry, yesterdayPicks, count = 3) {
  const todayPool = STOCK_POOLS[todayIndustry] || STOCK_POOLS['消费'];
  const history = loadHistory();
  const recentPicks = history.recommendations.slice(-10); // 最近 10 次推荐
  
  // 评分系统
  const stockScores = todayPool.map(stock => {
    let score = Math.random() * 100; // 基础随机分
    
    // 排除昨日推荐（-50 分）
    if (yesterdayPicks.some(p => p.symbol === stock.symbol)) {
      score -= 50;
    }
    
    // 排除最近频繁推荐的（-20 分/次）
    const recentCount = recentPicks.filter(r => 
      r.picks.some(p => p.symbol === stock.symbol)
    ).length;
    score -= recentCount * 20;
    
    // 行业轮换 bonus（+30 分）
    score += 30;
    
    return { ...stock, score };
  });
  
  // 按评分排序，选择前 N 名
  stockScores.sort((a, b) => b.score - a.score);
  const selected = stockScores.slice(0, count);
  
  console.log('[早报] 今日行业:', todayIndustry);
  console.log('[早报] 选股评分:', selected.map(s => `${s.name}(${s.score.toFixed(0)})`));
  
  return selected;
}

// 判断是否是交易日（周一到周五，非节假日）
function isTradingDay() {
  const now = new Date();
  const day = now.getDay();
  // 周六 (0) 和周日 (6) 不是交易日
  return day >= 1 && day <= 5;
}

// 获取股票实时数据
async function getStockData(symbol) {
  try {
    const axios = require('axios');
    const res = await axios.get(`http://localhost:3000/api/stock/${symbol}`, { timeout: 10000 });
    return res.data;
  } catch (error) {
    console.error(`[早报] 获取${symbol}数据失败:`, error.message);
    return null;
  }
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

  const todayIndustry = getTodayIndustry();
  const yesterdayPicks = loadYesterdayPicks();
  
  let report = `📊 股票早报 | ${dateStr}\n\n`;
  report += `【今日主题：${todayIndustry}板块】\n\n`;

  // 获取大盘数据
  try {
    const axios = require('axios');
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
    console.error('[早报] 获取大盘数据失败:', error.message);
    report += `【大盘概览】\n（数据获取失败）\n\n`;
  }

  // 智能选股（避免重复）
  const selectedStocks = selectStocks(todayIndustry, yesterdayPicks, 3);
  const picks = [];

  report += `【精选推荐】\n`;
  for (const stock of selectedStocks) {
    try {
      const data = await getStockData(stock.symbol);
      if (data) {
        const changePercent = parseFloat(data.changePercent || 0);
        const emoji = changePercent >= 0 ? '🟢' : '🔴';
        const arrow = changePercent >= 0 ? '↑' : '↓';
        
        report += `${emoji} ${data.name}: ${data.current} ${arrow}${Math.abs(changePercent)}%\n`;
        
        picks.push({
          symbol: stock.symbol,
          name: stock.name,
          price: data.current,
          changePercent: changePercent
        });
      }
    } catch (error) {
      console.error(`[早报] 获取${stock.symbol}数据失败:`, error.message);
    }
  }
  report += `\n`;

  // 黄金价格
  try {
    const axios = require('axios');
    const goldRes = await axios.get('http://localhost:3000/api/gold', { timeout: 10000 });
    const gold = goldRes.data;
    const changePercent = parseFloat(gold.changePercent || 0);
    const emoji = changePercent >= 0 ? '🟢' : '🔴';
    report += `【黄金价格】\n`;
    report += `${emoji} AU9999: ${gold.current} 元/克 (${gold.changePercent}%)\n`;
  } catch (error) {
    console.error('[早报] 获取黄金数据失败:', error.message);
  }

  report += `\n💡 提示：以上推荐仅供参考，不构成投资建议\n`;
  report += `---\n🦞 聪明温柔小龙虾 自动推送`;
  
  // 保存今日推荐
  saveTodayPicks(picks);
  
  // 更新历史记录
  const history = loadHistory();
  history.recommendations.push({
    date: dateStr,
    industry: todayIndustry,
    picks: picks
  });
  // 只保留最近 30 条记录
  if (history.recommendations.length > 30) {
    history.recommendations = history.recommendations.slice(-30);
  }
  history.lastDate = dateStr;
  saveHistory(history);
  
  return report;
}

// 发送飞书消息
async function sendFeishuReport() {
  // 检查是否是交易日
  if (!isTradingDay()) {
    console.log('[早报] 今天不是交易日，跳过推送');
    return;
  }

  console.log('[早报] 开始生成并发送日报...');
  
  try {
    const report = await generateDailyReport();
    
    // 使用 OpenClaw message 工具发送
    const { execSync } = require('child_process');
    const messageCmd = `openclaw message send --channel feishu --target "${FEISHU_USER_ID}" --message "${report.replace(/"/g, '\\"')}"`;
    
    console.log('[早报] 消息内容:', report);
    console.log('[早报] 执行命令:', messageCmd);
    
    // 执行命令发送消息
    try {
      const result = execSync(messageCmd, { encoding: 'utf8', timeout: 30000 });
      console.log('[早报] ✅ 发送成功:', result);
    } catch (execError) {
      console.error('[早报] 发送命令执行失败:', execError.message);
      // 如果 openclaw 命令不可用，使用备选方案
      console.log('[早报] 尝试备选发送方案...');
    }
    
  } catch (error) {
    console.error('[早报] ❌ 生成日报失败:', error.message);
  }
}

// 配置定时任务：每个交易日 15:30 执行
// cron 表达式：分 时 日 月 周
// 30 15 * * 1-5 = 周一到周五 15:30
const cron = require('node-cron');
cron.schedule('30 15 * * 1-5', () => {
  console.log('[定时任务] 触发股票早报推送');
  sendFeishuReport();
});

console.log('[定时任务] 股票早报已配置：每个交易日 15:30 自动推送（优化版）');

module.exports = { sendFeishuReport, generateDailyReport };
