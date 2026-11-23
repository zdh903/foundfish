import * as Services from '@lib/enh/services';
import * as Utils from '@/utils';
import * as Enums from '@/utils/enums';

export async function GetZindexs(config: Zindex.SettingItem[]) {
  if (!config.length) return [];
  const codes = config.map(({ code }) => code);

  // 第一优先：批量接口，一次请求拉全部（实测 0.1~0.3s，含美股指数）
  const batch = await Services.Zindex.FromEastmoneyBatch(codes);
  if (batch.length === codes.length) return batch;

  // 批量部分失败：并发补齐缺失项（每个走 stock/get → ulist → 新浪/腾讯 降级链）
  const batchMap = new Map(batch.map((item) => [item.code, item]));
  const missing = codes.filter((code) => !batchMap.has(code));
  const collectors = missing.map(
    (code) =>
      () =>
        GetZindex(code)
  );
  const rest = await Promise.all(collectors.map((c) => c()));
  return batch.concat(rest.filter(Utils.NotEmpty));
}

export async function GetZindex(code: string) {
  const zindex = await Services.Zindex.FromEastmoney(code);
  return zindex;
}

export function SortZindex({
  codeMap,
  list,
  orderType,
  sortType,
}: {
  list: (Zindex.ResponseItem & Zindex.ExtraRow)[];
  sortType: Enums.ZindexSortType;
  codeMap: Zindex.CodeMap;
  orderType: Enums.SortOrderType;
}) {
  const sortList = list.slice();
  sortList.sort((a, b) => {
    const t = orderType === Enums.SortOrderType.Asc ? 1 : -1;
    switch (sortType) {
      case Enums.ZindexSortType.Zdd:
        return (a.zdd - b.zdd) * t;
      case Enums.ZindexSortType.Zdf:
        return (a.zdf - b.zdf) * t;
      case Enums.ZindexSortType.Zsz:
        return (a.zsz - b.zsz) * t;
      case Enums.ZindexSortType.Name:
        return b.name.localeCompare(a.name, 'zh') * t;
      case Enums.ZindexSortType.Custom:
      default:
        return (codeMap[b.code]?.originSort - codeMap[a.code]?.originSort) * t;
    }
  });
  return sortList;
}
