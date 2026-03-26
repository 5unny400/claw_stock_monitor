const axios = require('axios');

async function test() {
  try {
    // 东方财富黄金行情页面
    const url = 'https://quote.eastmoney.com/center/quote/22.sgeAu9999.html';
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://quote.eastmoney.com/'
      },
      timeout: 5000
    });
    
    console.log('Status:', response.status);
    console.log('Length:', response.data.length);
    
    // 查找价格
    const priceMatch = response.data.match(/Au9999.*?(\d+\.\d+)/);
    if (priceMatch) {
      console.log('Price found:', priceMatch[1]);
    }
    
    // 查找 f43 字段
    const f43Match = response.data.match(/f43["\s:]+(\d+)/);
    if (f43Match) {
      console.log('f43:', f43Match[1] / 100);
    }
    
    // 保存 HTML 到文件
    const fs = require('fs');
    fs.writeFileSync('gold-page.html', response.data);
    console.log('\nSaved to gold-page.html');
    
  } catch (error) {
    console.error('Error:', error.message, error.response?.status);
  }
}

test();
