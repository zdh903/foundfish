import * as Services from '@lib/enh/services';
import * as Enums from '@/utils/enums';
import * as Adpters from '@/utils/adpters';
import * as Utils from '@/utils';

// 东财板块接口单页上限 100 条；行业约 496 个、概念约 516 个、地域约 31 个
// 风控：连续请求会返回空响应（实测冷却 25-60s，安全间隔约 4s），空结果时冷却重试一次
const PAGE_SIZE = 100;
const CHOKE_DELAY = 4000;
const COOLDOWN_MS = 30000;

async function fetchAllPages(type: Enums.QuotationType, maxPages: number): Promise<Quotation.ResponseItem[]> {
  const result: Quotation.ResponseItem[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const rows = await Services.Quotation.GetQuotationsFromEastmoney(type, page);
    result.push(...rows);
    if (rows.length === 0) {
      // 空响应：可能触发了风控，冷却后重试一次
      await Utils.Sleep(COOLDOWN_MS);
      const retry = await Services.Quotation.GetQuotationsFromEastmoney(type, page);
      if (retry.length === 0) break;
      result.push(...retry);
      if (retry.length < PAGE_SIZE) break;
      continue;
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return result;
}

export async function GetQuotations() {
  // 按类型分页拉全量：t:1地域 t:2行业 t:3概念（东财 2026 新接口 fs=m:90+t:N）
  const result = await Adpters.ChokeAllAdapter(
    [
      () => fetchAllPages(Enums.QuotationType.Area, 1),
      () => fetchAllPages(Enums.QuotationType.Industry, 6),
      () => fetchAllPages(Enums.QuotationType.Concept, 7),
    ],
    CHOKE_DELAY
  );
  return result.flat();
}

export function SortQuotation({
  list,
  orderType,
  sortType,
}: {
  list: (Quotation.ResponseItem & Quotation.ExtraRow)[];
  sortType: Enums.QuotationSortType;
  orderType: Enums.SortOrderType;
}) {
  const sortList = list.slice();
  sortList.sort((a, b) => {
    const t = orderType === Enums.SortOrderType.Asc ? 1 : -1;
    switch (sortType) {
      case Enums.QuotationSortType.Zde:
        return (Number(a.zde) - Number(b.zde)) * t;
      case Enums.QuotationSortType.Zdd:
        return (Number(a.zdd) - Number(b.zdd)) * t;
      case Enums.QuotationSortType.Zsz:
        return (Number(a.zsz) - Number(b.zsz)) * t;
      case Enums.QuotationSortType.Zxj:
        return (Number(a.zxj) - Number(b.zxj)) * t;
      case Enums.QuotationSortType.Szjs:
        return (Number(a.szjs) - Number(b.szjs)) * t;
      case Enums.QuotationSortType.Xdjs:
        return (Number(a.xdjs) - Number(b.xdjs)) * t;
      case Enums.QuotationSortType.Name:
        return b.name.localeCompare(a.name, 'zh') * t;
      case Enums.QuotationSortType.Zdf:
      default:
        return (Number(a.zdf) - Number(b.zdf)) * t;
    }
  });
  return sortList;
}
