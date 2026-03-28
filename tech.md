# 股票盯票验票系统 - 技术方案文档

**版本：** v1.2.0  
**最后更新：** 2026-03-28  
**GitHub:** https://github.com/5unny400/claw_stock_monitor

---

## 一、系统架构

### 1.1 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **后端** | Node.js + Express | RESTful API 服务器 |
| **前端** | 原生 JavaScript + CSS | 无框架，轻量级实现 |
| **图表库** | Lightweight Charts v4.2.0 | TradingView 开源 K 线图表库 |
| **数据源** | 东方财富 API | A 股/港股/美股实时行情 |
| **黄金数据** | 上海黄金交易所 + 东方财富 | AU9999 现货价格 |

### 1.2 项目结构

```
stock-monitor/
├── server.js           # 后端 API 服务器
├── gold-price.js       # 黄金价格轮询模块
├── package.json        # 依赖配置
└── public/             # 前端静态资源
    ├── index.html      # 主页面
    ├── style.css       # 样式表
    ├── app.js          # 主逻辑
    └── kline-chart.js  # K 线图表组件
```

---

## 二、核心功能模块

### 2.1 大盘指数监控

**API:** `/api/market`  
**数据源:** 腾讯财经 API (`qt.gtimg.cn`)  
**支持指数:**
- 上证指数 (sh000001)
- 深证成指 (sz399001)
- 沪深 300 (sh000300)
- 创业板指 (sz399006)

**技术实现:**
```javascript
// 使用 GBK 编码解析腾讯 API 返回数据
const data = iconv.decode(Buffer.from(response.data), 'gbk');
```

---

### 2.2 黄金价格监控

**API:** `/api/gold`  
**数据源:** 东方财富 WebSocket + HTTP 轮询  
**支持品种:**
- AU9999 (黄金 9999)
- AU100G (黄金 100 克)
- AG999 (白银)
- PT9995 (铂金)

**技术实现:**
- 优先使用 WebSocket 实时推送
- 降级为 HTTP 轮询（3 秒/次）
- 多数据源冗余（东方财富、新浪财经、腾讯财经）

---

### 2.3 自选股监控

**API:** `/api/stocks?symbols=600519,000858,...`  
**数据源:** 东方财富 API (`push2.eastmoney.com`)  
**功能:**
- 批量获取股票行情
- 自动识别 A 股/港股/美股市场
- 支持股票代码/名称搜索
- 无效股票自动清理

**市场识别规则:**
```javascript
if (/^(60|68)/.test(symbol)) marketPrefix = '1.';    // 沪市
else if (/^(00|30)/.test(symbol)) marketPrefix = '0.'; // 深市
else if (/^0\d{4}$/.test(symbol)) marketPrefix = '116.'; // 港股
else if (/^[A-Z]{2,6}$/.test(symbol)) marketPrefix = '105.'; // 美股
```

---

### 2.4 K 线图功能

**API:** `/api/kline?symbol=600519&period=day`  
**数据源:** 东方财富 K 线 API (`push2his.eastmoney.com`)  
**支持周期:**
- 日 K、周 K、月 K
- 60 分钟、30 分钟、15 分钟、5 分钟、1 分钟
- 5 日 K（前端合并）

**技术指标:**
- K 线蜡烛图（红涨绿跌）
- 成交量柱状图
- MA5/10/20 均线（可选）

**技术实现:**
```javascript
// 分钟 K 使用 Unix 时间戳（秒），日 K 使用日期字符串
if (period.includes('min')) {
  time = Math.floor(dateObj.getTime() / 1000);
} else {
  time = k.time.split(' ')[0];
}
```

**关键修复:**
- 修复容器尺寸为负数问题（弹窗隐藏时跳过初始化）
- 修复 resize 事件处理（使用 `Math.max(0, ...)`）
- 延迟初始化确保容器可见

---

### 2.5 财报数据功能

**API:** `/api/financials?symbol=600519`  
**数据源:** 东方财富 API  
**支持指标:**

| 类别 | 指标 | 字段 | 单位 |
|------|------|------|------|
| **估值指标** | 市盈率 (PE) | f162 | 倍 |
| | 股息率 | f126 | % |
| **规模指标** | 营业总收入 | f104 | 元 |
| | 净利润 | f109 | 元 |
| | 总资产 | f116 | 元 |

**技术实现:**
```javascript
const financials = {
  pe: d.f162 ? parseFloat((d.f162 / 100).toFixed(2)) : 0,
  dividendYield: d.f126 ? parseFloat(d.f126.toFixed(2)) : 0,
  totalRevenue: d.f104 ? parseFloat((d.f104 / 100000000).toFixed(2)) : 0,
  netProfit: d.f109 ? parseFloat((d.f109 / 100000000).toFixed(2)) : 0,
  totalAssets: d.f116 ? parseFloat((d.f116 / 100000000).toFixed(2)) : 0,
};
```

**UI 设计:**
- 标签页切换（K 线图 / 财报数据）
- 6 大类别展示（每股指标、估值指标、盈利能力、成长能力、偿债能力、规模指标）
- 缺失数据显示 `--`（不使用 N/A）
- 响应式网格布局

---

### 2.6 搜票验票

**API:** `/api/search?keyword=茅台` + `/api/stock/:symbol`  
**数据源:** 东方财富股票搜索 API  
**功能:**
- 支持代码/名称/拼音搜索
- 自动识别市场
- 验证股票有效性

---

### 2.7 价格预警

**存储:** LocalStorage  
**功能:**
- 设置高于/低于某价格预警
- 实时检查触发状态
- 视觉提示（红色高亮）

---

## 三、API 接口文档

### 3.1 行情接口

| 接口 | 方法 | 参数 | 说明 |
|------|------|------|------|
| `/api/market` | GET | 无 | 获取大盘指数 |
| `/api/gold` | GET | 无 | 获取黄金价格 |
| `/api/stock/:symbol` | GET | symbol | 获取单只股票行情 |
| `/api/stocks?symbols=` | GET | symbols (逗号分隔) | 批量获取股票行情 |
| `/api/search?keyword=` | GET | keyword | 搜索股票 |
| `/api/stock/:symbol/info` | GET | symbol | 验证股票有效性 |

### 3.2 K 线接口

| 接口 | 方法 | 参数 | 说明 |
|------|------|------|------|
| `/api/kline` | GET | symbol, period, market | 获取 K 线数据 |

**period 参数:** `day`, `week`, `month`, `60min`, `30min`, `15min`, `5min`, `1min`, `5day`  
**market 参数:** `auto`, `sh`, `sz`, `hk`, `us`

### 3.3 财报接口

| 接口 | 方法 | 参数 | 说明 |
|------|------|------|------|
| `/api/financials` | GET | symbol, market | 获取财务指标 |

**返回示例:**
```json
{
  "symbol": "600519",
  "name": "贵州茅台",
  "financials": {
    "pe": 20.58,
    "dividendYield": 3.65,
    "totalRevenue": 1819.25,
    "netProfit": 862.28,
    "totalAssets": 17732.4
  },
  "updateTime": "2026/3/28 21:14:58"
}
```

---

## 四、关键技术点

### 4.1 多市场支持

**A 股:** 代码前加 `1.` (沪市) 或 `0.` (深市)  
**港股:** 代码前加 `116.` 或 `HK` 前缀  
**美股:** 代码前加 `105.` 或 `US` 前缀

### 4.2 数据精度处理

```javascript
// 港股价格除以 1000，A 股/美股除以 100
const priceDivisor = marketPrefix === '116.' ? 1000 : 100;
const current = d.f43 / priceDivisor;
```

### 4.3 防错机制

- **容器尺寸检查:** 避免在隐藏元素上初始化图表
- **数据过滤:** 过滤无效 K 线数据（NaN、0 值）
- **超时处理:** 所有 API 请求设置 5-10 秒超时
- **降级方案:** WebSocket 失败自动切换 HTTP 轮询

### 4.4 性能优化

- **LocalStorage 缓存:** 自选股、预警数据本地存储
- **批量请求:** 合并多个股票行情为一个 API 调用
- **定时刷新:** 30 秒自动刷新（可选）

---

## 五、已知问题与 TODO

### 5.1 财报数据限制

**当前问题:**
- 东方财富 API 字段含义不透明
- 部分财务指标无法获取（EPS、ROE、毛利率等）
- 需要搜索官方文档确认字段映射

**临时方案:**
- 只显示确认正确的字段（PE、股息率、营收、净利润、总资产）
- 其他字段显示 `--`

**TODO:**
- [ ] 搜索东方财富 API 官方文档
- [ ] 找到历年财务数据 API（同花顺风格）
- [ ] 实现财报趋势图表

### 5.2 技术债务

- [ ] 添加单元测试
- [ ] 前端组件化（考虑 Vue/React）
- [ ] 添加 WebSocket 实时推送
- [ ] 支持更多技术指标（MACD、KDJ、RSI）
- [ ] 导出 Excel 功能

---

## 六、部署说明

### 6.1 环境要求

- Node.js v16+
- npm 或 yarn

### 6.2 安装步骤

```bash
# 安装依赖
npm install

# 启动服务
node server.js

# 访问
http://localhost:3000
```

### 6.3 配置

无需额外配置，所有数据源为公开 API。

---

## 七、开发规范

### 7.1 Git 工作流

- **本地提交:** 可自主执行 `git add` 和 `git commit`
- **远程推送:** 必须等待用户明确指令后才执行 `git push`

### 7.2 服务管理

修改代码后必须检查服务状态，如果服务未运行自动重启：

```powershell
Stop-Process -Name node -Force
Start-Sleep -Seconds 1
cd D:\ClawXWorkDir\stock-monitor
node server.js
```

### 7.3 API 开发规范

使用未知 API 时必须搜索文档：
1. 不要猜测 API 字段含义
2. 使用 web_search 搜索官方文档
3. 确认字段定义后再编写代码

---

## 八、版本历史

### v1.2.0 (2026-03-28)

**新增:**
- ✅ K 线图功能（日/周/月/分钟 K）
- ✅ 财报数据面板
- ✅ 标签页切换（K 线图/财报）
- ✅ MA5/10/20 均线支持

**修复:**
- ✅ K 线图初始化时容器尺寸为负数问题
- ✅ 财报 API 404 错误
- ✅ 财报数据显示 N/A 问题（改为 `--`）

**技术优化:**
- ✅ 使用东方财富 API 替代新浪财经
- ✅ 添加容器尺寸检查
- ✅ 优化 resize 事件处理

---

**文档维护:** 每次功能更新后同步更新此文档
