import * as Enums from '@/utils/enums';
import * as Utils from '@/utils';

export interface FundSortMode {
  type: Enums.FundSortType;
  order: Enums.SortOrderType;
}
export interface ZindexSortMode {
  type: Enums.ZindexSortType;
  order: Enums.SortOrderType;
}
export interface QuotationSortType {
  type: Enums.QuotationSortType;
  order: Enums.SortOrderType;
}

export const fundSortModeOptions: Option.EnumsOption<Enums.FundSortType>[] = [
  { key: Enums.FundSortType.Custom, label: '自定义' },
  { key: Enums.FundSortType.Growth, label: '今日涨幅' },
  { key: Enums.FundSortType.Cost, label: '持有成本' },
  { key: Enums.FundSortType.Money, label: '今日收益' },
  { key: Enums.FundSortType.Estimate, label: '今日总值' },
  { key: Enums.FundSortType.Income, label: '持有收益' },
  { key: Enums.FundSortType.IncomeRate, label: '持有收益率' },
  { key: Enums.FundSortType.Name, label: '名称(A-Z)' },
];

export const zindexSortModeOptions: Option.EnumsOption<Enums.ZindexSortType>[] = [
  { key: Enums.ZindexSortType.Custom, label: '自定义' },
  { key: Enums.ZindexSortType.Zdd, label: '涨跌点' },
  { key: Enums.ZindexSortType.Zdf, label: '涨跌幅' },
  { key: Enums.ZindexSortType.Zsz, label: '指数值' },
  { key: Enums.ZindexSortType.Name, label: '名称(A-Z)' },
];

export const quotationSortModeOptions: Option.EnumsOption<Enums.QuotationSortType>[] = [
  { key: Enums.QuotationSortType.Zdf, label: '涨跌幅' },
  { key: Enums.QuotationSortType.Zde, label: '涨跌额' },
  { key: Enums.QuotationSortType.Zdd, label: '涨跌点' },
  { key: Enums.QuotationSortType.Zsz, label: '总市值' },
  { key: Enums.QuotationSortType.Zxj, label: '最新价' },
  { key: Enums.QuotationSortType.Szjs, label: '上涨家数' },
  { key: Enums.QuotationSortType.Xdjs, label: '下跌家数' },
  { key: Enums.QuotationSortType.Name, label: '名称(A-Z)' },
];

export function GetSortConfig() {
  const fundSortModeOptionsMap = Utils.GetCodeMap(fundSortModeOptions, 'key');
  const zindexSortModeOptionsMap = Utils.GetCodeMap(zindexSortModeOptions, 'key');
  const quotationSortModeOptionsMap = Utils.GetCodeMap(quotationSortModeOptions, 'key');

  return {
    fundSortModeOptions,
    zindexSortModeOptions,
    quotationSortModeOptions,
    fundSortModeOptionsMap,
    zindexSortModeOptionsMap,
    quotationSortModeOptionsMap,
  };
}
