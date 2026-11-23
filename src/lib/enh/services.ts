/**
 * FoundFish public data-service layer.
 *
 * Replaces the upstream closed-source submodule with public API implementations.
 * Data sources: East Money (天天基金/东方财富), Taobao/Suning time APIs.
 */

type AnyService = (...args: any[]) => Promise<any>;

// ─── shared helpers ──────────────────────────────────────────────

const EM_FUND = 'https://fund.eastmoney.com';
const EM_PUSH2 = 'https://61.push2.eastmoney.com';
const EM_PUSH2HIS = 'https://push2his.eastmoney.com';
const EM_SEARCH = 'https://searchapi.eastmoney.com';
const EM_NEWS = 'https://np-listapi.eastmoney.com';
const EM_DATAAPI = 'https://datacenter-web.eastmoney.com';

function isFundCode(value: string) {
  return /^\d{6}$/.test(value);
}

function dateFromTimestamp(timestamp: number) {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// f86 is a second-level Unix timestamp returned by East Money push2 quotes.
// Format to "HH:mm" for compact display in the index list row.
function timeFromTimestamp(ts: number) {
  const d = new Date(ts * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// 新浪/腾讯API返回GBK/GB18030编码，需要特殊解码
function isGbkSource(url: string): boolean {
  return url.includes('sinajs.cn') || url.includes('gtimg.cn');
}

async function readText(url: string, headers?: Record<string, string>) {
  const gbk = isGbkSource(url);
  // 优先走 Electron IPC（绕过 CORS），fallback 到 fetch（浏览器/测试环境）
  const ipcRequest = (globalThis as any)?.window?.contextModules?.request;
  if (ipcRequest) {
    const config: Record<string, any> = {
      method: 'GET',
      headers: {
        Accept: 'application/javascript,text/javascript,text/plain,application/json,*/*',
        Referer: `${EM_FUND}/`,
        ...headers,
      },
      ...(gbk ? { responseType: 'arraybuffer' } : {}),
    };
    const res = await ipcRequest(url, config);
    const body = res?.body ?? res;
    if (gbk && typeof body !== 'string') {
      return new TextDecoder('gb18030').decode(body);
    }
    return body;
  }
  const response = await fetch(url, {
    headers: {
      Accept: 'application/javascript,text/javascript,text/plain,application/json,*/*',
      Referer: `${EM_FUND}/`,
      ...headers,
    },
  });
  if (!response.ok) {
    throw new Error(`Data source responded with ${response.status}`);
  }
  if (gbk) {
    const buf = await response.arrayBuffer();
    return new TextDecoder('gb18030').decode(buf);
  }
  return response.text();
}

async function readJson<T = any>(url: string, headers?: Record<string, string>): Promise<T> {
  const text = await readText(url, headers);
  return JSON.parse(text);
}

function readJavaScriptValue(source: string, name: string) {
  const matched = source.match(new RegExp(`(?:var|let|const)\\s+${name}\\s*=\\s*([\\s\\S]*?);(?:\\s*/\\*|\\s*var|\\s*$)`));
  if (!matched) return undefined;
  try {
    return JSON.parse(matched[1].trim());
  } catch {
    return undefined;
  }
}

function parseJsonp(text: string): any {
  // jsonpgz({...}) or var jsonpgz = {...}
  const m = text.match(/(?:jsonpgz?\s*[=(]\s*|var\s+\w+\s*=\s*)(\{[\s\S]*\})/);
  if (m) {
    try { return JSON.parse(m[1]); } catch {}
  }
  return null;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// ─── K线/资金流字符串解析 ────────────────────────────────────────
// 东方财富 kline/get 与 fflow/daykline 均返回逗号分隔的字符串数组，
// 渲染层组件期望结构化对象。此处统一解析，避免各接口重复处理。

// 标准K线：f51日期,f52开盘,f53收盘,f54最高,f55最低,f56成交量,f57成交额,f58振幅
function parseKlines(klines: string[]): any[] {
  return (klines || []).map((line) => {
    const p = String(line).split(',');
    return {
      date: p[0] || '',
      kp: Number(p[1]) || 0,   // 开盘
      sp: Number(p[2]) || 0,   // 收盘
      zg: Number(p[3]) || 0,   // 最高
      zd: Number(p[4]) || 0,   // 最低
      cjl: Number(p[5]) || 0,  // 成交量
      cje: Number(p[6]) || 0,  // 成交额
      zf: Number(p[7]) || 0,   // 振幅
    };
  });
}

// 资金流K线：f51日期/时间,f52主力,f53小单,f54中单,f55大单,f56超大单,f57-f61占比,f62指数收盘价
// timeAxis=true 时把 datetime 转为毫秒时间戳，供 type:'time' 的 ECharts 轴使用
function parseFundFlowKlines(klines: string[], timeAxis: boolean = false): any[] {
  return (klines || []).map((line) => {
    const p = String(line).split(',');
    const rawTime = p[0] || '';
    return {
      datetime: timeAxis ? new Date(rawTime.replace(' ', 'T')).getTime() : rawTime,
      zljlr: Number(p[1]) || 0,   // 主力净流入
      xdjlr: Number(p[2]) || 0,   // 小单净流入
      zdjlr: Number(p[3]) || 0,   // 中单净流入
      ddjlr: Number(p[4]) || 0,   // 大单净流入
      cddjlr: Number(p[5]) || 0,  // 超大单净流入
    };
  });
}

// 分时走势：f51时间,f52价格,f53均价,f54成交量,f55成交额
function parseTrends(trends: string[]): Zindex.TrendItem[] {
  return (trends || []).map((line) => {
    const p = String(line).split(',');
    return {
      time: p[0] || '',
      price: Number(p[1]) || 0,
      cjl: Number(p[4]) || 0,
    };
  });
}

// 分时图图片URL：webquotepic 是东方财富公开的分时图图片接口，nid 为 secid
function getPicTrendUrl(secid: string): string {
  return `https://webquotepic.eastmoney.com/GetPic.aspx?imageType=r&nid=${encodeURIComponent(secid)}&_=${Date.now()}`;
}

// K线字符串 → 二维数组 [[日期, 开, 收, 低, 高, 量], ...]，供黄金/指数走势图使用
function parseKlinesMatrix(klines: string[]): any[] {
  return (klines || []).map((line) => {
    const p = String(line).split(',');
    return [p[0] || '', Number(p[1]) || 0, Number(p[2]) || 0, Number(p[4]) || 0, Number(p[3]) || 0, Number(p[5]) || 0];
  });
}

// ─── Fund ────────────────────────────────────────────────────────

async function getFundPageData(code: string) {
  if (!isFundCode(code)) return undefined;
  const source = await readText(`${EM_FUND}/pingzhongdata/${code}.js?v=${Date.now()}`);
  const name = readJavaScriptValue(source, 'fS_name');
  const trend = readJavaScriptValue(source, 'Data_netWorthTrend');
  if (!name || !Array.isArray(trend) || !trend.length) return undefined;
  const stockCodesNew = readJavaScriptValue(source, 'stockCodesNew');
  const performanceEvaluation = readJavaScriptValue(source, 'Data_performanceEvaluation');
  const fundSharesPositions = readJavaScriptValue(source, 'Data_fundSharesPositions');
  return { source, name: String(name), trend, stockCodesNew, performanceEvaluation, fundSharesPositions };
}

// ─── Multi-source fund data fetcher ─────────────────────────────
// Source 0: FundValuationLast — official batch estimate API (fundgz replacement)
// Returns GSZ/GSZZL/GZTIME for funds that have official intraday estimates.
// Coverage is partial (~30% of funds, mainly index/ETF/LOF) but values are authoritative.
async function fetchFromFundValuationLast(code: string): Promise<Fund.ResponseItem | undefined> {
  try {
    const text = await readText(
      `https://fundcomapi.tiantianfunds.com/mm/newCore/FundValuationLast?FCODES=${code}&FIELDS=FCODE,SHORTNAME,GSZZL,GZTIME,GSZ,NAV,PDATE`,
      { Referer: 'https://fund.eastmoney.com/' }
    );
    const data = JSON.parse(text);
    const item = data?.data?.[0];
    if (!item) return undefined;
    const dwjz = item.NAV || item.PDATE ? String(item.NAV) : undefined;
    if (!dwjz) return undefined;
    const gsz = item.GSZ ? String(item.GSZ) : dwjz;
    const gszzl = item.GSZZL != null ? String(item.GSZZL) : '0';
    const gztime = item.GZTIME || '';
    return {
      fundcode: code,
      name: item.SHORTNAME || '',
      jzrq: item.PDATE || '',
      dwjz,
      gsz,
      gszzl,
      gztime,
    };
  } catch { return undefined; }
}

// Source 1: Sina hq.sinajs.cn — fast, latest NAV
async function fetchFromSina(code: string): Promise<Fund.ResponseItem | undefined> {
  try {
    const text = await readText(`https://hq.sinajs.cn/list=of${code}`, { Referer: 'https://finance.sina.com.cn/' });
    const m = text.match(/hq_str_of\d+="([^"]+)"/);
    if (!m) return undefined;
    // Fields: name,dwjz,ljjz,prev_dwjz,jzzzl,date
    const parts = m[1].split(',');
    if (parts.length < 6) return undefined;
    const [, dwjz, , prevDwjz, jzzl, date] = parts;
    if (!dwjz || !date) return undefined;
    return {
      fundcode: code,
      name: parts[0],
      jzrq: date,
      gztime: `${date} 15:00`,
      dwjz,
      gsz: dwjz,
      gszzl: jzzl || '0',
    };
  } catch { return undefined; }
}

// Source 2: Danjuan fund detail — latest NAV with growth rates
async function fetchFromDanjuan(code: string): Promise<Fund.ResponseItem | undefined> {
  try {
    const text = await readText(`https://danjuanfunds.com/djapi/fund/${code}`, { Referer: 'https://danjuanfunds.com/' });
    const data = JSON.parse(text);
    const d = data?.data;
    if (!d || !d.fd_code) return undefined;
    const derived = d.fund_derived || {};
    const endDate = derived.end_date;
    const unitNav = derived.unit_nav;
    if (!endDate || !unitNav) return undefined;
    return {
      fundcode: d.fd_code,
      name: d.fd_name,
      jzrq: endDate,
      gztime: `${endDate} 15:00`,
      dwjz: unitNav,
      gsz: unitNav,
      gszzl: derived.nav_grtd || '0',
    };
  } catch { return undefined; }
}

// Source 3: Eastmoney fund page — scrape estimate + NAV
async function fetchFromEastmoneyPage(code: string): Promise<Fund.ResponseItem | undefined> {
  try {
    const text = await readText(`https://fund.eastmoney.com/${code}.html`, { Referer: 'https://fund.eastmoney.com/' });
    if (!text || text.length < 500) return undefined;
    // Extract name
    const nameMatch = text.match(/fundDetail-tit"><div[^>]*>([^<]+)/);
    const name = nameMatch?.[1]?.trim();
    // Extract estimate (gsz) — only available during trading hours
    const gszMatch = text.match(/id="gz_gsz"[^>]*>([^<]+)/);
    const gszzlMatch = text.match(/id="gz_gszzl"[^>]*>([^<]+)/);
    const gztimeMatch = text.match(/id="gz_gztime"[^>]*>\(([^)]+)\)/);
    // Extract latest NAV from fix_date/fix_dwjz
    const dwjzMatch = text.match(/fix_dwjz[^>]*>([^<]+)/);
    const dateMatch = text.match(/fix_date">\(([^)]+)\)/);
    const zzlMatch = text.match(/fix_zzl[^>]*>([^<]+)/);

    const dwjz = dwjzMatch?.[1]?.trim();
    const date = dateMatch?.[1]?.trim(); // e.g. "07-23"
    if (!dwjz) return undefined;
    const fullDate = date ? `20${date}` : undefined;
    const gsz = gszMatch?.[1]?.trim();
    const hasEstimate = gsz && gsz !== '--';
    const gszzl = gszzlMatch?.[1]?.trim() || zzlMatch?.[1]?.trim().replace('%', '') || '0';
    const gztime = gztimeMatch?.[1]?.trim();

    return {
      fundcode: code,
      name: name || '',
      jzrq: fullDate,
      gztime: hasEstimate ? gztime : (fullDate ? `${fullDate} 15:00` : undefined),
      dwjz,
      gsz: hasEstimate ? gsz : dwjz,
      gszzl: hasEstimate ? gszzl : (zzlMatch?.[1]?.trim().replace('%', '') || '0'),
    };
  } catch { return undefined; }
}

// Source 4: Eastmoney fundmobapi — mobile API, has GSZ/GSZZL fields (currently null but will auto-populate when estimate service recovers)
async function fetchFromEastmoneyMobile(code: string): Promise<Fund.ResponseItem | undefined> {
  try {
    const text = await readText(
      `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo?FundCode=${code}&deviceid=Wap&plat=Wap&appType=ttjj&product=EFund&version=2.0.0&pageIndex=1&pageSize=1`,
      { Referer: 'https://mpservice.com/' }
    );
    const data = JSON.parse(text);
    const item = data?.Datas?.[0];
    if (!item || !item.NAV) return undefined;
    const hasEstimate = item.GSZ && item.GSZ !== '--' && item.GZTIME;
    return {
      fundcode: item.FCODE,
      name: item.SHORTNAME || '',
      jzrq: item.PDATE,
      gztime: hasEstimate ? item.GZTIME : `${item.PDATE} 15:00`,
      dwjz: item.NAV,
      gsz: hasEstimate ? item.GSZ : item.NAV,
      gszzl: hasEstimate ? (item.GSZZL || '0') : (item.NAVCHGRT || '0'),
    };
  } catch { return undefined; }
}

// Source 5: Eastmoney lsjz API — latest historical NAV
async function fetchFromEastmoneyLsjz(code: string): Promise<Fund.ResponseItem | undefined> {
  try {
    const text = await readText(
      `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=1`,
      { Referer: 'https://fund.eastmoney.com/' }
    );
    const data = JSON.parse(text);
    const item = data?.Data?.LSJZList?.[0];
    if (!item) return undefined;
    return {
      fundcode: code,
      name: '',
      jzrq: item.FSRQ,
      gztime: `${item.FSRQ} 15:00`,
      dwjz: item.DWJZ,
      gsz: item.DWJZ,
      gszzl: item.JZZZL || '0',
    };
  } catch { return undefined; }
}

// Source 5: Pingzhongdata (existing fallback)

// ─── Intraday estimate (community build) ───────────────────────────
// 实时估值依赖项目内部维护的算法模块。公开版本为占位实现，返回 null 后
// 应用自动降级为展示最新单位净值；数据抓取、界面与其余功能均不受影响。

function emptyEstimate(): { gsz: string; gszzl: string; gztime: string } | null {
  return null;
}

async function estimateFromExchange(_code: string, _dwjz: string) { return emptyEstimate(); }
function isIndexFund(_pageData: any): boolean { return false; }
function getPositionRatio(_pageData: any): number { return 1; }
async function estimateFromIndex(_code: string, _pageData: any, _dwjz: string) { return emptyEstimate(); }
async function estimateFromHoldings(_code: string, _pageData: any, _dwjz: string) { return emptyEstimate(); }

async function fetchFromPingzhongdata(code: string): Promise<Fund.ResponseItem | undefined> {
  const pageData = await getFundPageData(code);
  if (!pageData) return undefined;
  const latest = pageData.trend[pageData.trend.length - 1] || {};
  const netValue = latest.y ?? latest.unitMoney;
  if (netValue === undefined || netValue === null) return undefined;
  const dwjz = String(netValue);
  const jzrq = typeof latest.x === 'number' ? dateFromTimestamp(latest.x) : undefined;
  // Try intraday estimate: LOF/ETF → exchange price, index funds → tracking index, others → holdings
  let estimate: { gsz: string; gszzl: string; gztime: string } | null = null;
  estimate = await estimateFromExchange(code, dwjz);
  if (!estimate && isIndexFund(pageData)) {
    estimate = await estimateFromIndex(code, pageData, dwjz);
  }
  if (!estimate) {
    estimate = await estimateFromHoldings(code, pageData, dwjz);
  }
  return {
    fundcode: code,
    name: pageData.name,
    jzrq,
    gztime: estimate ? estimate.gztime : (jzrq ? `${jzrq} 15:00` : undefined),
    dwjz,
    gsz: estimate ? estimate.gsz : dwjz,
    gszzl: estimate ? estimate.gszzl : (latest.equityReturn === undefined ? '0' : String(latest.equityReturn)),
  };
}

async function fromEastmoney(code: string): Promise<Fund.ResponseItem | undefined> {
  // Multi-source fallback chain: try each source in order, return first valid result
  // Order: UTF-8 sources first, GBK sources (Sina) last to avoid encoding issues
  // Note: fundgz.1234567.com.cn (original intraday estimate API) is dead since ~2026-07
  //       All major platforms (eastmoney, danjuan, 10jqka) depended on it for estimates
  //       fundmobapi has GSZ/GSZZL fields that will auto-populate if the service recovers
  const sources = [
    fetchFromFundValuationLast,
    fetchFromDanjuan,
    fetchFromEastmoneyMobile,
    fetchFromEastmoneyPage,
    fetchFromEastmoneyLsjz,
    fetchFromPingzhongdata,
    fetchFromSina,
  ];
  for (const source of sources) {
    try {
      const result = await source(code);
      if (result && result.dwjz) {
        // Enhance with intraday estimate if no live estimate (gsz equals dwjz = stale)
        const isStale = !result.gsz || result.gsz === result.dwjz;
        if (isStale) {
          let estimate: { gsz: string; gszzl: string; gztime: string } | null = null;
          // Priority: LOF/ETF exchange price → tracking index → top-10 holdings
          estimate = await estimateFromExchange(code, result.dwjz);
          if (!estimate) {
            const pageData = await getFundPageData(code);
            if (pageData) {
              if (isIndexFund(pageData)) {
                estimate = await estimateFromIndex(code, pageData, result.dwjz);
              }
              if (!estimate) {
                estimate = await estimateFromHoldings(code, pageData, result.dwjz);
              }
            }
          }
          if (estimate) {
            result.gsz = estimate.gsz;
            result.gszzl = estimate.gszzl;
            result.gztime = estimate.gztime;
          }
        }
        return result;
      }
    } catch {}
  }
  return undefined;
}

async function getFixFromEastmoney(code: string): Promise<Fund.FixData | undefined> {
  const fund = await fromEastmoney(code);
  if (!fund) return undefined;
  return {
    code,
    fixName: fund.name,
    fixDate: fund.jzrq,
    fixDwjz: fund.dwjz,
    fixZzl: fund.gszzl,
  };
}

async function getFundDetailFromEastmoney(code: string): Promise<Partial<Fund.PingzhongData> | undefined> {
  const data = await getFundPageData(code);
  if (!data) return undefined;
  const fieldNames = [
    'stockCodesNew', 'zqCodesNew', 'Data_fundSharesPositions',
    'Data_netWorthTrend', 'Data_grandTotal', 'Data_rateInSimilarType',
    'Data_rateInSimilarPersent', 'swithSameType', 'Data_currentFundManager',
    'Data_fluctuationScale', 'Data_holderStructure', 'Data_assetAllocation',
    'Data_performanceEvaluation', 'syl_1n', 'syl_6y', 'syl_3y', 'syl_1y',
  ];
  return fieldNames.reduce<Record<string, unknown>>((result, field) => {
    const value = readJavaScriptValue(data.source, field);
    if (value !== undefined) result[field] = value;
    return result;
  }, {});
}

async function getRemoteFundsFromEastmoney(): Promise<Fund.RemoteFund[]> {
  const source = await readText(`${EM_FUND}/js/fundcode_search.js?v=${Date.now()}`);
  const data = readJavaScriptValue(source, 'r');
  return Array.isArray(data) ? (data as Fund.RemoteFund[]) : [];
}

async function getFundRatingFromEasemoney(): Promise<Fund.RantingItem[]> {
  return safe(async () => {
    const url = `${EM_DATAAPI}/api/data/v1/get?reportName=RPT_FUND_RATING&columns=ALL&pageSize=5000&pageNumber=1&sortColumns=TOTAL&sortTypes=-1&source=WEB&client=WEB`;
    const data = await readJson<any>(url);
    return (data?.result?.data || []).map((d: any) => ({
      code: d.FCODE,
      name: d.SHORTNAME,
      type: d.FTYPE,
      szStar: d.SZ_STAR,
      zsStar: d.ZS_STAR,
      jaStar: d.JA_STAR,
      total: Number(d.TOTAL || 0),
    }));
  }, []);
}

async function getEstimatedFromEastmoney(code: string): Promise<Fund.ResponseItem | undefined> {
  return fromEastmoney(code);
}

async function getTodayListFromEastmoney(type: string = ""): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/clist/get?fid=f3&po=1&pz=20&pn=1&fs=b:MK0021&fields=f2,f3,f4,f12,f14`;
    const data = await readJson<any>(url);
    return (data?.data?.diff || []).map((d: any) => ({
      code: d.f12, name: d.f14, zxj: d.f2, zdf: d.f3, zde: d.f4,
    }));
  }, []);
}

// 基金排行榜：datacenter 的 RPT_FUND_NETVALUE 报表已下线，改用天天基金公开榜单脚本。
// 组件按 `code,name,pinyin,date,dwjz,ljjz,日,周,月` 逗号分隔解析，故直接返回原始字符串行。
// ft 映射：all=全部 gp=股票 hh=混合 zq=债券 zs=指数 qdii=QDII lof=LOF fof=FOF
async function getRankDataFromEasemoney(params: any): Promise<string[]> {
  const ftMap: Record<string, string> = {
    all: 'all', gp: 'gp', hh: 'hh', zq: 'zq', zs: 'zs',
    qdii: 'qdii', lof: 'lof', fof: 'fof',
  };
  const ft = ftMap[params] || ftMap[String(params?.fundType ?? '')] || 'all';
  return safe(async () => {
    const url = `${EM_FUND}/data/rankhandler.aspx?op=ph&dt=kf&ft=${ft}&rs=&gs=0&sc=1n&st=desc&sd=&ed=&qdii=&tabSubtype=,,,,,&pi=1&pn=100&dx=1&v=${Date.now()}`;
    const text = await readText(url);
    const m = text.match(/datas\s*:\s*(\[[\s\S]*?\])/);
    if (!m) return [];
    const rows = JSON.parse(m[1]);
    return Array.isArray(rows) ? rows.filter((r: any) => typeof r === 'string') : [];
  }, []);
}

async function getAutomaticPlanFromEastmoney(type: string = ""): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/clist/get?fid=f3&po=1&pz=20&pn=1&fs=b:MK0404&fields=f2,f3,f4,f12,f14`;
    const data = await readJson<any>(url);
    return (data?.data?.diff || []).map((d: any) => ({
      code: d.f12, name: d.f14, zxj: d.f2, zdf: d.f3, zde: d.f4,
    }));
  }, []);
}

async function getFundInfoByNameFromEaseMoney(name: string): Promise<Fund.ResponseItem | undefined> {
  return safe(async () => {
    const url = `${EM_DATAAPI}/api/data/v1/get?reportName=RPT_FUND_SIMPLEINFO&columns=FCODE,SHORTNAME,DWJZ,RZDF,PDATE,FTYPE&filter=(SHORTNAME like '%${encodeURIComponent(name)}%')&pageSize=5&pageNumber=1&source=WEB&client=WEB`;
    const data = await readJson<any>(url);
    const d = data?.result?.data?.[0];
    if (!d) return undefined;
    return {
      code: d.FCODE, name: d.SHORTNAME, dwjz: d.DWJZ,
      gszzl: d.RZDF, jzrq: d.PDATE, fundcode: d.FCODE,
    } as Fund.ResponseItem;
  }, undefined);
}

async function getFundManagerDetailFromEastMoney(code: string): Promise<any> {
  return safe(async () => {
    const url = `${EM_FUND}/pingzhongdata/${code}.js?v=${Date.now()}`;
    const source = await readText(url);
    return readJavaScriptValue(source, 'Data_currentFundManager') || [];
  }, []);
}

async function getFundPerformanceFromEastmoney(code: string, type: string = ""): Promise<any[]> {
  return safe(async () => {
    const data = await getFundPageData(code);
    if (!data) return [];
    // Data_grandTotal 是 [{ name, data: [[time, rate], ...], unit }] 格式
    const grandTotal = readJavaScriptValue(data.source, 'Data_grandTotal');
    if (Array.isArray(grandTotal)) return grandTotal;
    const rateInSimilar = readJavaScriptValue(data.source, 'Data_rateInSimilarType');
    if (Array.isArray(rateInSimilar)) return rateInSimilar;
    return [];
  }, []);
}

async function getIndustryRateFromEaseMoney(code: string = ""): Promise<{ stocks: any[]; expansion: string }> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/clist/get?fid=f3&po=1&pz=30&pn=1&fs=m:90+t:2&fields=f2,f3,f4,f12,f14`;
    const data = await readJson<any>(url);
    return {
      stocks: (data?.data?.diff || []).map((d: any) => ({
        code: d.f12, name: d.f14, zdf: d.f3, INDEXNAME: d.f14,
      })),
      expansion: '',
    };
  }, { stocks: [], expansion: '' });
}

async function getInverstStyleFromEastmoney(code: string): Promise<any> {
  return safe(async () => {
    const data = await getFundPageData(code);
    if (!data) return undefined;
    return readJavaScriptValue(data.source, 'Data_performanceEvaluation');
  }, undefined);
}

// 基金持仓：pingzhongdata 只有代码无名称/占比，改用 FundMNInverstPosition 拿真实持仓明细。
// TEXCH(交易编码)：1=上交所→secid 前缀 1，2=深交所→前缀 0。
async function fetchFundPosition(code: string, kind: 'stock' | 'bond'): Promise<Fund.WareHouse[]> {
  return safe(async () => {
    const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?FCODE=${code}&deviceid=1&plat=Android&product=EFund&version=1`;
    const data = await readJson<any>(url);
    const list: any[] = data?.Datas?.[kind === 'stock' ? 'fundStocks' : 'fundBonds'] || [];
    const isStock = kind === 'stock';
    return list.map((d: any) => {
      const exchange = String(d.TEXCH ?? d.NEWTEXCH ?? '');
      // 债券无 secid 跳转意义，market 置空；股票按交易编码映射市场
      const market = isStock ? (exchange === '1' ? '1' : exchange === '2' ? '0' : '') : '';
      return {
        zxz: d.PCTNVCHGTYPE || '',
        name: isStock ? (d.GPJC || '') : (d.ZQJC || d.BONDNAME || ''),
        code: isStock ? (d.GPDM || '') : (d.ZQDM || d.BONDCODE || ''),
        zdf: Number(isStock ? (d.PCTNVCHG || 0) : (d.PCTNVCHG || 0)) || 0,
        ccb: String(isStock ? (d.JZBL || '') : (d.JZBL || '')),
        market,
      } as Fund.WareHouse;
    });
  }, []);
}

async function getSecuritiesWareHouseFromEastmoney(code: string, codes: string = ""): Promise<Fund.WareHouse[]> {
  return fetchFundPosition(code, 'bond');
}

async function getStockWareHouseFromEastmoney(code: string, codes: string = ""): Promise<Fund.WareHouse[]> {
  return fetchFundPosition(code, 'stock');
}

export const Fund= {
  FromEastmoney: fromEastmoney,
  FromTencent: fromEastmoney,
  FromFund123: fromEastmoney,
  FromFund10jqka: fromEastmoney,
  GetFixFromEastMoney: getFixFromEastmoney,
  GetFundDetailFromEastmoney: getFundDetailFromEastmoney,
  GetRemoteFundsFromEastmoney: getRemoteFundsFromEastmoney,
  GetFundRatingFromEasemoney: getFundRatingFromEasemoney,
  GetEstimatedFromEastmoney: getEstimatedFromEastmoney,
  GetTodayListFromEastmoney: getTodayListFromEastmoney,
  GetRankDataFromEasemoney: getRankDataFromEasemoney,
  GetAutomaticPlanFromEastmoney: getAutomaticPlanFromEastmoney,
  GetFundInfoByNameFromEaseMoney: getFundInfoByNameFromEaseMoney,
  GetFundManagerDetailFromEastMoney: getFundManagerDetailFromEastMoney,
  GetFundPerformanceFromEastmoney: getFundPerformanceFromEastmoney,
  GetIndustryRateFromEaseMoney: getIndustryRateFromEaseMoney,
  GetInverstStyleFromEastmoney: getInverstStyleFromEastmoney,
  GetSecuritiesWareHouseFromEastmoney: getSecuritiesWareHouseFromEastmoney,
  GetStockWareHouseFromEastmoney: getStockWareHouseFromEastmoney,
};

// ─── Stock ───────────────────────────────────────────────────────

async function stockFromEastmoney(secid: string): Promise<Stock.ResponseItem | undefined> {
  return safe(async () => {
    const fields = 'f43,f44,f45,f46,f47,f48,f50,f51,f52,f55,f57,f58,f60,f80,f84,f85,f86,f116,f117,f169,f170,f171';
    const url = `${EM_PUSH2}/api/qt/stock/get?secid=${secid}&fields=${fields}&fltt=2`;
    const data = await readJson<any>(url);
    const d = data?.data;
    if (!d) return undefined;
    const parts = secid.split('.');
    return {
      secid,
      code: d.f57 || parts[1] || '',
      name: d.f58 || '',
      market: Number(parts[0]) || 0,
      zx: d.f43 ?? 0,
      zdd: d.f169 ?? 0,
      zdf: d.f170 ?? 0,
      zs: d.f60 ?? 0,
      zg: d.f44 ?? 0,
      zd: d.f45 ?? 0,
      jk: d.f46 ?? 0,
      time: d.f86 ? timeFromTimestamp(Number(d.f86)) : '',
      trends: [],
    };
  }, undefined);
}

// 东财搜索 Classify → StockMarketType 枚举值（与 renderer/utils/enums.ts 保持一致）
// AB=1, Zindex=2, Quotation=3, HK=4, US=5, UK=6, XSB=7, Fund=8, Bond=9, Futures=10, Exchange=11
const SEARCH_CLASSIFY_TYPE: Record<string, number> = {
  AStock: 1,
  Index: 2,
  '24': 2,
  BK: 3,
  HK: 4,
  UsStock: 5,
  UKStock: 6,
  Fund: 8,
  Bond: 9,
  Futures: 10,
  Exchange: 11,
};
const SEARCH_TYPE_NAME: Record<number, string> = {
  1: 'AB股', 2: '指数', 3: '板块', 4: '港股', 5: '美股',
  6: '英股', 7: '三板', 8: '基金', 9: '债券', 10: '期货', 11: '外汇',
};

async function stockSearchFromEastmoney(keyword: string): Promise<Stock.SearchResult[]> {
  return safe(async () => {
    const url = `${EM_SEARCH}/api/suggest/get?input=${encodeURIComponent(keyword)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=10`;
    const data = await readJson<any>(url);
    const items: any[] = data?.QuotationCodeTable?.Data || [];
    // 东财返回扁平列表，渲染层按 {Type, Name, Datas} 分组消费，此处按类型聚合
    const groups = new Map<number, any[]>();
    for (const item of items) {
      const type = SEARCH_CLASSIFY_TYPE[String(item.Classify)];
      if (!type) continue;
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type)!.push({
        Code: item.Code || '',
        Name: item.Name || '',
        ID: item.ID || '',
        MktNum: item.MktNum || '',
        SecurityType: item.SecurityType || '',
      });
    }
    return Array.from(groups, ([Type, Datas]) => ({ Type, Name: SEARCH_TYPE_NAME[Type] || '', Count: Datas.length, Datas }));
  }, []);
}

async function stockGetDetailFromEastmoney(secid: string): Promise<Stock.DetailItem | undefined> {
  return safe(async () => {
    const fields = 'f43,f44,f45,f46,f47,f48,f50,f51,f52,f55,f57,f58,f60,f80,f84,f85,f86,f116,f117,f168,f169,f170,f171';
    const url = `${EM_PUSH2}/api/qt/stock/get?secid=${secid}&fields=${fields}&fltt=2`;
    const data = await readJson<any>(url);
    const d = data?.data;
    if (!d) return undefined;
    return {
      code: d.f57 || '',
      name: d.f58 || '',
      market: 0,
      zg: d.f44 ?? 0,
      zd: d.f45 ?? 0,
      jk: d.f46 ?? 0,
      zss: d.f47 ?? 0,
      zt: d.f51 ?? 0,
      dt: d.f52 ?? 0,
      zx: d.f43 ?? 0,
      cjl: d.f47 ?? 0,
      lb: d.f48 ?? 0,
      cje: d.f48 ?? 0,
      wp: d.f49 ?? 0,
      zs: d.f60 ?? 0,
      jj: d.f80 ?? 0,
      np: d.f50 ?? 0,
      hs: d.f168 ?? 0,
      zdd: d.f169 ?? 0,
      zdf: d.f170 ?? 0,
      time: d.f86 ? timeFromTimestamp(Number(d.f86)) : '',
    };
  }, undefined);
}

async function stockGetTrendFromEastmoney(secid: string): Promise<{ trends: Stock.TrendItem[] }> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1&fltt=2`;
    const data = await readJson<any>(url);
    const trends = data?.data?.trends || [];
    return {
      trends: trends.map((t: string) => {
      const parts = t.split(',');
      return {
        datetime: parts[0] || '',
        last: Number(parts[1]) || 0,
        current: Number(parts[2]) || 0,
        average: Number(parts[3]) || 0,
      };
    }),
    };
  }, { trends: [] });
}

async function stockGetKFromEastmoney(secid: string, klt: number = 101, fqt: number = 1): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2HIS}/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=${klt}&fqt=${fqt}&beg=19900101&end=20500101`;
    const data = await readJson<any>(url);
    return parseKlines(data?.data?.klines);
  }, []);
}

async function stockGetPicTrendFromEastmoney(secid: string): Promise<any> {
  return getPicTrendUrl(secid);
}

async function stockGetMainRankFromEastmoney(type: string = ""): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/clist/get?fid=f62&po=1&pz=20&pn=1&fs=m:0+t:6+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2,m:0+t:81+s:2048+f:!2&fields=f12,f14,f62,f184,f66`;
    const data = await readJson<any>(url);
    return (data?.data?.diff || []).map((d: any) => ({
      code: d.f12, name: d.f14, mainNetInflow: d.f62, mainPercent: d.f184,
    }));
  }, []);
}

async function stockGetNorthRankFromEastmoney(type: string = ""): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2HIS}/api/qt/kamt.kline/get?fields1=f1,f3&fields2=f51,f52,f53,f54,f55,f56&klt=101&lmt=30`;
    const data = await readJson<any>(url);
    return data?.data?.s2n || [];
  }, []);
}

async function stockGetSelfRankFromEastmoney(type: string = ""): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/clist/get?fid=f3&po=1&pz=20&pn=1&fs=m:0+t:6+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2&fields=f12,f14,f2,f3,f4`;
    const data = await readJson<any>(url);
    return (data?.data?.diff || []).map((d: any) => ({
      code: d.f12, name: d.f14, zxj: d.f2, zdf: d.f3, zde: d.f4,
    }));
  }, []);
}

async function stockGetStockRank(fsCode: string = ""): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/clist/get?fid=f3&po=1&pz=20&pn=1&fs=${encodeURIComponent(fsCode)}&fields=f12,f14,f2,f3,f4`;
    const data = await readJson<any>(url);
    return (data?.data?.diff || []).map((d: any) => ({
      code: d.f12, name: d.f14, zxj: d.f2, zdf: d.f3, zde: d.f4,
    }));
  }, []);
}
async function stockGetStockHoldFunds(secid: string, date: string = ""): Promise<any> { return undefined; }
// 行业成分股：入参为个股 secid 时，取其所属行业板块的成分股；否则按行业板块列表返回。
// f13 为市场标识(1沪/0深/北)，用于拼接可点击的 secid。
async function stockGetIndustryFromEastmoney(secid: string = "", type: number = 2): Promise<Stock.IndustryItem[]> {
  return safe(async () => {
    let fs = `m:90+t:${type}`;
    // 个股 secid（如 1.600519）→ 先查所属行业板块代码（f127）
    if (/^\d+\.\d{6}$/.test(secid)) {
      const detail = await readJson<any>(`${EM_PUSH2}/api/qt/stock/get?secid=${secid}&fields=f127`);
      const bk = detail?.data?.f127;
      if (bk) fs = `b:${bk}`;
    }
    const url = `${EM_PUSH2}/api/qt/clist/get?fid=f3&po=1&pz=50&pn=1&fs=${encodeURIComponent(fs)}&fields=f12,f13,f14,f2,f3,f4`;
    const data = await readJson<any>(url);
    const raw = data?.data?.diff || [];
    const list: any[] = Array.isArray(raw) ? raw : Object.values(raw);
    return list.map((d: any) => ({
      code: d.f12 || '',
      name: d.f14 || '',
      secid: `${d.f13 ?? 0}.${d.f12}`,
      zxj: d.f2 ?? 0,
      zdf: d.f3 ?? 0,
      zde: d.f4 ?? 0,
    }));
  }, []);
}
// 公司简介：东财 F10 各市场 PageAjax 返回 gzip JSON（主进程 undici 自动解压）。
// A股字段最全(PC_HSF10)；港股字段较少(PC_HKF10)；美股/新三板无公开 F10，用行情快照尽力补充。
function normalizeCompany(d: any, market: 'ab' | 'hk'): Stock.Company {
  if (market === 'ab') {
    return {
      gsjs: d.ORG_PROFILE || '',
      sshy: d.EM2016 || d.INDUSTRYCSRC1 || '',
      dsz: d.CHAIRMAN || d.LEGAL_PERSON || '',
      zcdz: d.REG_ADDRESS || d.ADDRESS || '',
      clrq: d.FOUND_DATE || d.SETUP_DATE || '',
      ssrq: d.LISTING_DATE || '',
    };
  }
  // 港股：zqzl 节点
  return {
    gsjs: d.gsjj || d.companyProfile || '',
    sshy: d.bk || d.hy || '',
    dsz: d.dsz || d.chairman || '',
    zcdz: d.dz || d.address || '',
    clrq: d.clrq || d.foundDate || '',
    ssrq: d.ssrq || d.listDate || '',
  };
}

async function stockGetABCompany(code: string): Promise<Stock.Company | undefined> {
  return safe(async () => {
    // 兼容纯代码(600519)与 secid(1.600519)
    const raw = String(code).split('.').pop() || '';
    const m = /^(6|9)/.test(raw) ? 'SH' : /^(0|3)/.test(raw) ? 'SZ' : /^(8|4)/.test(raw) ? 'BJ' : 'SH';
    const url = `https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax?code=${m}${raw}`;
    const data = await readJson<any>(url);
    const jbzl = data?.jbzl?.[0];
    return jbzl ? normalizeCompany(jbzl, 'ab') : undefined;
  }, undefined);
}
async function stockGetHKCompany(code: string): Promise<Stock.Company | undefined> {
  return safe(async () => {
    const raw = String(code).split('.').pop() || '';
    const url = `https://emweb.securities.eastmoney.com/PC_HKF10/CompanyProfile/PageAjax?code=${raw}`;
    const data = await readJson<any>(url);
    const info = data?.zqzl || data?.company || data;
    return info ? normalizeCompany(info, 'hk') : undefined;
  }, undefined);
}
async function stockGetUSCompany(code: string): Promise<Stock.Company | undefined> {
  // 美股无公开 F10 明细接口，返回 undefined 由前端显示"暂无"，避免返回误导性空对象
  return undefined;
}
async function stockGetXSBCompany(code: string): Promise<Stock.Company | undefined> {
  return undefined;
}
async function stockGetCloseDayDates(): Promise<{ MKT: string; SDATE: string; EDATE: string; HOLIDAY: string }[]> {
  return safe(async () => {
    const url = `${EM_DATAAPI}/api/data/v1/get?reportName=RPT_TYCJK_HDAYINFO&columns=ALL&pageSize=200&pageNumber=1&sortColumns=SDATE&sortTypes=-1&source=WEB&client=WEB`;
    const data = await readJson<any>(url);
    return (data?.result?.data || []).map((d: any) => ({
      MKT: d.MKT || '', SDATE: d.SDATE || '', EDATE: d.EDATE || '', HOLIDAY: d.HOLIDAY || '',
    }));
  }, []);
}
async function stockGetReportDate(): Promise<string[]> {
  return safe(async () => {
    const today = new Date();
    const year = today.getFullYear();
    const dates: string[] = [];
    for (let y = year; y >= year - 2; y--) {
      dates.push(`${y}-12-31`, `${y}-09-30`, `${y}-06-30`, `${y}-03-31`);
    }
    return dates;
  }, []);
}
async function stockGetMeetingData(params: { code: string; startTime: string; endTime: string }): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_DATAAPI}/api/data/v1/get?reportName=RPT_ECONOMY_MEETING&columns=ALL&filter=(START_DATE>='${params.startTime}')(END_DATE<='${params.endTime}')(CODE='${params.code}')&pageSize=50&pageNumber=1&sortColumns=START_DATE&sortTypes=1&source=WEB&client=WEB`;
    const data = await readJson<any>(url);
    return data?.result?.data || [];
  }, []);
}

export const Stock= {
  FromEastmoney: stockFromEastmoney,
  SearchFromEastmoney: stockSearchFromEastmoney,
  GetDetailFromEastmoney: stockGetDetailFromEastmoney,
  GetTrendFromEastmoney: stockGetTrendFromEastmoney,
  GetKFromEastmoney: stockGetKFromEastmoney,
  GetPicTrendFromEastmoney: stockGetPicTrendFromEastmoney,
  GetMainRankFromEastmoney: stockGetMainRankFromEastmoney,
  GetNorthRankFromEastmoney: stockGetNorthRankFromEastmoney,
  GetSelfRankFromEastmoney: stockGetSelfRankFromEastmoney,
  GetStockRank: stockGetStockRank,
  GetStockHoldFunds: stockGetStockHoldFunds,
  GetIndustryFromEastmoney: stockGetIndustryFromEastmoney,
  GetABCompany: stockGetABCompany,
  GetHKCompany: stockGetHKCompany,
  GetUSCompany: stockGetUSCompany,
  GetXSBCompany: stockGetXSBCompany,
  GetCloseDayDates: stockGetCloseDayDates,
  GetReportDate: stockGetReportDate,
  GetMeetingData: stockGetMeetingData,
};

// ─── Zindex ──────────────────────────────────────────────────────

// 新浪指数API（push2不可用时的fallback）
const SINA_HQ = 'https://hq.sinajs.cn';
// 腾讯指数API（美股指数fallback）
const TX_QT = 'https://qt.gtimg.cn';

// 东方财富secid → 新浪code映射 (market.code → sh/sz+code)
function emToSinaCode(code: string): string | null {
  const [market, symbol] = code.split('.');
  if (market === '1') return `s_sh${symbol}`;
  if (market === '0') return `s_sz${symbol}`;
  return null; // 美股等不支持
}

// 东方财富secid → 腾讯code映射
function emToTxCode(code: string): string | null {
  const [market, symbol] = code.split('.');
  if (market === '1') return `sh${symbol}`;
  if (market === '0') return `sz${symbol}`;
  // 美股指数
  if (market === '100') {
    const map: Record<string, string> = { DJIA: 'usDJI', SPX: 'usSPX', NDX: 'usIXIC' };
    return map[symbol] || null;
  }
  return null;
}

// 批量行情接口（ulist）：一次请求拉全部指数，clist 字段体系
// 实测 0.1~0.3s，支持 A股/港股/美股指数混批；f7(振幅)/f8(换手)在该接口不可用，恒为0
function zindexUlistFields(d: any): Omit<Zindex.ResponseItem, 'code' | 'trends'> {
  const num = (v: any) => {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  };
  return {
    name: d.f14 || '',
    zindexCode: d.f12 || '',
    type: num(d.f13),
    zsz: num(d.f2),
    zdd: num(d.f4),
    zdf: num(d.f3),
    zg: num(d.f15),
    zd: num(d.f16),
    jk: num(d.f17),
    zs: num(d.f18),
    hs: 0,
    zf: 0,
    time: d.f124 ? timeFromTimestamp(Number(d.f124)) : '',
  };
}

async function zindexFromUlist(codes: string[]): Promise<Zindex.ResponseItem[]> {
  if (!codes.length) return [];
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/ulist.np/get?fltt=2&fields=f2,f3,f4,f12,f13,f14,f15,f16,f17,f18,f124&secids=${codes.join(',')}`;
    const data = await readJson<any>(url, { Referer: 'https://quote.eastmoney.com/' });
    const diff = data?.data?.diff;
    if (!Array.isArray(diff)) return [];
    // diff 顺序与请求顺序一致，按 code 关联
    const byCode = new Map<string, any>();
    for (const d of diff) {
      const symbol = String(d.f12 || '');
      const market = String(d.f13 ?? '');
      if (symbol) byCode.set(`${market}.${symbol}`, d);
    }
    return codes
      .map((code): Zindex.ResponseItem | undefined => {
        const d = byCode.get(code);
        if (!d) return undefined;
        return { ...zindexUlistFields(d), code, trends: [] };
      })
      .filter((item) => item !== undefined);
  }, []);
}

async function zindexFromEastmoney(code: string): Promise<Zindex.ResponseItem | undefined> {
  // 优先 stock/get（字段最全，含换手/振幅），该接口部分线路不稳定
  const result = await zindexFromPush2(code);
  if (result) return result;

  // 批量接口兜底（实测稳定，缺换手/振幅）
  const fromUlist = await zindexFromUlist([code]);
  if (fromUlist[0]) return fromUlist[0];

  // 新浪/腾讯API fallback
  return zindexFromFallback(code);
}

// 批量获取指数行情：一次请求，替代逐个串行轮询
async function zindexFromEastmoneyBatch(codes: string[]): Promise<Zindex.ResponseItem[]> {
  return zindexFromUlist(codes);
}

async function zindexFromPush2(code: string): Promise<Zindex.ResponseItem | undefined> {
  return safe(async () => {
    const fields = 'f43,f44,f45,f46,f47,f48,f50,f57,f58,f60,f86,f116,f168,f169,f170,f171';
    const url = `${EM_PUSH2}/api/qt/stock/get?secid=${code}&fields=${fields}&fltt=2`;
    const data = await readJson<any>(url);
    const d = data?.data;
    if (!d) return undefined;
    const parts = code.split('.');
    return {
      name: d.f58 || '',
      zindexCode: d.f57 || parts[1] || '',
      type: Number(parts[0]) || 0,
      zsz: d.f43 ?? 0,
      zdd: d.f169 ?? 0,
      zdf: d.f170 ?? 0,
      zg: d.f44 ?? 0,
      zd: d.f45 ?? 0,
      jk: d.f46 ?? 0,
      zs: d.f60 ?? 0,
      hs: d.f168 ?? 0,
      zf: d.f171 ?? 0,
      time: d.f86 ? timeFromTimestamp(Number(d.f86)) : '',
      code,
      trends: [],
    };
  }, undefined);
}

// 新浪/腾讯API fallback（push2不可用时）
async function zindexFromFallback(code: string): Promise<Zindex.ResponseItem | undefined> {
  return safe(async () => {
    const parts = code.split('.');
    const type = Number(parts[0]) || 0;

    // 国内指数用新浪API
    const sinaCode = emToSinaCode(code);
    if (sinaCode) {
      const text = await readText(`${SINA_HQ}/list=${sinaCode}`, { Referer: 'https://finance.sina.com.cn/' });
      if (text) {
        // 格式: var hq_str_s_sh000001="上证指数,3887.3167,8.8871,0.23,5065166,101224768";
        const match = text.match(/="([^"]+)"/);
        if (match) {
          const fields = match[1].split(',');
          if (fields.length >= 4) {
            return {
              name: fields[0] || '',
              zindexCode: parts[1] || '',
              type,
              zsz: Number(fields[1]) || 0,
              zdd: Number(fields[2]) || 0,
              zdf: Number(fields[3]) || 0,
              zg: 0, zd: 0, jk: 0, zs: 0, hs: 0, zf: 0,
              time: '',
              code,
              trends: [],
            };
          }
        }
      }
    }

    // 腾讯API（含美股指数）
    const txCode = emToTxCode(code);
    if (txCode) {
      const text = await readText(`${TX_QT}/q=${txCode}`, { Referer: 'https://gu.qq.com/' });
      if (text) {
        // 格式: v_sh000001="1~上证指数~000001~3887.32~3878.43~3864.27~...";
        const match = text.match(/="([^"]+)"/);
        if (match) {
          const fields = match[1].split('~');
          if (fields.length >= 10) {
            const zsz = Number(fields[3]) || 0;   // 最新价
            const zs = Number(fields[4]) || 0;     // 昨收
            const zdd = zsz - zs;
            const zdf = zs ? (zdd / zs) * 100 : 0;
            return {
              name: fields[1] || '',
              zindexCode: fields[2] || parts[1] || '',
              type,
              zsz,
              zdd,
              zdf: Number(zdf.toFixed(2)),
              zg: Number(fields[5]) || 0,  // 最高
              zd: Number(fields[6]) || 0,  // 最低
              jk: Number(fields[5]) || 0,  // 今开（近似）
              zs,
              hs: 0, zf: 0,
              time: '',
              code,
              trends: [],
            };
          }
        }
      }
    }

    return undefined;
  }, undefined);
}

async function zindexGetTrendFromEastmoney(code: string, type: string = ""): Promise<Zindex.TrendItem[]> {
  return safe(async () => {
    // push2his 线路实测稳定（push2 的 trends2 常被 RST）
    const url = `${EM_PUSH2HIS}/api/qt/stock/trends2/get?secid=${code}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1&fltt=2`;
    const data = await readJson<any>(url);
    return parseTrends(data?.data?.trends);
  }, []);
}

async function zindexGetKFromEastmoney(code: string, klt: number = 101, fqt: number = 1): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2HIS}/api/qt/stock/kline/get?secid=${code}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=${klt}&fqt=${fqt}&beg=19900101&end=20500101`;
    const data = await readJson<any>(url);
    return parseKlines(data?.data?.klines);
  }, []);
}

async function zindexGetPicTrendFromEastmoney(code: string): Promise<any> {
  return getPicTrendUrl(code);
}

async function zindexGetEconomyIndexFromEastmoney(table: string = "", fields: string = ""): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_DATAAPI}/api/data/v1/get?reportName=${table}&columns=${fields}&pageSize=50&pageNumber=1&sortColumns=REPORT_DATE&sortTypes=-1&source=WEB&client=WEB`;
    const data = await readJson<any>(url);
    return data?.result?.data || [];
  }, []);
}
// 国家队持股个股明细：datacenter RPT_NATIONAL_STATISTICS，字段与 Details 组件完全对应。
async function zindexGetNationalTeamDetail(type: string = ""): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_DATAAPI}/api/data/v1/get?reportName=RPT_NATIONAL_STATISTICS&columns=ALL&pageSize=100&pageNumber=1&source=WEB&client=WEB`;
    const data = await readJson<any>(url);
    return data?.result?.data || [];
  }, []);
}
async function zindexGetNationalTeamDistributed(): Promise<{ MARKETCAPRATIO_SUM_0: number; MARKETCAPRATIO_SUM_1: number; MARKETCAPRATIO_SUM_2: number; REPORT_DATE: string }> {
  return safe(async () => {
    const url = `${EM_DATAAPI}/api/data/v1/get?reportName=RPT_FUNDSHOLD_MARKETCAP&columns=REPORT_DATE,MARKETCAPRATIO_SUM_0,MARKETCAPRATIO_SUM_1,MARKETCAPRATIO_SUM_2&pageSize=1&pageNumber=1&sortColumns=REPORT_DATE&sortTypes=-1&source=WEB&client=WEB`;
    const data = await readJson<any>(url);
    const d = data?.result?.data?.[0];
    return {
      MARKETCAPRATIO_SUM_0: d?.MARKETCAPRATIO_SUM_0 ?? 0,
      MARKETCAPRATIO_SUM_1: d?.MARKETCAPRATIO_SUM_1 ?? 0,
      MARKETCAPRATIO_SUM_2: d?.MARKETCAPRATIO_SUM_2 ?? 0,
      REPORT_DATE: d?.REPORT_DATE || '',
    };
  }, { MARKETCAPRATIO_SUM_0: 0, MARKETCAPRATIO_SUM_1: 0, MARKETCAPRATIO_SUM_2: 0, REPORT_DATE: '' });
}
async function zindexGetNationalTeamTrend(): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_DATAAPI}/api/data/v1/get?reportName=RPT_FUNDSHOLD_MARKETCAP&columns=REPORT_DATE,TOTAL_SHARES,HOLD_MARKET_CAP,SHARES_RATIO,INDEX_NAME&pageSize=50&pageNumber=1&sortColumns=REPORT_DATE&sortTypes=-1&source=WEB&client=WEB`;
    const data = await readJson<any>(url);
    return data?.result?.data || [];
  }, []);
}
async function zindexGetOilPriceFromEastmoney(): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_DATAAPI}/api/data/v1/get?reportName=RPT_ECONOMY_OIL_PRICE&columns=ALL&pageSize=50&pageNumber=1&sortColumns=REPORT_DATE&sortTypes=-1&source=WEB&client=WEB`;
    const data = await readJson<any>(url);
    return data?.result?.data || [];
  }, []);
}
async function zindexGetTreasuryYieldData(): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_DATAAPI}/api/data/v1/get?reportName=RPT_BOND_CN_TREASURYYIELD&columns=ALL&pageSize=100&pageNumber=1&sortColumns=SOLAR_DATE&sortTypes=-1&source=WEB&client=WEB`;
    const data = await readJson<any>(url);
    return data?.result?.data || [];
  }, []);
}

export const Zindex= {
  FromEastmoney: zindexFromEastmoney,
  FromEastmoneyBatch: zindexFromEastmoneyBatch,
  GetTrendFromEastmoney: zindexGetTrendFromEastmoney,
  GetKFromEastmoney: zindexGetKFromEastmoney,
  GetPicTrendFromEastmoney: zindexGetPicTrendFromEastmoney,
  GetEconomyIndexFromEastmoney: zindexGetEconomyIndexFromEastmoney,
  GetNationalTeamDetail: zindexGetNationalTeamDetail,
  GetNationalTeamDistributed: zindexGetNationalTeamDistributed,
  GetNationalTeamTrend: zindexGetNationalTeamTrend,
  GetOilPriceFromEastmoney: zindexGetOilPriceFromEastmoney,
  GetTreasuryYieldData: zindexGetTreasuryYieldData,
};

// ─── Quotation ───────────────────────────────────────────────────

async function quotationGetQuotationsFromEastmoney(type: number = 1, page: number = 1): Promise<Quotation.ResponseItem[]> {
  return safe(async () => {
    // 东财 2026 接口：板块列表 fs=m:90+t:N（t:1地域 t:2行业 t:3概念），旧格式 fs=b:t:N 已下线（返回 data:null）
    // 注意 fs 里的 + 必须编码为 %2B，否则被解析成空格
    // 单页上限 100 条；风控：请求过密返回空响应，调用方需控制间隔
    const pn = page || 1;
    const url = `${EM_PUSH2}/api/qt/clist/get?fid=f3&po=1&pz=100&pn=${pn}&fs=m:90%2Bt:${type}&fields=f2,f3,f4,f8,f12,f14,f104,f105,f128,f140,f141,f136`;
    const data = await readJson<any>(url);
    return (data?.data?.diff || []).map((d: any) => ({
      code: d.f12,
      name: d.f14,
      type,
      zxj: d.f2 ?? 0,
      zde: d.f4 ?? 0,
      zdd: d.f4 ?? 0,
      zdf: d.f3 ?? 0,
      zsz: 0,
      hs: d.f8 ?? 0,
      szjs: d.f104 ?? 0,
      xdjs: d.f105 ?? 0,
      lzgpCode: d.f140 || '',
      lzgpMarket: 0,
      lzgpName: d.f141 || '',
      lzgpZdf: d.f136 ?? 0,
      ldgpCode: '', ldgpMarket: 0, ldgpName: '', ldgpZdf: 0,
    }));
  }, []);
}

async function quotationGetQuotationDetailFromEastmoney(code: string): Promise<Quotation.DetailData | undefined> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/stock/get?secid=${code}&fields=f43,f57,f58,f60,f104,f105,f169,f170,f168&fltt=2`;
    const data = await readJson<any>(url);
    const d = data?.data;
    if (!d) return undefined;
    return {
      name: d.f58 || '',
      code: d.f57 || '',
      szjs: d.f104 ?? 0,
      xdjs: d.f105 ?? 0,
      zdf: d.f170 ?? 0,
      zdd: d.f169 ?? 0,
      hsl: d.f168 ?? 0,
      zxj: d.f43 ?? 0,
      zs: d.f60 ?? 0,
    };
  }, undefined);
}

// 区域/行业/概念资金流：fs 为板块范围(如 m:90+t:1)，type 为周期字段(f62今日/f164五日/f174十日)
// clist 返回对象/数组两种形态，统一归一化为 {name, value}[]（value 单位：亿元）
async function quotationGetFundFlowFromEastmoney(code: string, type: string = ""): Promise<any[]> {
  return safe(async () => {
    const fid = type || 'f62';
    const url = `${EM_PUSH2}/api/qt/clist/get?fid=${fid}&po=1&pz=50&pn=1&fs=${encodeURIComponent(code)}&fields=f12,f14,f62,f164,f174`;
    const data = await readJson<any>(url);
    const raw = data?.data?.diff || [];
    // diff 可能是数组或下标对象
    const list: any[] = Array.isArray(raw) ? raw : Object.values(raw);
    return list.map((d: any) => ({
      name: d.f14 || '',
      value: Number(d[fid] ?? d.f62 ?? 0) / 1e8,
    }));
  }, []);
}

async function quotationGetFlowFromEastmoney(fields: string, code: string = ""): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2HIS}/api/qt/stock/fflow/daykline/get?secid=${code}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63&lmt=30`;
    const data = await readJson<any>(url);
    return parseFundFlowKlines(data?.data?.klines);
  }, []);
}

// 主题基金列表：改用天天基金公开榜单脚本（原 stock/get 快照不含基金字段）。
// 字段序：code,name,pinyin,type,近1周,近1月,近3月,近6月,近1年,...
// 组件期望 {FCODE, SHORTNAME, SYL_Z(周), SYL_Y(月), SYL_1N(年)}
async function quotationGetFundsFromEastmoney(code: string): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_FUND}/data/FundGuideapi.aspx?dt=0&ft=&sd=&ed=&sc=z&st=desc&pi=1&pn=50&zf=diy&sh=list&v=${Date.now()}`;
    const text = await readText(url);
    const m = text.match(/datas\s*:\s*(\[[\s\S]*?\])/);
    if (!m) return [];
    const rows = JSON.parse(m[1]);
    return (Array.isArray(rows) ? rows : []).filter((r: any) => typeof r === 'string').map((row: string) => {
      const p = row.split(',');
      return {
        FCODE: p[0] || '',
        SHORTNAME: p[1] || '',
        code: p[0] || '',
        SYL_Z: p[4] ?? '',
        SYL_Y: p[5] ?? '',
        SYL_1N: p[8] ?? '',
      };
    });
  }, []);
}

async function quotationGetStocksFromEasymoney(code: string): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/clist/get?fid=f3&po=1&pz=20&pn=1&fs=b:${code}&fields=f12,f14,f2,f3,f4`;
    const data = await readJson<any>(url);
    return (data?.data?.diff || []).map((d: any) => ({
      code: d.f12, name: d.f14, zxj: d.f2, zdf: d.f3, zde: d.f4,
    }));
  }, []);
}

async function quotationGetMainFundFromEastmoney(code: string = ""): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/clist/get?fid=f62&po=1&pz=20&pn=1&fs=m:0+t:6+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2&fields=f12,f14,f62,f184`;
    const data = await readJson<any>(url);
    return (data?.data?.diff || []).map((d: any) => ({
      code: d.f12, name: d.f14, mainNetInflow: d.f62, mainPercent: d.f184,
    }));
  }, []);
}

async function quotationGetRealTimeFundFlowFromEasymoney(code: string): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/stock/fflow/kline/get?secid=${code}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&lmt=0&klt=1`;
    const data = await readJson<any>(url);
    return parseFundFlowKlines(data?.data?.klines, true);
  }, []);
}

async function quotationGetAfterTimeFundFlowFromEasymoney(code: string): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2HIS}/api/qt/stock/fflow/daykline/get?secid=${code}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58&lmt=5`;
    const data = await readJson<any>(url);
    return parseFundFlowKlines(data?.data?.klines);
  }, []);
}

// 实时交易构成饼图：从当日资金流净额按档位拆出流入/流出（净额为正计入流入，为负计入流出）。
// 组件期望 {cddlr,ddlr,zdlr,xdlr,xdlc,zdlc,ddlc,cddlc}，单位亿元。
async function quotationGetTransactionFromEasymoney(code: string): Promise<any> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/stock/get?secid=${code}&fields=f62,f66,f72,f78,f84,f184&fltt=2`;
    const data = await readJson<any>(url);
    const d = data?.data;
    if (!d) return undefined;
    const yi = (v: any) => (Number(v) || 0) / 1e8;
    // f66超大单 f72大单 f78中单 f84小单 净额；流入取正值，流出取负值绝对值
    const split = (v: any) => { const n = Math.abs(yi(v)); return { in: n > 0 && yi(v) > 0 ? n : 0, out: n > 0 && yi(v) < 0 ? n : 0 }; };
    const cd = split(d.f66), dd = split(d.f72), zd = split(d.f78), xd = split(d.f84);
    return {
      cddlr: cd.in, ddlr: dd.in, zdlr: zd.in, xdlr: xd.in,
      cddlc: cd.out, ddlc: dd.out, zdlc: zd.out, xdlc: xd.out,
    };
  }, undefined);
}

async function quotationGet2MarketVolume(): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/ulist.np/get?fltt=2&secids=1.000001,0.399001&fields=f48`;
    const data = await readJson<any>(url);
    const diff = data?.data?.diff || [];
    // 固定顺序：上证、深证；f48 为成交额（元）
    return [Number(diff[0]?.f48) || 0, Number(diff[1]?.f48) || 0];
  }, []);
}

async function quotationGetNorthDayFromEastmoney(fields: string = "", type: string = ""): Promise<{ s2n: any[]; hk2sh: any[]; hk2sz: any[] }> {
  return safe(async () => {
    const url = `${EM_PUSH2HIS}/api/qt/kamt.kline/get?fields1=f1,f3&fields2=f51,f52,f53,f54,f55,f56&klt=101&lmt=30`;
    const data = await readJson<any>(url);
    return {
      s2n: data?.data?.s2n || [],
      hk2sh: data?.data?.hk2sh || [],
      hk2sz: data?.data?.hk2sz || [],
    };
  }, { s2n: [], hk2sh: [], hk2sz: [] });
}

async function quotationGetSouthDayFromEastmoney(fields: string = "", type: string = ""): Promise<{ sh2hk: any[]; sz2hk: any[]; n2s: any[] }> {
  return safe(async () => {
    const url = `${EM_PUSH2HIS}/api/qt/kamt.kline/get?fields1=f1,f3&fields2=f51,f52,f53,f54,f55,f56&klt=101&lmt=30`;
    const data = await readJson<any>(url);
    return {
      sh2hk: data?.data?.sh2hk || [],
      sz2hk: data?.data?.sz2hk || [],
      n2s: data?.data?.n2s || [],
    };
  }, { sh2hk: [], sz2hk: [], n2s: [] });
}

// 涨跌分布：全市场上涨/下跌/平盘家数（f104/f105/f106），映射为组件兼容的 {name,value} 档位。
// name 为涨跌幅区间档（-11跌停 -10..10平 11涨停），此处以三档汇总填充，缺口为 0。
async function quotationGetDistributionFromEastmoney(code: string = ""): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/ulist.np/get?fltt=2&secids=1.000001,0.399001&fields=f104,f105,f106`;
    const data = await readJson<any>(url);
    const diff = data?.data?.diff || [];
    const list: any[] = Array.isArray(diff) ? diff : Object.values(diff);
    const up = list.reduce((s, d) => s + (Number(d?.f104) || 0), 0);
    const down = list.reduce((s, d) => s + (Number(d?.f105) || 0), 0);
    const flat = list.reduce((s, d) => s + (Number(d?.f106) || 0), 0);
    if (!up && !down && !flat) return [];
    // 构造 23 档：跌停(-11) / -10..10 / 涨停(11)，把汇总量放在代表档
    const result: any[] = [];
    for (let i = -11; i <= 11; i++) {
      let value = 0;
      if (i === -11) value = down;
      else if (i === 11) value = up;
      else if (i === 0) value = flat;
      result.push({ name: String(i), value });
    }
    return result;
  }, []);
}

async function quotationGetHotThemeFromEastmoney(): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/clist/get?fid=f3&po=1&pz=20&pn=1&fs=m:90+t:2&fields=f12,f14,f3,f62,f184`;
    const data = await readJson<any>(url);
    return (data?.data?.diff || []).map((d: any) => ({
      code: d.f12, name: d.f14, zdf: d.f3 ?? 0, mainNetInflow: d.f62 ?? 0, mainPercent: d.f184 ?? 0,
    }));
  }, []);
}
async function quotationGetTodayHotFromEastmoney(): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/clist/get?fid=f62&po=1&pz=20&pn=1&fs=m:0+t:6+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2&fields=f12,f14,f2,f3,f62,f184`;
    const data = await readJson<any>(url);
    return (data?.data?.diff || []).map((d: any) => ({
      code: d.f12, name: d.f14, zxj: d.f2 ?? 0, zdf: d.f3 ?? 0, mainNetInflow: d.f62 ?? 0, mainPercent: d.f184 ?? 0,
    }));
  }, []);
}
async function quotationGetRecentHotFromEastmoney(): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/clist/get?fid=f184&po=1&pz=20&pn=1&fs=m:0+t:6+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2&fields=f12,f14,f2,f3,f62,f184`;
    const data = await readJson<any>(url);
    return (data?.data?.diff || []).map((d: any) => ({
      code: d.f12, name: d.f14, zxj: d.f2 ?? 0, zdf: d.f3 ?? 0, mainNetInflow: d.f62 ?? 0, mainPercent: d.f184 ?? 0,
    }));
  }, []);
}
async function quotationGetQuoteCenterFromEastmoney(): Promise<{ TopText: any; MarketStyle: any[]; Recommend: any[] }> {
  return safe(async () => {
    const url = `${EM_DATAAPI}/api/data/v1/get?reportName=RPT_MUTUAL_QUOTECENTER&columns=ALL&pageSize=50&pageNumber=1&source=WEB&client=WEB`;
    const data = await readJson<any>(url);
    return {
      TopText: data?.result?.data?.[0]?.TopText || { PositionInd: 0, Title: '', Content: '' },
      MarketStyle: data?.result?.data?.[0]?.MarketStyle || [],
      Recommend: data?.result?.data?.[0]?.Recommend || [],
    };
  }, { TopText: { PositionInd: 0, Title: '', Content: '' }, MarketStyle: [], Recommend: [] });
}
async function quotationGetGBTrendFromEastmoney(): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2HIS}/api/qt/stock/kline/get?secid=0.399001&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=101&fqt=1&beg=19900101&end=20500101`;
    const data = await readJson<any>(url);
    return parseKlines(data?.data?.klines).map((item) => ({ name: item.date, val: item.sp }));
  }, []);
}
// 涨停/跌停家数分时：东财当日池子含首次封板时间(fbt)，按分钟桶累积统计，构造日内时间序列。
// t 为 HHMM 数值（组件用 dayjs().set('hours', t/100).set('minutes', t%100) 格式化）。
const ZT_UT = '7eea3edcaed734bea9cbfc24409ed989';
function todayYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
function toHHMM(value: any): number {
  const s = String(value ?? '').padStart(4, '0');
  const h = parseInt(s.slice(0, -2), 10) || 9;
  const m = parseInt(s.slice(-2), 10) || 30;
  return h * 100 + m;
}
async function fetchPool(kind: 'ZT' | 'DT' | 'ZB'): Promise<any[]> {
  return safe(async () => {
    const url = `https://push2ex.eastmoney.com/getTopic${kind}Pool?ut=${ZT_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=200&sort=fbt%3Aasc&date=${todayYMD()}`;
    const data = await readJson<any>(url);
    const pool = data?.data?.pool || [];
    return Array.isArray(pool) ? pool : Object.values(pool);
  }, []);
}
async function quotationGetTopicZDTCountFromEastmoney(): Promise<{ t: number; ztc: number; dtc: number }[]> {
  const [zt, dt] = await Promise.all([fetchPool('ZT'), fetchPool('DT')]);
  if (!zt.length && !dt.length) return [];
  // 收集所有封板时间点，排序后累积计数
  const points = new Set<number>([930]);
  zt.forEach((d: any) => points.add(toHHMM(d.fbt)));
  dt.forEach((d: any) => points.add(toHHMM(d.fbt)));
  const times = [...points].filter((t) => t >= 930 && t <= 1500).sort((a, b) => a - b);
  return times.map((t) => ({
    t,
    ztc: zt.filter((d: any) => toHHMM(d.fbt) <= t).length,
    dtc: dt.filter((d: any) => toHHMM(d.fbt) <= t).length,
  }));
}
async function quotationGetTopicFBFailedFromEastmoney(): Promise<{ t: number; zbp: number; c: number }[]> {
  const [zt, zb] = await Promise.all([fetchPool('ZT'), fetchPool('ZB')]);
  if (!zt.length && !zb.length) return [];
  const points = new Set<number>([930]);
  zb.forEach((d: any) => points.add(toHHMM(d.fbt)));
  const times = [...points].filter((t) => t >= 930 && t <= 1500).sort((a, b) => a - b);
  return times.map((t) => {
    const failed = zb.filter((d: any) => toHHMM(d.fbt) <= t).length;
    const sealed = zt.length; // 当前封板数（近似）
    return {
      t,
      zbp: sealed + failed > 0 ? (failed / (sealed + failed)) * 100 : 0,
      c: failed,
    };
  });
}
async function quotationGetGoldTrendsFromEastmoney(secid: string = ""): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2HIS}/api/qt/stock/kline/get?secid=${secid || '0.AU'}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=101&fqt=1&beg=19900101&end=20500101`;
    const data = await readJson<any>(url);
    return parseKlines(data?.data?.klines).map((item) => [new Date(item.date).getTime(), item.sp]);
  }, []);
}
async function quotationGetGoldKFromEastmoney(): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2HIS}/api/qt/stock/kline/get?secid=0.AU&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=102&fqt=1&beg=19900101&end=20500101`;
    const data = await readJson<any>(url);
    return parseKlinesMatrix(data?.data?.klines);
  }, []);
}
async function quotationGetShanghaiGoldFuturesFromEastmoney(): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/stock/get?secid=113.aum&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f170`;
    const data = await readJson<any>(url);
    return data?.data ? [data.data] : [];
  }, []);
}
async function quotationGetShanghaiGoldGoodsFromEastmoney(): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/stock/get?secid=113.aus&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f170`;
    const data = await readJson<any>(url);
    return data?.data ? [data.data] : [];
  }, []);
}
async function quotationGetInternationalMetalFuturesFromEastmoney(): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/stock/get?secid=113.xau&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f170`;
    const data = await readJson<any>(url);
    return data?.data ? [data.data] : [];
  }, []);
}
async function quotationGetInternationalMetalGoodsFromEastmoney(): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/stock/get?secid=113.xausd&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f170`;
    const data = await readJson<any>(url);
    return data?.data ? [data.data] : [];
  }, []);
}

export const Quotation= {
  GetQuotationsFromEastmoney: quotationGetQuotationsFromEastmoney,
  GetQuotationDetailFromEastmoney: quotationGetQuotationDetailFromEastmoney,
  GetFundFlowFromEastmoney: quotationGetFundFlowFromEastmoney,
  GetFlowFromEastmoney: quotationGetFlowFromEastmoney,
  GetFundsFromEastmoney: quotationGetFundsFromEastmoney,
  GetStocksFromEasymoney: quotationGetStocksFromEasymoney,
  GetMainFundFromEastmoney: quotationGetMainFundFromEastmoney,
  GetRealTimeFundFlowFromEasymoney: quotationGetRealTimeFundFlowFromEasymoney,
  GetAfterTimeFundFlowFromEasymoney: quotationGetAfterTimeFundFlowFromEasymoney,
  GetTransactionFromEasymoney: quotationGetTransactionFromEasymoney,
  Get2MarketVolume: quotationGet2MarketVolume,
  GetNorthDayFromEastmoney: quotationGetNorthDayFromEastmoney,
  GetSouthDayFromEastmoney: quotationGetSouthDayFromEastmoney,
  GetDistributionFromEastmoney: quotationGetDistributionFromEastmoney,
  GetHotThemeFromEastmoney: quotationGetHotThemeFromEastmoney,
  GetTodayHotFromEastmoney: quotationGetTodayHotFromEastmoney,
  GetRecentHotFromEastmoney: quotationGetRecentHotFromEastmoney,
  GetQuoteCenterFromEastmoney: quotationGetQuoteCenterFromEastmoney,
  GetGBTrendFromEastmoney: quotationGetGBTrendFromEastmoney,
  GetTopicZDTCountFromEastmoney: quotationGetTopicZDTCountFromEastmoney,
  GetTopicFBFailedFromEastmoney: quotationGetTopicFBFailedFromEastmoney,
  GetGoldTrendsFromEastmoney: quotationGetGoldTrendsFromEastmoney,
  GetGoldKFromEastmoney: quotationGetGoldKFromEastmoney,
  GetShanghaiGoldFuturesFromEastmoney: quotationGetShanghaiGoldFuturesFromEastmoney,
  GetShanghaiGoldGoodsFromEastmoney: quotationGetShanghaiGoldGoodsFromEastmoney,
  GetInternationalMetalFuturesFromEastmoney: quotationGetInternationalMetalFuturesFromEastmoney,
  GetInternationalMetalGoodsFromEastmoney: quotationGetInternationalMetalGoodsFromEastmoney,
};

// ─── News ────────────────────────────────────────────────────────

async function newsGetList(column: string): Promise<News.ResponseItem[]> {
  return safe(async () => {
    const url = `${EM_NEWS}/comm/web/getNewsByColumns?client=web&biz=web_news&column=${column}&pageSize=20&pageIndex=0`;
    const data = await readJson<any>(url);
    return (data?.data?.list || []).map((d: any) => ({
      idL: String(d.id || ''),
      url_unique: d.url_unique || d.url || '',
      url_m: d.url_m || d.url_w || '',
      title: d.title || '',
      type: d.type || '',
      showtime: d.showtime || '',
    }));
  }, []);
}

async function newsGetRecent(keyword: string, pageIndex: number, filter: any): Promise<any> {
  return safe(async () => {
    // 东财 7×24 快讯接口已改版（强制 fastColumn/sortEnd/req_trace，且不再支持 keyword 过滤），
    // 改走站内资讯搜索接口（so.eastmoney.com 同款），按关键词搜相关新闻，命中率更高
    const param = {
      uid: '',
      keyword: keyword || '',
      type: ['cmsArticleWebOld'],
      client: 'web',
      clientType: 'web',
      clientVersion: 'curr',
      param: {
        cmsArticleWebOld: {
          searchScope: 'default',
          sort: 'default',
          pageIndex: pageIndex || 1,
          pageSize: 10,
          preTag: '<em>',
          postTag: '</em>',
        },
      },
    };
    const url = `https://search-api-web.eastmoney.com/search/jsonp?cb=foundfish&param=${encodeURIComponent(JSON.stringify(param))}`;
    const text = await readText(url, { Referer: 'https://so.eastmoney.com/' });
    const m = text.match(/^[^(]*\(([\s\S]*)\)\s*$/);
    const data = JSON.parse(m ? m[1] : text);
    const rows = data?.result?.cmsArticleWebOld || [];
    return {
      list: rows.map((d: any) => ({
        code: String(d.code || ''),
        date: d.date || '',
        content: d.title || d.content || '',
        url: d.url || d.uniqueUrl || '',
      })),
      total: data?.hitsTotal || rows.length,
    };
  }, { list: [], total: 0 });
}

async function newsGetGuBaList(keyword: string, type: string): Promise<{ idL: string; url: string; title: string; type: string; showtime: string }[]> {
  return safe(async () => {
    const url = `${EM_SEARCH}/api/suggest/get?input=${encodeURIComponent(keyword)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=10`;
    const data = await readJson<any>(url);
    return (data?.QuotationCodeTable?.Data || []).map((d: any) => ({
      idL: String(d.Code || ''),
      url: d._id || '',
      title: d.Name || '',
      type: d.MarketType || '',
      showtime: '',
    }));
  }, []);
}

export const News= {
  GetFundList: () => newsGetList('250'),
  GetBondList: () => newsGetList('251'),
  GetChinaList: () => newsGetList('252'),
  GetEuList: () => newsGetList('253'),
  GetExchangeList: () => newsGetList('254'),
  GetFocusList: () => newsGetList('255'),
  GetGlobalList: () => newsGetList('256'),
  GetGuBaList: newsGetGuBaList,
  GetJpList: () => newsGetList('257'),
  GetListedList: () => newsGetList('258'),
  GetLiveList: () => newsGetList('259'),
  GetUkList: () => newsGetList('260'),
  GetUsaList: () => newsGetList('261'),
  GetRecent: newsGetRecent,
};

// ─── Exchange ────────────────────────────────────────────────────

async function exchangeGetListFromEastmoney(sortType: string, filter: string): Promise<Exchange.ResponseItem[]> {
  return safe(async () => {
    const fid = sortType === '1' ? 'f3' : 'f3';
    const url = `${EM_PUSH2}/api/qt/clist/get?fid=${fid}&po=1&pz=50&pn=1&fs=${encodeURIComponent(filter)}&fields=f2,f3,f4,f12,f14,f43,f60,f44,f45,f46`;
    const data = await readJson<any>(url);
    return (data?.data?.diff || []).map((d: any) => ({
      code: d.f12,
      name: d.f14,
      zxj: d.f2 ?? 0,
      zde: d.f4 ?? 0,
      zdf: d.f3 ?? 0,
      jk: d.f46 ?? 0,
      zg: d.f44 ?? 0,
      zd: d.f45 ?? 0,
      zs: d.f60 ?? 0,
    }));
  }, []);
}

async function exchangeGetGlobalBondFromEastmoney(): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/clist/get?fid=f3&po=1&pz=30&pn=1&fs=m:0+t:6+f:!2,m:0+t:80+f:!2&fields=f12,f14,f2,f3,f4`;
    const data = await readJson<any>(url);
    return (data?.data?.diff || []).map((d: any) => ({
      code: d.f12, name: d.f14, zxj: d.f2 ?? 0, zdf: d.f3 ?? 0, zde: d.f4 ?? 0,
    }));
  }, []);
}

export const Exchange= {
  GetListFromEastmoney: exchangeGetListFromEastmoney,
  GetGlobalBondFromEastmoney: exchangeGetGlobalBondFromEastmoney,
};

// ─── Time ────────────────────────────────────────────────────────

async function timeGetCurrentDateTimeFromTaobao(): Promise<string> {
  return safe(async () => {
    const url = 'https://api.m.taobao.com/rest/api3.do?api=mtop.common.getTimestamp';
    const data = await readJson<any>(url);
    return data?.data?.t || String(Date.now());
  }, String(Date.now()));
}

async function timeGetCurrentDateTimeFromSuning(): Promise<string> {
  return safe(async () => {
    const url = 'https://f.m.suning.com/api/ct.do';
    const data = await readJson<any>(url);
    return String(data?.timestamp || Date.now());
  }, String(Date.now()));
}

export const Time= {
  GetCurrentDateTimeFromTaobao: timeGetCurrentDateTimeFromTaobao,
  GetCurrentDateTimeFromSuning: timeGetCurrentDateTimeFromSuning,
};

// ─── Log ─────────────────────────────────────────────────────────

// 更新日志：改用 GitHub Releases API（原实现为空数组）。
interface UpdateLog { version: string; date: string; contents: string[] }
async function logGetLog(): Promise<UpdateLog[]> {
  return safe(async () => {
    const data = await readJson<any[]>(
      'https://api.github.com/repos/zdh903/foundfish/releases?per_page=20',
      { Accept: 'application/vnd.github+json' }
    );
    if (!Array.isArray(data)) return [];
    return data.map((r: any) => ({
      version: r.tag_name || '',
      date: r.published_at || r.created_at || '',
      contents: String(r.body || '')
        .split('\n')
        .map((line: string) => line.replace(/^[\s*\-]+/, '').trim())
        .filter(Boolean)
        .slice(0, 20),
    }));
  }, []);
}

export const Log= {
  GetLog: logGetLog,
};
