declare namespace Wallet {
  export interface SettingItem {
    name: string;
    iconIndex: number;
    code: string;
    funds: Fund.SettingItem[];
    /** 历史遗留：旧版本股票持仓配置，股票栏目已移除，仅兼容旧存储结构 */
    stocks?: Stock.SettingItem[];
  }
  export interface StateItem {
    code: string;
    funds: (Fund.ResponseItem & Fund.FixData & Fund.ExtraRow)[];
    /** 历史遗留：旧版本股票行情数据，股票栏目已移除 */
    stocks?: (Stock.ResponseItem & Stock.ExtraRow)[];
    updateTime: string;
  }
  export interface CodeMap {
    [index: string]: Wallet.SettingItem & Wallet.OriginRow;
  }
  export interface OriginRow {
    originSort: number;
  }

  export interface SortRow {
    id: string;
  }
}
