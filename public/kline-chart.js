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
  const width = chartContainer.clientWidth - 90; // 减去左右 padding 和价格轴空间
  const height = chartContainer.clientHeight - 130; // 减去上下 padding 和时间轴空间

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
      visible: false, // 隐藏时间轴滑块
    },
    rightPriceScale: {
      borderColor: '#2B2B43',
      mode: LightweightCharts.PriceScaleMode.Normal,
      scaleMargins: {
        top: 0.1,  // 顶部留白 10%
        bottom: 0.3, // 底部留白 30%（给成交量）
      },
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
      top: 0.9,  // 成交量只占底部 10%
      bottom: 0.1, // 底部留白，不贴边
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
      chart.applyOptions({
        width: chartContainer.clientWidth,
      });
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
}

// 关闭 K 线弹窗
window.closeKlineModal = function() {
  const modal = document.getElementById('klineModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // 延迟初始化，等待 DOM 就绪
    setTimeout(initKlineChart, 100);
  });
} else {
  setTimeout(initKlineChart, 100);
}
