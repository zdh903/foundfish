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
          // 尝试获取实时估值，失败时保留最新单位净值
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

async function getRankDataFromEasemoney(params: any): Promise<any[]> {
  return safe(async () => {
    const { fundType = '0', sort = 'fncl', asc = '0', pn = 1, pz = 50 } = params || {};
    const url = `${EM_DATAAPI}/api/data/v1/get?reportName=RPT_FUND_NETVALUE&columns=ALL&pageSize=${pz}&pageNumber=${pn}&sortColumns=${sort}&sortTypes=${asc}&source=WEB&client=WEB&filter=(FTYPE=${fundType})`;
    const data = await readJson<any>(url);
    return (data?.result?.data || []).map((d: any) => ({
      code: d.FCODE, name: d.SHORTNAME, dwjz: d.DWJZ, gszzl: d.RZDF,
      jzrq: d.PDATE, fundType: d.FTYPE,
    }));
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

async function getSecuritiesWareHouseFromEastmoney(code: string, codes: string = ""): Promise<Fund.WareHouse[]> {
  return safe(async () => {
    const data = await getFundPageData(code);
    if (!data) return [];
    const zqCodes = readJavaScriptValue(data.source, 'zqCodesNew');
    if (!zqCodes) return [];
    // Parse bond codes string
    const codes = typeof zqCodes === 'string' ? zqCodes.split(',') : [];
    return codes.map((c: string) => ({ zxz: '', name: '', code: c, zdf: 0, ccb: '' }));
  }, []);
}

async function getStockWareHouseFromEastmoney(code: string, codes: string = ""): Promise<Fund.WareHouse[]> {
  return safe(async () => {
    const data = await getFundPageData(code);
    if (!data) return [];
    const stockCodes = readJavaScriptValue(data.source, 'stockCodesNew');
    if (!stockCodes || !Array.isArray(stockCodes)) return [];
    return stockCodes.map((c: string) => ({ zxz: '', name: '', code: c, zdf: 0, ccb: '' }));
  }, []);
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

async function stockSearchFromEastmoney(keyword: string): Promise<Stock.SearchResult[]> {
  return safe(async () => {
    const url = `${EM_SEARCH}/api/suggest/get?input=${encodeURIComponent(keyword)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=5`;
    const data = await readJson<any>(url);
    return data?.QuotationCodeTable?.Data || [];
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
    return data?.data?.klines || [];
  }, []);
}

async function stockGetPicTrendFromEastmoney(secid: string): Promise<any> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/stock/get?secid=${secid}&fields=f43,f57,f58,f60,f169,f170&fltt=2`;
    const data = await readJson<any>(url);
    return data?.data;
  }, undefined);
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
async function stockGetIndustryFromEastmoney(secid: string = "", type: number = 2): Promise<Stock.IndustryItem[]> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/clist/get?fid=f3&po=1&pz=30&pn=1&fs=m:90+t:${type}&fields=f12,f14,f2,f3,f4`;
    const data = await readJson<any>(url);
    return (data?.data?.diff || []).map((d: any) => ({
      code: d.f12, name: d.f14, zxj: d.f2 ?? 0, zdf: d.f3 ?? 0, zde: d.f4 ?? 0,
    }));
  }, []);
}
async function stockGetABCompany(code: string): Promise<Stock.Company | undefined> { return undefined; }
async function stockGetHKCompany(code: string): Promise<Stock.Company | undefined> { return undefined; }
async function stockGetUSCompany(code: string): Promise<Stock.Company | undefined> { return undefined; }
async function stockGetXSBCompany(code: string): Promise<Stock.Company | undefined> { return undefined; }
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
    const trends = data?.data?.trends || [];
    return trends.map((t: string) => {
      const parts = t.split(',');
      return { time: parts[0] || '', price: Number(parts[1]) || 0, cjl: Number(parts[4]) || 0 };
    });
  }, []);
}

async function zindexGetKFromEastmoney(code: string, klt: number = 101, fqt: number = 1): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2HIS}/api/qt/stock/kline/get?secid=${code}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=${klt}&fqt=${fqt}&beg=19900101&end=20500101`;
    const data = await readJson<any>(url);
    return data?.data?.klines || [];
  }, []);
}

async function zindexGetPicTrendFromEastmoney(code: string): Promise<any> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/stock/get?secid=${code}&fields=f43,f57,f58,f60,f169,f170&fltt=2`;
    const data = await readJson<any>(url);
    return data?.data;
  }, undefined);
}

async function zindexGetEconomyIndexFromEastmoney(table: string = "", fields: string = ""): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_DATAAPI}/api/data/v1/get?reportName=${table}&columns=${fields}&pageSize=50&pageNumber=1&sortColumns=REPORT_DATE&sortTypes=-1&source=WEB&client=WEB`;
    const data = await readJson<any>(url);
    return data?.result?.data || [];
  }, []);
}
async function zindexGetNationalTeamDetail(type: string = ""): Promise<any> { return undefined; }
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

async function quotationGetFundFlowFromEastmoney(code: string, type: string = ""): Promise<any> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/ulist.get?secid=${code}&fields=f12,f14,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f64,f65,f70,f76,f82`;
    const data = await readJson<any>(url);
    return data?.data;
  }, undefined);
}

async function quotationGetFlowFromEastmoney(fields: string, code: string = ""): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2HIS}/api/qt/stock/fflow/daykline/get?secid=${code}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63&lmt=30`;
    const data = await readJson<any>(url);
    return data?.data?.klines || [];
  }, []);
}

async function quotationGetFundsFromEastmoney(code: string): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/stock/get?secid=${code}&fields=f57,f58,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87`;
    const data = await readJson<any>(url);
    return data?.data ? [data.data] : [];
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

async function quotationGetRealTimeFundFlowFromEasymoney(code: string): Promise<any> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/stock/get?secid=${code}&fields=f57,f58,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87`;
    const data = await readJson<any>(url);
    return data?.data;
  }, undefined);
}

async function quotationGetAfterTimeFundFlowFromEasymoney(code: string): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2HIS}/api/qt/stock/fflow/daykline/get?secid=${code}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58&lmt=5`;
    const data = await readJson<any>(url);
    return data?.data?.klines || [];
  }, []);
}

async function quotationGetTransactionFromEasymoney(code: string): Promise<any> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/stock/get?secid=${code}&fields=f43,f47,f48,f50,f57,f58,f168,f169,f170`;
    const data = await readJson<any>(url);
    return data?.data;
  }, undefined);
}

async function quotationGet2MarketVolume(): Promise<any> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/ulist.get?secid=1.000001,0.399001&fields=f12,f14,f43,f47,f48,f170`;
    const data = await readJson<any>(url);
    return data?.data;
  }, undefined);
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

async function quotationGetDistributionFromEastmoney(code: string = ""): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2}/api/qt/stock/get?secid=${code}&fields=f57,f58,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87`;
    const data = await readJson<any>(url);
    return data?.data ? [data.data] : [];
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
    return data?.data?.klines || [];
  }, []);
}
async function quotationGetTopicZDTCountFromEastmoney(): Promise<any> { return undefined; }
async function quotationGetTopicFBFailedFromEastmoney(): Promise<any> { return undefined; }
async function quotationGetGoldTrendsFromEastmoney(secid: string = ""): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2HIS}/api/qt/stock/kline/get?secid=${secid || '0.AU'}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=101&fqt=1&beg=19900101&end=20500101`;
    const data = await readJson<any>(url);
    return data?.data?.klines || [];
  }, []);
}
async function quotationGetGoldKFromEastmoney(): Promise<any[]> {
  return safe(async () => {
    const url = `${EM_PUSH2HIS}/api/qt/stock/kline/get?secid=0.AU&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=102&fqt=1&beg=19900101&end=20500101`;
    const data = await readJson<any>(url);
    return data?.data?.klines || [];
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

async function logGetLog(): Promise<any[]> {
  return [];
}

export const Log= {
  GetLog: logGetLog,
};
