// K 线图组件 - 使用 Lightweight Charts
// 使用 UMD 全局变量模式（standalone 版本会暴露 LightweightCharts 全局对象）

let chart = null;
let candlestickSeries = null;
let volumeSeries = null;
let ma5Series = null;
let ma10Series = null;
let ma20Series = null;
let currentSymbol = null;
let currentPeriod = 'day';

// 初始化 K 线图表
function initKlineChart() {
  const chartContainer = document.getElementById('klineChart');
  if (!chartContainer) return;

  // 获取容器实际尺寸
  const containerWidth = chartContainer.clientWidth;
  const containerHeight = chartContainer.clientHeight;
  
  // 检查容器是否可见（避免在弹窗隐藏时初始化）
  if (containerWidth <= 150 || containerHeight <= 100) {
    console.warn('K 线容器尺寸过小，跳过初始化:', containerWidth, 'x', containerHeight);
    return;
  }
  
  const width = containerWidth - 150; // 右侧留 120px 给价格轴 +30px 余量
  const height = containerHeight - 100; // 底部留 70px 给时间轴和成交量 +30px 余量

  // 创建图表
  chart = LightweightCharts.createChart(chartContainer, {
    width: width,
    height: height,
    layout: {
      background: { color: '#1a1a2e' },
      textColor: '#d1d4dc',
    },
    grid: {
      vertLines: { color: '#2B2B43' },
      horzLines: { color: '#2B2B43' },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
    },
    timeScale: {
      borderColor: '#2B2B43',
      timeVisible: true,
      secondsVisible: false,
      visible: true,
      rightOffset: 12,  // 右侧留白，让 K 线不贴边
      barSpacing: 10,   // K 线间距
      minBarSpacing: 5, // 最小间距
    },
    rightPriceScale: {
      borderColor: '#2B2B43',
      mode: LightweightCharts.PriceScaleMode.Normal,
      scaleMargins: {
        top: 0.15,  // 顶部留白 15%
        bottom: 0.35, // 底部留白 35%（给成交量）
      },
      minimumVisibleMargin: 0.1, // 坐标轴最小边距
    },
  });

  // 创建 K 线系列
  candlestickSeries = chart.addCandlestickSeries({
    upColor: '#ef5350',        // 红色（涨）
    downColor: '#26a69a',      // 绿色（跌）
    borderVisible: false,
    wickUpColor: '#ef5350',
    wickDownColor: '#26a69a',
  });

  // 创建成交量系列
  volumeSeries = chart.addHistogramSeries({
    color: '#26a69a',
    priceFormat: {
      type: 'volume',
    },
    priceScaleId: '', // 覆盖在 K 图上
  });

  volumeSeries.priceScale().applyOptions({
    scaleMargins: {
      top: 0.88,  // 成交量占底部 12%
      bottom: 0.05, // 底部留白 5%，不贴边
    },
  });

  // 创建均线系列
  ma5Series = chart.addLineSeries({
    color: '#ffa726',
    lineWidth: 1,
    priceLineVisible: false,
  });

  ma10Series = chart.addLineSeries({
    color: '#29b6f6',
    lineWidth: 1,
    priceLineVisible: false,
  });

  ma20Series = chart.addLineSeries({
    color: '#ab47bc',
    lineWidth: 1,
    priceLineVisible: false,
  });

  // 响应式调整
  window.addEventListener('resize', () => {
    if (chart && chartContainer) {
      const newWidth = Math.max(0, chartContainer.clientWidth - 150);
      const newHeight = Math.max(0, chartContainer.clientHeight - 100);
      if (newWidth > 0 && newHeight > 0) {
        chart.applyOptions({
          width: newWidth,
          height: newHeight,
        });
      }
    }
  });
}

// 导出到全局（供 app.js 调用）
window.initKlineChart = initKlineChart;

// 计算移动平均线
function calculateMA(data, period) {
  const maData = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      // 跳过数据不足的点，不添加到数组
      continue;
    }

    let sum = 0;
    let validCount = 0;
    for (let j = 0; j < period; j++) {
      const close = data[i - j].close;
      if (close !== null && close !== undefined && !isNaN(close)) {
        sum += close;
        validCount++;
      }
    }

    if (validCount === period) {
      maData.push({
        time: data[i].time,
        value: sum / period,
      });
    }
  }
  return maData;
}

// 加载 K 线数据
async function loadKlineData(symbol, period = 'day') {
  const loadingEl = document.getElementById('klineLoading');
  const chartEl = document.getElementById('klineChart');
  
  if (loadingEl) loadingEl.style.display = 'block';
  if (chartEl) chartEl.style.opacity = '0.5';

  try {
    // 确定市场
    let market = 'auto';
    if (/^(60|68)/.test(symbol)) market = 'sh';
    else if (/^(00|30)/.test(symbol)) market = 'sz';
    else if (/^0\d{4}$/.test(symbol)) market = 'hk';
    else if (/^[A-Z]{2,6}$/.test(symbol)) market = 'us';

    const response = await fetch(`/api/kline?symbol=${symbol}&period=${period}&market=${market}`);
    const data = await response.json();

    if (data.error) {
      alert('加载 K 线数据失败：' + data.error);
      return;
    }

    if (!data.klines || data.klines.length === 0) {
      console.warn('暂无 K 线数据:', data);
      if (loadingEl) loadingEl.textContent = '暂无数据';
      if (loadingEl) loadingEl.style.display = 'block';
      if (chartEl) chartEl.style.opacity = '1';
      return;
    }

    console.log('K 线原始数据:', data.klines.length, '条');

    // 转换数据格式
    let candleData;
    
    if (period === '5day') {
      // 五日 K：每 5 天合并为一根 K 线
      const rawCandleData = data.klines
        .map(k => ({
          time: k.time.split(' ')[0],
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
          volume: k.volume,
        }))
        .filter(k => !isNaN(k.open) && !isNaN(k.close) && k.open > 0 && k.close > 0);
      
      candleData = [];
      for (let i = 0; i < rawCandleData.length; i += 5) {
        const group = rawCandleData.slice(i, i + 5);
        if (group.length < 2) continue; // 至少需要 2 天数据
        
        candleData.push({
          time: group[group.length - 1].time, // 使用最后一天的日期
          open: group[0].open,                // 第一天的开盘
          high: Math.max(...group.map(d => d.high)), // 最高价
          low: Math.min(...group.map(d => d.low)),   // 最低价
          close: group[group.length - 1].close,      // 最后一天的收盘
        });
      }
    } else {
      let filteredCount = 0;
      candleData = data.klines
        .map(k => {
          // 分钟 K 线使用 Unix 时间戳（秒），日/周/月 K 使用日期字符串
          let time;
          if (period.includes('min')) {
            // 分钟 K：转换为 Unix 时间戳（秒）
            const dateObj = new Date(k.time.replace(' ', 'T'));
            if (isNaN(dateObj.getTime())) {
              filteredCount++;
              return null;
            }
            time = Math.floor(dateObj.getTime() / 1000);
          } else {
            // 日/周/月 K：只取日期部分（字符串格式）
            time = k.time.split(' ')[0];
          }
          
          // 过滤无效数据
          if (isNaN(k.open) || isNaN(k.close) || k.open === 0 || k.close === 0) {
            filteredCount++;
            if (filteredCount <= 3) {
              console.warn(`过滤无效数据：time=${k.time}, open=${k.open}, close=${k.close}`);
            }
            return null;
          }
          
          return {
            time: time,
            open: k.open,
            high: k.high,
            low: k.low,
            close: k.close,
          };
        })
        .filter(k => k !== null); // 过滤无效数据
      
      if (filteredCount > 0) {
        console.log(`数据过滤：原始${data.klines.length}条，过滤${filteredCount}条，剩余${candleData.length}条`);
      }
    }

    console.log('转换后 K 线数据:', candleData.length, '条，示例:', candleData[0]);

    // 成交量数据（红色表示涨，绿色表示跌）
    const volumeData = data.klines
      .map(k => {
        // 分钟 K 使用 Unix 时间戳，日/周/月 K 使用日期字符串
        let time;
        if (period.includes('min')) {
          const dateObj = new Date(k.time.replace(' ', 'T'));
          if (isNaN(dateObj.getTime())) {
            return null;
          }
          time = Math.floor(dateObj.getTime() / 1000);
        } else {
          time = k.time.split(' ')[0];
        }
        
        if (isNaN(k.open) || isNaN(k.close) || k.open === 0 || k.close === 0) {
          return null;
        }
        
        return {
          time: time,
          value: k.volume / 10000, // 转换为万手
          color: k.close >= k.open ? '#ef535080' : '#26a69a80',
        };
      })
      .filter(k => k !== null);

    // 更新图表
    if (candlestickSeries) {
      console.log('设置 K 线数据...');
      candlestickSeries.setData(candleData);
      
      // 等待数据设置完成后，调整时间轴以显示所有数据
      setTimeout(() => {
        if (chart) {
          chart.timeScale().fitContent();
          console.log('图表时间轴已适配');
        }
      }, 100);
      
      console.log('K 线数据设置完成');
    }

    if (volumeSeries) {
      volumeSeries.setData(volumeData);
    }

    // 计算并更新均线
    if (ma5Series && document.getElementById('ma5Check')?.checked) {
      ma5Series.setData(calculateMA(candleData, 5));
    } else if (ma5Series) {
      ma5Series.setData([]);
    }

    if (ma10Series && document.getElementById('ma10Check')?.checked) {
      ma10Series.setData(calculateMA(candleData, 10));
    } else if (ma10Series) {
      ma10Series.setData([]);
    }

    if (ma20Series && document.getElementById('ma20Check')?.checked) {
      ma20Series.setData(calculateMA(candleData, 20));
    } else if (ma20Series) {
      ma20Series.setData([]);
    }

    // 更新标题
    const titleEl = document.getElementById('klineTitle');
    if (titleEl) {
      titleEl.textContent = `${data.name || symbol} (${symbol}) - ${getPeriodName(period)}`;
    }

    currentSymbol = symbol;
    currentPeriod = period;

    // 更新周期按钮状态
    document.querySelectorAll('.period-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.period === period);
    });

  } catch (error) {
    console.error('加载 K 线数据失败:', error);
    alert('加载 K 线数据失败：' + error.message);
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
    if (chartEl) chartEl.style.opacity = '1';
  }
}

// 获取周期名称
function getPeriodName(period) {
  const names = {
    'day': '日 K',
    'week': '周 K',
    'month': '月 K',
    '60min': '60 分钟',
    '30min': '30 分钟',
    '15min': '15 分钟',
    '5min': '5 分钟',
    '1min': '1 分钟',
  };
  return names[period] || period;
}

// 加载财报数据
async function loadFinancials(symbol) {
  const loadingEl = document.getElementById('financialsLoading');
  const contentEl = document.getElementById('financialsContent');
  
  if (loadingEl) loadingEl.style.display = 'block';
  if (contentEl) contentEl.innerHTML = '';

  try {
    // 确定市场
    let market = 'auto';
    if (/^(60|68)/.test(symbol)) market = 'sh';
    else if (/^(00|30)/.test(symbol)) market = 'sz';
    else if (/^0\d{4}$/.test(symbol)) market = 'hk';
    else if (/^[A-Z]{2,6}$/.test(symbol)) market = 'us';

    const response = await fetch(`/api/financials?symbol=${symbol}&market=${market}`);
    const data = await response.json();

    if (data.error) {
      contentEl.innerHTML = `<div class="empty-tip">加载失败：${data.error}</div>`;
      return;
    }

    if (!data.financials) {
      contentEl.innerHTML = `<div class="empty-tip">暂无财报数据</div>`;
      return;
    }

    const f = data.financials;
    
    // 格式化大数字（亿）
    const formatBillion = (num) => {
      if (num === null || num === undefined || isNaN(num) || num === 0) return '--';
      return num >= 10000 ? `${(num / 10000).toFixed(2)}万亿` : `${num.toFixed(2)}亿`;
    };
    
    // 格式化百分比（带涨跌颜色）
    const formatPercent = (num, label) => {
      if (num === null || num === undefined || isNaN(num) || num === 0) return '--';
      const className = num > 0 ? 'up' : num < 0 ? 'down' : '';
      return `<span class="${className}">${num.toFixed(2)}%</span>`;
    };

    contentEl.innerHTML = `
      <div class="financials-grid">
        <div class="financials-section">
          <h4>📊 常用指标</h4>
          <div class="financials-item">
            <span class="financials-label">营业总收入</span>
            <span class="financials-value">${formatBillion(f.totalRevenue)}</span>
          </div>
          <div class="financials-item">
            <span class="financials-label">营收同比增长</span>
            <span class="financials-value">${formatPercent(f.revenueGrowth, '营收增长')}</span>
          </div>
          <div class="financials-item">
            <span class="financials-label">归属净利润</span>
            <span class="financials-value">${formatBillion(f.netProfit)}</span>
          </div>
          <div class="financials-item">
            <span class="financials-label">净利润同比增长</span>
            <span class="financials-value">${formatPercent(f.profitGrowth, '净利润增长')}</span>
          </div>
          <div class="financials-item">
            <span class="financials-label">扣非净利润</span>
            <span class="financials-value">${formatBillion(f.deductedNetProfit)}</span>
          </div>
          <div class="financials-item">
            <span class="financials-label">扣非净利润同比增长</span>
            <span class="financials-value">${formatPercent(f.deductedProfitGrowth, '扣非增长')}</span>
          </div>
          <div class="financials-item">
            <span class="financials-label">经营现金流净额</span>
            <span class="financials-value">${formatBillion(f.operatingCashFlow)}</span>
          </div>
          <div class="financials-item">
            <span class="financials-label">经营现金流同比增长</span>
            <span class="financials-value">${formatPercent(f.cashFlowGrowth, '现金流增长')}</span>
          </div>
        </div>
        
        <div class="financials-section">
          <h4>💰 每股指标</h4>
          <div class="financials-item">
            <span class="financials-label">基本每股收益 (EPS)</span>
            <span class="financials-value">${f.eps > 0 ? f.eps.toFixed(2) + '元' : '--'}</span>
          </div>
          <div class="financials-item">
            <span class="financials-label">每股净资产 (BVPS)</span>
            <span class="financials-value">${f.bvps > 0 ? f.bvps.toFixed(2) + '元' : '--'}</span>
          </div>
          <div class="financials-item">
            <span class="financials-label">每股经营现金流 (CFPS)</span>
            <span class="financials-value">${f.cfps > 0 ? f.cfps.toFixed(2) + '元' : '--'}</span>
          </div>
        </div>
        
        <div class="financials-section">
          <h4>💹 估值指标</h4>
          <div class="financials-item">
            <span class="financials-label">市盈率 (静)</span>
            <span class="financials-value">${f.peStatic > 0 ? f.peStatic.toFixed(2) : '--'}</span>
          </div>
          <div class="financials-item">
            <span class="financials-label">市盈率 (TTM)</span>
            <span class="financials-value">${f.peTTM > 0 ? f.peTTM.toFixed(2) : '--'}</span>
          </div>
          <div class="financials-item">
            <span class="financials-label">市净率 (PB)</span>
            <span class="financials-value">${f.pb > 0 ? f.pb.toFixed(2) : '--'}</span>
          </div>
          <div class="financials-item">
            <span class="financials-label">市销率 (PS)</span>
            <span class="financials-value">${f.ps > 0 ? f.ps.toFixed(2) : '--'}</span>
          </div>
          <div class="financials-item">
            <span class="financials-label">股息率</span>
            <span class="financials-value">${f.dividendYield > 0 ? f.dividendYield.toFixed(2) + '%' : '--'}</span>
          </div>
          <div class="financials-item">
            <span class="financials-label">总市值</span>
            <span class="financials-value">${formatBillion(f.totalMarketCap)}</span>
          </div>
          <div class="financials-item">
            <span class="financials-label">流通市值</span>
            <span class="financials-value">${formatBillion(f.floatMarketCap)}</span>
          </div>
        </div>
        
        <div class="financials-section">
          <h4>📈 盈利能力</h4>
          <div class="financials-item">
            <span class="financials-label">净资产收益率 (ROE)</span>
            <span class="financials-value">${f.roe > 0 ? f.roe.toFixed(2) + '%' : '--'}</span>
          </div>
          <div class="financials-item">
            <span class="financials-label">总资产收益率 (ROA)</span>
            <span class="financials-value">${f.roa > 0 ? f.roa.toFixed(2) + '%' : '--'}</span>
          </div>
          <div class="financials-item">
            <span class="financials-label">销售毛利率</span>
            <span class="financials-value">${f.grossMargin > 0 ? f.grossMargin.toFixed(2) + '%' : '--'}</span>
          </div>
          <div class="financials-item">
            <span class="financials-label">销售净利率</span>
            <span class="financials-value">${f.netMargin > 0 ? f.netMargin.toFixed(2) + '%' : '--'}</span>
          </div>
        </div>
        
        <div class="financials-section">
          <h4>🛡️ 偿债能力</h4>
          <div class="financials-item">
            <span class="financials-label">资产负债率</span>
            <span class="financials-value">${f.debtRatio > 0 ? f.debtRatio.toFixed(2) + '%' : '--'}</span>
          </div>
          <div class="financials-item">
            <span class="financials-label">流动比率</span>
            <span class="financials-value">${f.currentRatio > 0 ? f.currentRatio.toFixed(2) : '--'}</span>
          </div>
          <div class="financials-item">
            <span class="financials-label">速动比率</span>
            <span class="financials-value">${f.quickRatio > 0 ? f.quickRatio.toFixed(2) : '--'}</span>
          </div>
        </div>
      </div>
      <div class="financials-footer">
        <p>更新时间：${data.updateTime || new Date().toLocaleString('zh-CN')}</p>
      </div>
    `;

  } catch (error) {
    console.error('加载财报数据失败:', error);
    contentEl.innerHTML = `<div class="empty-tip">加载失败：${error.message}</div>`;
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

// 打开 K 线弹窗
window.openKlineModal = function(symbol, initialPeriod = 'day') {
  const modal = document.getElementById('klineModal');
  if (!modal) return;

  modal.style.display = 'flex';
  
  // 延迟初始化图表，确保弹窗已显示且容器有正确尺寸
  setTimeout(() => {
    const chartContainer = document.getElementById('klineChart');
    if (!chartContainer) return;
    
    // 初始化图表（如果还没初始化）
    if (!chart) {
      console.log('初始化 K 线图表...');
      initKlineChart();
    }
    
    // 强制重新调整图表尺寸（解决首次加载时容器尺寸为 0 的问题）
    if (chart) {
      console.log('调整图表尺寸，容器:', chartContainer.clientWidth, 'x', chartContainer.clientHeight);
      chart.applyOptions({
        width: chartContainer.clientWidth,
        height: chartContainer.clientHeight,
      });
    }
    
    // 加载数据
    console.log('开始加载 K 线数据，股票代码:', symbol, '周期:', initialPeriod);
    loadKlineData(symbol, initialPeriod);
  }, 300); // 增加延迟到 300ms，确保弹窗完全渲染

  // 绑定周期切换事件
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.onclick = () => {
      const period = btn.dataset.period;
      loadKlineData(symbol, period);
    };
  });

  // 绑定指标切换事件
  ['ma5Check', 'ma10Check', 'ma20Check', 'volCheck'].forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.onchange = () => {
        if (currentSymbol) {
          loadKlineData(currentSymbol, currentPeriod);
        }
      };
    }
  });

  // 检查当前激活的标签页
  const activeTab = document.querySelector('.kline-tab.active');
  const isFinancialsTab = activeTab && activeTab.dataset.tab === 'financials';
  
  // 如果当前在财报标签页，加载财报数据
  if (isFinancialsTab) {
    console.log('打开弹窗时在财报标签页，加载财报数据:', symbol);
    loadFinancials(symbol);
  }
  
  // 绑定财报标签页切换
  document.querySelectorAll('.kline-tab').forEach(tab => {
    tab.onclick = () => {
      const tabName = tab.dataset.tab;
      const chartDiv = document.getElementById('klineChart');
      const financialsDiv = document.getElementById('klineFinancials');
      const periodsDiv = document.getElementById('klinePeriods');
      const indicatorsDiv = document.getElementById('klineIndicators');
      
      // 更新标签页状态
      document.querySelectorAll('.kline-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      if (tabName === 'chart') {
        chartDiv.style.display = 'block';
        financialsDiv.style.display = 'none';
        if (periodsDiv) periodsDiv.style.display = 'flex';
        if (indicatorsDiv) indicatorsDiv.style.display = 'flex';
        
        // 如果切换到图表且还没加载数据，加载 K 线
        if (symbol && !chart) {
          initKlineChart();
          loadKlineData(symbol, currentPeriod || 'day');
        } else if (chart) {
          // 重新调整图表尺寸
          setTimeout(() => {
            if (chart && chartContainer) {
              chart.applyOptions({
                width: chartContainer.clientWidth - 150,
                height: chartContainer.clientHeight - 100,
              });
            }
          }, 100);
        }
      } else if (tabName === 'financials') {
        chartDiv.style.display = 'none';
        financialsDiv.style.display = 'block';
        if (periodsDiv) periodsDiv.style.display = 'none';
        if (indicatorsDiv) indicatorsDiv.style.display = 'none';
        
        // 加载财报数据
        console.log('切换到财报标签页，加载数据:', symbol);
        loadFinancials(symbol);
      }
    };
  });
}

// 关闭 K 线弹窗
window.closeKlineModal = function() {
  const modal = document.getElementById('klineModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// 不在页面加载时初始化，只在打开 K 线弹窗时初始化
// 这样可以避免容器隐藏时尺寸为 0 的问题
