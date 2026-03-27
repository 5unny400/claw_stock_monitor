// K 线图组件 - 使用 Lightweight Charts
import { createChart, ColorType } from 'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';

let chart = null;
let candlestickSeries = null;
let volumeSeries = null;
let ma5Series = null;
let ma10Series = null;
let ma20Series = null;
let currentSymbol = null;
let currentPeriod = 'day';

// 初始化 K 线图表
export function initKlineChart() {
  const chartContainer = document.getElementById('klineChart');
  if (!chartContainer) return;

  // 创建图表
  chart = createChart(chartContainer, {
    width: chartContainer.clientWidth,
    height: 500,
    layout: {
      background: { type: ColorType.Solid, color: '#1a1a2e' },
      textColor: '#d1d4dc',
    },
    grid: {
      vertLines: { color: '#2B2B43' },
      horzLines: { color: '#2B2B43' },
    },
    crosshair: {
      mode: 1, // CrosshairMode.Normal
    },
    timeScale: {
      borderColor: '#2B2B43',
      timeVisible: true,
      secondsVisible: false,
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
      top: 0.85,
      bottom: 0,
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

// 计算移动平均线
function calculateMA(data, period) {
  const maData = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      maData.push({ time: data[i].time, value: NaN });
      continue;
    }

    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].close;
    }

    maData.push({
      time: data[i].time,
      value: sum / period,
    });
  }
  return maData;
}

// 加载 K 线数据
export async function loadKlineData(symbol, period = 'day') {
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
      alert('暂无 K 线数据');
      return;
    }

    // 转换数据格式
    const candleData = data.klines.map(k => ({
      time: k.time.split(' ')[0], // 只取日期部分
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
    }));

    // 成交量数据（红色表示涨，绿色表示跌）
    const volumeData = data.klines.map(k => ({
      time: k.time.split(' ')[0],
      value: k.volume / 10000, // 转换为万手
      color: k.close >= k.open ? '#ef535080' : '#26a69a80',
    }));

    // 更新图表
    if (candlestickSeries) {
      candlestickSeries.setData(candleData);
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
export function openKlineModal(symbol) {
  const modal = document.getElementById('klineModal');
  if (!modal) return;

  modal.style.display = 'flex';
  
  // 初始化图表（如果还没初始化）
  if (!chart) {
    initKlineChart();
  }

  // 加载数据
  loadKlineData(symbol, 'day');

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
export function closeKlineModal() {
  const modal = document.getElementById('klineModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// 全局函数（供 app.js 调用）
window.openKlineModal = openKlineModal;
window.closeKlineModal = closeKlineModal;

// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // 延迟初始化，等待 DOM 就绪
    setTimeout(initKlineChart, 100);
  });
} else {
  setTimeout(initKlineChart, 100);
}
