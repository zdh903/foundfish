import React from 'react';
import clsx from 'clsx';
import { useRequest } from 'ahooks';
import { Tabs } from 'antd';

import Trend from '@/components/Home/QuotationView/DetailQuotationContent/Trend';
import ColorfulTags from '@/components/ColorfulTags';
import Estimate from '@/components/Home/QuotationView/DetailQuotationContent/Estimate';
import K from '@/components/Home/QuotationView/DetailQuotationContent/K';
import Company from '@/components/Home/QuotationView/DetailStockContent/Company';
import Stocks from '@/components/Home/QuotationView/DetailStockContent/Stocks';
import HoldFunds from '@/components/Home/QuotationView/DetailStockContent/HoldFunds';
import Recent from '@/components/Home/NewsList/Recent';
import CycleReturn from '@/components/Home/FundView/DetailFundContent/CycleReturn';
import CustomDrawerContent from '@/components/CustomDrawer/Content';
import GuBa from '@/components/Home/NewsList/GuBa';
import AfterTimeFundFlow from '@/components/Home/QuotationView/DetailQuotationContent/AfterTimeFundFlow';
import RealTimeFundFlow from '@/components/Home/QuotationView/DetailQuotationContent/RealTimeFundFlow';
import { useAppSelector } from '@/utils/hooks';
import * as Services from '@lib/enh/services';
import * as Utils from '@/utils';
import * as CONST from '@/constants';

import styles from './index.module.css';

export type DetailStockProps = {
  secid: string;
  type?: string | number;
};

export interface DetailStockContentProps extends DetailStockProps {
  onEnter: () => void;
  onClose: () => void;
}

export const DetailStock: React.FC<DetailStockProps> = (props) => {
  const { secid } = props;

  const { data: stock = {} as any } = useRequest(Services.Stock.GetDetailFromEastmoney, {
    pollingInterval: 1000 * 60,
    defaultParams: [secid],
    cacheKey: Utils.GenerateRequestKey('Stock.GetDetailFromEastmoney', secid),
  });

  const { data: industrys = [] } = useRequest(Services.Stock.GetIndustryFromEastmoney, {
    defaultParams: [secid, 3],
    cacheKey: Utils.GenerateRequestKey('Stock.GetIndustryFromEastmoney', secid),
    staleTime: CONST.DEFAULT.SWR_STALE_DELAY,
  });

  const { data: kdata = [], run: runGetKFromEastmoney } = useRequest(() => Services.Stock.GetKFromEastmoney(secid, 101, 3600), {
    cacheKey: Utils.GenerateRequestKey('Stock.GetKFromEastmoney', [secid, 101, 3600]),
  });

  return (
    <div className={styles.content}>
      <div className={styles.container}>
        <h3 className={styles.titleRow}>
          <span className="copify">{stock.name}</span>
          <span className={clsx(Utils.GetValueColor(stock.zdd).textClass)}>{stock.zx}</span>
        </h3>
        <div className={styles.subTitleRow}>
          <div>
            <span className="copify">{stock.code}</span>
          </div>
          <div>
            <span className={styles.detailItemLabel}>涨跌点：</span>
            <span className={clsx(Utils.GetValueColor(stock.zdd).textClass)}>{Utils.Yang(stock.zdd)}</span>
          </div>
        </div>
        <div className={styles.detail}>
          <div className={clsx(styles.detailItem, 'text-left')}>
            <div className={clsx(Utils.GetValueColor(stock.zdf).textClass)}>{Utils.Yang(stock.zdf)}%</div>
            <div className={styles.detailItemLabel}>涨跌幅</div>
          </div>
          <div className={clsx(styles.detailItem, 'text-center')}>
            <div>{stock.hs}%</div>
            <div className={styles.detailItemLabel}>换手率</div>
          </div>
          <div className={clsx(styles.detailItem, 'text-right')}>
            <div>{stock.zss}万</div>
            <div className={styles.detailItemLabel}>总手数</div>
          </div>
        </div>
        <div className={styles.detail}>
          <div className={clsx(styles.detailItem, 'text-left')}>
            <div className={clsx(Utils.GetValueColor(stock.jk - stock.zs).textClass)}>{Utils.Yang(stock.jk)}</div>
            <div className={styles.detailItemLabel}>今开</div>
          </div>
          <div className={clsx(styles.detailItem, 'text-center')}>
            <div className={clsx('text-up')}>{stock.zg}</div>
            <div className={styles.detailItemLabel}>最高</div>
          </div>
          <div className={clsx(styles.detailItem, 'text-right')}>
            <div className={clsx('text-down')}>{stock.zd}</div>
            <div className={styles.detailItemLabel}>最低</div>
          </div>
        </div>
        <div className={styles.detail}>
          <div className={clsx(styles.detailItem, 'text-left')}>
            <div>{stock.zs}</div>
            <div className={styles.detailItemLabel}>昨收</div>
          </div>
          <div className={clsx(styles.detailItem, 'text-center')}>
            <div className={clsx('text-up')}>{stock.zt}</div>
            <div className={styles.detailItemLabel}>涨停</div>
          </div>
          <div className={clsx(styles.detailItem, 'text-right')}>
            <div className={clsx('text-down')}>{stock.dt}</div>
            <div className={styles.detailItemLabel}>跌停</div>
          </div>
        </div>
        <div className={styles.detail}>
          <div className={clsx(styles.detailItem, 'text-left')}>
            <div>{stock.wp}万</div>
            <div className={styles.detailItemLabel}>外盘</div>
          </div>
          <div className={clsx(styles.detailItem, 'text-center')}>
            <div>{stock.np}万</div>
            <div className={styles.detailItemLabel}>内盘</div>
          </div>
          <div className={clsx(styles.detailItem, 'text-right')}>
            <div>{stock.jj}</div>
            <div className={styles.detailItemLabel}>均价</div>
          </div>
        </div>
        <ColorfulTags tags={industrys.map((industry) => industry.name)} />
      </div>
      <div className={styles.container}>
        <Tabs
          animated={{ tabPane: true }}
          tabBarGutter={15}
          items={[
            {
              key: String(0),
              label: '股票走势',
              children: <Trend secid={secid} zs={stock.zs} name={stock.name} />,
            },
            {
              key: String(1),
              label: '走势详情',
              children: <Estimate secid={secid} />,
            },
            {
              key: String(2),
              label: '近期资讯',
              children: <Recent keyword={stock.name} />,
            },
            {
              key: String(3),
              label: '股吧',
              children: <GuBa keyword={stock.name} type="100" />,
            },
          ]}
        />
      </div>
      <div className={styles.container}>
        <Tabs
          animated={{ tabPane: true }}
          tabBarGutter={15}
          items={[
            {
              key: String(0),
              label: 'K线',
              children: <K secid={secid} name={stock.name} />,
            },
            {
              key: String(1),
              label: '实时资金',
              children: <RealTimeFundFlow secid={secid} />,
            },
            {
              key: String(2),
              label: '盘后资金',
              children: <AfterTimeFundFlow secid={secid} />,
            },
            {
              key: String(3),
              label: '周期回报',
              children: <CycleReturn onFresh={runGetKFromEastmoney} data={kdata.map(({ date: x, sp: y }) => ({ x, y }))} />,
            },
          ]}
        />
      </div>
      <div className={styles.container}>
        <Tabs
          animated={{ tabPane: true }}
          tabBarGutter={15}
          items={[
            {
              key: String(0),
              label: '持股基金',
              children: <HoldFunds secid={secid} />,
            },
            {
              key: String(1),
              label: '公司概况',
              children: <Company secid={secid} />,
            },
            {
              key: String(2),
              label: '同类股票',
              children: <Stocks secid={secid} />,
            },
          ]}
        />
      </div>
    </div>
  );
};

const DetailStockContent: React.FC<DetailStockContentProps> = (props) => {
  return (
    <CustomDrawerContent title="股票详情" onClose={props.onClose} onEnter={props.onEnter}>
      <DetailStock secid={props.secid} />
    </CustomDrawerContent>
  );
};

export default DetailStockContent;
