import React, { useEffect, useState } from 'react';
import ChartCard from '@/components/Card/ChartCard';

import * as Services from '@lib/enh/services';
import * as Enums from '@/utils/enums';
import styles from './index.module.css';

export const defaultCompany: Stock.Company = {
  gsjs: '',
  sshy: '', // 所属行业
  dsz: '', // 董事长
  zcdz: '', // 注册地址
  clrq: '', // 成立日期
  ssrq: '', // 上市日期
};
export interface CompanyProps {
  secid: string;
}

const Company: React.FC<CompanyProps> = ({ secid }) => {
  const [company, setCompany] = useState<Stock.Company>(defaultCompany);

  async function getCompany(type: Enums.StockMarketType) {
    let company = defaultCompany;
    switch (type) {
      case Enums.StockMarketType.AB:
        company = (await Services.Stock.GetABCompany(secid)) || defaultCompany;
        break;
      case Enums.StockMarketType.HK:
        company = (await Services.Stock.GetHKCompany(secid)) || defaultCompany;
        break;
      case Enums.StockMarketType.US:
        company = (await Services.Stock.GetUSCompany(secid)) || defaultCompany;
        break;
      case Enums.StockMarketType.XSB:
        company = (await Services.Stock.GetXSBCompany(secid)) || defaultCompany;
        break;
      default:
        break;
    }
    setCompany(company);
  }

  // 根据 secid 前缀判断市场：1/0=A股，116=港股，105/106/107=美股，83/82=新三板
  const getMarketType = (): Enums.StockMarketType => {
    const prefix = secid.split('.')[0];
    if (prefix === '116') return Enums.StockMarketType.HK;
    if (['105', '106', '107'].includes(prefix)) return Enums.StockMarketType.US;
    if (['83', '82'].includes(prefix)) return Enums.StockMarketType.XSB;
    return Enums.StockMarketType.AB;
  };

  useEffect(() => {
    getCompany(getMarketType());
  }, [secid]);

  return (
    <ChartCard auto onFresh={() => getCompany(getMarketType())}>
      <div className={styles.content}>
        <div>
          <label>董事长/法人代表：</label>
          <span>{company.dsz || '暂无~'}</span>
        </div>
        <div>
          <label>所属行业：</label>
          <span>{company.sshy || '暂无~'}</span>
        </div>
        <div>
          <label>注册地址：</label>
          <span>{company.zcdz || '暂无~'}</span>
        </div>
        <div>
          <label>成立日期：</label>
          <span>{company.clrq || '暂无~'}</span>
        </div>
        <div>
          <label>上市日期：</label>
          <span>{company.ssrq || '暂无~'}</span>
        </div>
        <div>
          <span>{company.gsjs || '暂无公司简介~'}</span>
        </div>
      </div>
    </ChartCard>
  );
};

export default Company;
