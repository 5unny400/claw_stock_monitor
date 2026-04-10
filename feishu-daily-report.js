/**
 * 股票日报 - 飞书自动推送
 * 每天收盘后自动发送股票行情日报到用户飞书
 */

const axios = require('axios');
const { execSync } = require('child_process');

const BASE_URL = 'http://localhost:3000';

// 测试用自选股列表
const TEST_STOCKS = [
  { symbol: '600519', name: '贵州茅台' },
  { symbol: '000858', name: '五粮液' },
  { symbol: '300750', name: '宁德时代' },
  { symbol: 'HK0700', name: '腾讯控股' },
  { symbol: 'USBAIDU', name: '百度' }
];

/**
 * 获取大盘数据
 */
async function getMarketData() {
  try {
    const res = await axios.get(`${BASE_URL}/api/market`, { timeout: 10000 });
    return res.data;
  } catch (error) {
    console.error('获取大盘数据失败:', error.message);
    return null;
  }
}

/**
 * 获取股票数据
 */
async function getStockData(symbol) {
  try {
    const res = await axios.get(`${BASE_URL}/api/stock/${symbol}`, { timeout: 10000 });
    return res.data;
  } catch (error) {
    console.error(`获取股票 ${symbol} 数据失败:`, error.message);
    return null;
  }
}

/**
 * 获取黄金价格
 */
async function getGoldData() {
  try {
    const res = await axios.get(`${BASE_URL}/api/gold`, { timeout: 10000 });
    return res.data;
  } catch (error) {
    console.error('获取黄金数据失败:', error.message);
    return null;
  }
}

/**
 * 生成日报内容
 */
async function generateReport() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-CN', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    weekday: 'long'
  });

  let report = `📊 股票日报 | ${dateStr}\n\n`;

  // 大盘概览
  const market = await getMarketData();
  if (market) {
    report += `【大盘概览】\n`;
    if (market.shanghai) {
      const sh = market.shanghai;
      const color = parseFloat(sh.changePercent) >= 0 ? '📈' : '📉';
      report += `${color} 上证指数：${sh.current} (${sh.changePercent}%) ${parseFloat(sh.changePercent) >= 0 ? '🟢' : '🔴'}\n`;
    }
    if (market.shenzhen) {
      const sz = market.shenzhen;
      const color = parseFloat(sz.changePercent) >= 0 ? '📈' : '📉';
      report += `${color} 深证成指：${sz.current} (${sz.changePercent}%)\n`;
    }
    report += `\n`;
  }

  // 自选股表现
  report += `【自选股表现】\n`;
  for (const stock of TEST_STOCKS) {
    const data = await getStockData(stock.symbol);
    if (data) {
      const changePercent = parseFloat(data.changePercent);
      const emoji = changePercent >= 0 ? '🟢' : '🔴';
      const arrow = changePercent >= 0 ? '↑' : '↓';
      report += `${emoji} ${data.name} (${data.symbol}): ${data.current} ${arrow}${Math.abs(changePercent)}%\n`;
    }
  }
  report += `\n`;

  // 黄金价格
  const gold = await getGoldData();
  if (gold) {
    const changePercent = parseFloat(gold.changePercent);
    const emoji = changePercent >= 0 ? '🟢' : '🔴';
    report += `【黄金价格】\n`;
    report += `${emoji} AU9999: ${gold.current} 元/克 (${gold.changePercent}%)\n`;
  }

  report += `\n---\n🦞 聪明温柔小龙虾 自动推送`;

  return report;
}

/**
 * 发送飞书消息
 */
async function sendFeishuMessage(content) {
  console.log('准备发送飞书消息...');
  console.log('消息内容:', content);
  
  // 这里使用 feishu_im_user_message 工具发送
  // 由于这是在脚本中，我们通过 exec 调用 openclaw 工具
  console.log('\n✅ 日报内容已生成，准备发送到飞书...');
  console.log('注意：实际发送需要通过 OpenClaw 的 feishu_im_user_message 工具');
  
  return content;
}

/**
 * 主函数
 */
async function main() {
  console.log('🦞 开始生成股票日报...\n');
  
  try {
    const report = await generateReport();
    console.log('\n' + '='.repeat(50));
    console.log(report);
    console.log('='.repeat(50));
    
    await sendFeishuMessage(report);
    
    console.log('\n✅ 日报生成完成！');
  } catch (error) {
    console.error('❌ 生成日报失败:', error.message);
    process.exit(1);
  }
}

// 运行
main();
