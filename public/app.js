// 股票数据
let watchlist = JSON.parse(localStorage.getItem('watchlist') || '[]');
let alerts = JSON.parse(localStorage.getItem('alerts') || '[]');
let autoRefreshInterval = null;

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  loadMarketIndex();
  loadGoldPrice();
  renderWatchlist();
  renderAlerts();
  updateUpdateTime();
  
  // 每分钟更新一次时间
  setInterval(updateUpdateTime, 60000);
});

// 更新显示时间
function updateUpdateTime() {
  const now = new Date();
  document.getElementById('updateTime').textContent = now.toLocaleTimeString('zh-CN');
}

// 加载黄金价格
async function loadGoldPrice() {
  try {
    const response = await fetch('/api/gold');
    const data = await response.json();
    
    const container = document.getElementById('goldData');
    container.innerHTML = `
      <div class="gold-main">
        <div class="gold-name">🥇 ${data.name}</div>
        <div class="gold-price">¥${data.current.toFixed(2)}</div>
      </div>
      <div class="gold-change ${data.change >= 0 ? 'up' : 'down'}">
        ${data.change >= 0 ? '↑' : '↓'} ${Math.abs(data.change).toFixed(2)} (${data.changePercent}%)
      </div>
      <div class="gold-detail">
        <div class="gold-detail-item">
          <div class="gold-detail-label">开盘</div>
          <div class="gold-detail-value">¥${data.open.toFixed(2)}</div>
        </div>
        <div class="gold-detail-item">
          <div class="gold-detail-label">最高</div>
          <div class="gold-detail-value">¥${data.high.toFixed(2)}</div>
        </div>
        <div class="gold-detail-item">
          <div class="gold-detail-label">最低</div>
          <div class="gold-detail-value">¥${data.low.toFixed(2)}</div>
        </div>
        <div class="gold-detail-item">
          <div class="gold-detail-label">昨收</div>
          <div class="gold-detail-value">¥${data.close.toFixed(2)}</div>
        </div>
        <div class="gold-detail-item">
          <div class="gold-detail-label">时间</div>
          <div class="gold-detail-value">${data.time}</div>
        </div>
        <div class="gold-detail-item">
          <div class="gold-detail-label">市场</div>
          <div class="gold-detail-value">${data.market}</div>
        </div>
      </div>
    `;
  } catch (error) {
    document.getElementById('goldData').innerHTML = '<div class="loading">加载失败</div>';
  }
}

// 加载大盘指数
async function loadMarketIndex() {
  try {
    const response = await fetch('/api/market');
    const data = await response.json();
    
    const container = document.getElementById('marketData');
    container.innerHTML = data.map(index => `
      <div class="index-card">
        <div class="index-name">${index.name}</div>
        <div class="index-value ${index.change >= 0 ? 'up' : 'down'}">
          ${index.current.toFixed(2)}
        </div>
        <div class="index-change ${index.change >= 0 ? 'up' : 'down'}">
          ${index.change >= 0 ? '↑' : '↓'} ${Math.abs(index.change).toFixed(2)} (${index.changePercent}%)
        </div>
      </div>
    `).join('');
  } catch (error) {
    document.getElementById('marketData').innerHTML = '<div class="loading">加载失败</div>';
  }
}

// 搜索股票
async function searchStock() {
  const keyword = document.getElementById('searchInput').value.trim();
  if (!keyword) {
    alert('请输入股票代码或名称');
    return;
  }
  
  const resultsDiv = document.getElementById('searchResults');
  resultsDiv.innerHTML = '<div class="loading">搜索中...</div>';
  
  try {
    const response = await fetch(`/api/search?keyword=${encodeURIComponent(keyword)}`);
    const data = await response.json();
    
    if (data.results.length === 0) {
      resultsDiv.innerHTML = '<div class="empty-tip">未找到相关股票</div>';
      return;
    }
    
    resultsDiv.innerHTML = data.results.map(stock => {
      // 根据市场添加前缀
      let displaySymbol = stock.symbol;
      if (stock.market === '港股') {
        displaySymbol = `HK${stock.symbol}`;
      } else if (stock.market === '美股') {
        displaySymbol = `US${stock.symbol}`;
      }
      return `
        <div class="search-item" onclick="addStockBySymbol('${displaySymbol}', '${stock.name}')">
          <strong>${stock.name}</strong> (${stock.symbol})<br>
          <small>${stock.market}</small>
        </div>
      `;
    }).join('');
  } catch (error) {
    resultsDiv.innerHTML = '<div class="empty-tip">搜索失败</div>';
  }
}

// 添加股票到自选
function addStockBySymbol(symbol, name) {
  // 存储股票信息
  window.pendingStock = { symbol, name };
  document.getElementById('stockSymbol').value = symbol;
  addStock();
  document.getElementById('searchResults').innerHTML = '';
  document.getElementById('searchInput').value = '';
}

// 添加自选股
async function addStock() {
  let input = document.getElementById('stockSymbol').value.trim();
  if (!input) {
    alert('请输入股票代码或名称');
    return;
  }
  
  let symbol = input;
  // 如果不是纯数字，先搜索获取代码
  if (!/^\d+$/.test(input.replace(/^(HK|US)/, ''))) {
    try {
      const searchResponse = await fetch(`/api/search?keyword=${encodeURIComponent(input)}`);
      const searchData = await searchResponse.json();
      
      if (!searchData.results || searchData.results.length === 0) {
        alert(`未找到股票：${input}`);
        return;
      }
      
      symbol = searchData.results[0].symbol;
      if (searchData.results[0].market === '港股') symbol = 'HK' + symbol;
      else if (searchData.results[0].market === '美股') symbol = 'US' + symbol;
    } catch (e) {
      alert('搜索失败');
      return;
    }
  }
  
  const cleanSymbol = symbol.replace(/^(HK|US)/, '');
  if (watchlist.some(s => s.replace(/^(HK|US)/, '') === cleanSymbol)) {
    alert('该股票已在自选列表中');
    document.getElementById('stockSymbol').value = '';
    return;
  }
  
  try {
    const response = await fetch(`/api/stock/${symbol}/info`);
    const data = await response.json();
    
    if (data.error) {
      alert(`股票验证失败：${data.error}`);
      return;
    }
    
    watchlist.push(cleanSymbol);
    localStorage.setItem('watchlist', JSON.stringify(watchlist));
    renderWatchlist();
    document.getElementById('stockSymbol').value = '';
  } catch (error) {
    alert('添加失败，请检查股票代码');
  }
}

// 删除自选股
function removeStock(symbol) {
  watchlist = watchlist.filter(s => s !== symbol);
  localStorage.setItem('watchlist', JSON.stringify(watchlist));
  renderWatchlist();
}

// 渲染自选列表
async function renderWatchlist() {
  const container = document.getElementById('watchlist');
  
  if (watchlist.length === 0) {
    container.innerHTML = '<p class="empty-tip">暂无自选股，添加股票代码开始监控</p>';
    return;
  }
  
  container.innerHTML = '<div class="loading">加载中...</div>';
  
  try {
    const response = await fetch(`/api/stocks?symbols=${watchlist.join(',')}`);
    const stocks = await response.json();
    
    container.innerHTML = stocks.map(stock => `
      <div class="stock-card">
        <button class="remove-btn" onclick="removeStock('${stock.symbol}')">✕</button>
        <button class="kline-btn" onclick="openKlineModal('${stock.symbol}')">📊 K 线</button>
        <div class="stock-header">
          <span class="stock-name">${stock.name}</span>
          <span class="stock-symbol">${stock.symbol}</span>
        </div>
        <div class="stock-price ${stock.change >= 0 ? 'up' : 'down'}">
          ¥${stock.current.toFixed(2)}
        </div>
        <div class="stock-change ${stock.change >= 0 ? 'up' : 'down'}">
          ${stock.change >= 0 ? '↑' : '↓'} ${Math.abs(stock.change).toFixed(2)} (${stock.changePercent}%)
        </div>
        <div class="stock-detail">
          <span>最高：<strong>${stock.high.toFixed(2)}</strong></span>
          <span>最低：<strong>${stock.low.toFixed(2)}</strong></span>
          <span>成交量：<strong>${formatVolume(stock.volume)}</strong></span>
          <span>成交额：<strong>${formatAmount(stock.amount)}</strong></span>
          <span>昨收：<strong>${stock.close.toFixed(2)}</strong></span>
          <span>时间：<strong>${stock.time}</strong></span>
        </div>
      </div>
    `).join('');
    
    // 检查预警
    checkAlerts(stocks);
    
  } catch (error) {
    container.innerHTML = '<div class="empty-tip">加载失败</div>';
  }
}

// 格式化成交量
function formatVolume(volume) {
  if (volume >= 100000000) {
    return (volume / 100000000).toFixed(2) + '亿手';
  } else if (volume >= 10000) {
    return (volume / 10000).toFixed(2) + '万手';
  }
  return volume.toFixed(0) + '手';
}

// 格式化成交额
function formatAmount(amount) {
  if (amount >= 100000000) {
    return (amount / 100000000).toFixed(2) + '亿';
  } else if (amount >= 10000) {
    return (amount / 10000).toFixed(2) + '万';
  }
  return amount.toFixed(0);
}

// 刷新全部
function refreshAll() {
  loadMarketIndex();
  renderWatchlist();
}

// 自动刷新
function toggleAutoRefresh() {
  const btn = document.getElementById('autoRefreshBtn');
  
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
    btn.textContent = '▶️ 自动刷新：关';
    btn.classList.remove('active');
  } else {
    refreshAll();
    autoRefreshInterval = setInterval(refreshAll, 30000); // 30 秒刷新一次
    btn.textContent = '⏸️ 自动刷新：开';
    btn.classList.add('active');
  }
}

// 验票
async function verifyStock() {
  let input = document.getElementById('verifySymbol').value.trim();
  if (!input) {
    alert('请输入股票代码或名称');
    return;
  }
  
  const resultDiv = document.getElementById('verifyResult');
  resultDiv.innerHTML = '<div class="loading">验证中...</div>';
  
  try {
    let symbol = input;
    // 如果不是纯数字，先搜索获取代码
    if (!/^\d+$/.test(input.replace(/^(HK|US)/, ''))) {
      const searchResponse = await fetch(`/api/search?keyword=${encodeURIComponent(input)}`);
      const searchData = await searchResponse.json();
      
      if (!searchData.results || searchData.results.length === 0) {
        resultDiv.innerHTML = `<div class="empty-tip">未找到股票：${input}</div>`;
        return;
      }
      
      symbol = searchData.results[0].symbol;
      if (searchData.results[0].market === '港股') symbol = 'HK' + symbol;
      else if (searchData.results[0].market === '美股') symbol = 'US' + symbol;
    }
    
    // 获取实时行情
    const quoteResponse = await fetch(`/api/stock/${symbol}`);
    const quoteData = await quoteResponse.json();
    
    if (quoteData.error) {
      resultDiv.innerHTML = `<div class="empty-tip">验证失败：${quoteData.error}</div>`;
      return;
    }
    
    // 获取基本信息
    const infoResponse = await fetch(`/api/stock/${symbol}/info`);
    const infoData = await infoResponse.json();
    
    resultDiv.innerHTML = `
      <div class="verify-info">
        <div class="verify-item">
          <div class="verify-label">股票名称</div>
          <div class="verify-value">${quoteData.name}</div>
        </div>
        <div class="verify-item">
          <div class="verify-label">股票代码</div>
          <div class="verify-value">${symbol}</div>
        </div>
        <div class="verify-item">
          <div class="verify-label">当前价格</div>
          <div class="verify-value ${quoteData.change >= 0 ? 'up' : 'down'}">
            ¥${quoteData.current.toFixed(2)}
          </div>
        </div>
        <div class="verify-item">
          <div class="verify-label">涨跌幅</div>
          <div class="verify-value ${quoteData.change >= 0 ? 'up' : 'down'}">
            ${quoteData.change >= 0 ? '↑' : '↓'} ${Math.abs(quoteData.changePercent)}%
          </div>
        </div>
        <div class="verify-item">
          <div class="verify-label">交易市场</div>
          <div class="verify-value">${infoData.market}</div>
        </div>
        <div class="verify-item">
          <div class="verify-label">验证状态</div>
          <div class="verify-value" style="color: #27ae60;">✅ 有效</div>
        </div>
        <div class="verify-item">
          <div class="verify-label">更新时间</div>
          <div class="verify-value">${infoData.updateTime || new Date().toLocaleString('zh-CN')}</div>
        </div>
        <div class="verify-item">
          <div class="verify-label">数据时间戳</div>
          <div class="verify-value">${infoData.timestamp ? new Date(infoData.timestamp).toLocaleString('zh-CN') : new Date().toLocaleString('zh-CN')}</div>
        </div>
      </div>
    `;
  } catch (error) {
    resultDiv.innerHTML = '<div class="empty-tip">验证失败，请检查股票代码</div>';
  }
}

// 添加预警
function addAlert() {
  const symbol = document.getElementById('alertSymbol').value.trim();
  const price = parseFloat(document.getElementById('alertPrice').value);
  const type = document.getElementById('alertType').value;
  
  if (!symbol || !price) {
    alert('请填写股票代码和预警价格');
    return;
  }
  
  alerts.push({ symbol, price, type, id: Date.now() });
  localStorage.setItem('alerts', JSON.stringify(alerts));
  renderAlerts();
  
  document.getElementById('alertSymbol').value = '';
  document.getElementById('alertPrice').value = '';
}

// 删除预警
function removeAlert(id) {
  alerts = alerts.filter(a => a.id !== id);
  localStorage.setItem('alerts', JSON.stringify(alerts));
  renderAlerts();
}

// 渲染预警列表
function renderAlerts() {
  const container = document.getElementById('alertList');
  
  if (alerts.length === 0) {
    container.innerHTML = '<p class="empty-tip">暂无预警设置</p>';
    return;
  }
  
  container.innerHTML = alerts.map(alert => `
    <div class="alert-item" id="alert-${alert.id}">
      <div class="alert-info">
        <strong>${alert.symbol}</strong> - 
        ${alert.type === 'above' ? '高于' : '低于'} 
        <strong>¥${alert.price.toFixed(2)}</strong>
      </div>
      <button class="alert-delete" onclick="removeAlert(${alert.id})">删除</button>
    </div>
  `).join('');
}

// 检查预警
function checkAlerts(stocks) {
  stocks.forEach(stock => {
    alerts.forEach(alert => {
      if (alert.symbol === stock.symbol) {
        const alertEl = document.getElementById(`alert-${alert.id}`);
        if (alertEl) {
          let triggered = false;
          if (alert.type === 'above' && stock.current >= alert.price) {
            triggered = true;
          } else if (alert.type === 'below' && stock.current <= alert.price) {
            triggered = true;
          }
          
          if (triggered) {
            alertEl.classList.add('triggered');
            // 可以添加声音或通知
            console.log(`预警触发：${alert.symbol} 当前价格 ${stock.current} ${alert.type === 'above' ? '高于' : '低于'} ${alert.price}`);
          } else {
            alertEl.classList.remove('triggered');
          }
        }
      }
    });
  });
}

// 回车搜索
document.getElementById('searchInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') searchStock();
});

document.getElementById('stockSymbol').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') addStock();
});

document.getElementById('verifySymbol').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') verifyStock();
});
