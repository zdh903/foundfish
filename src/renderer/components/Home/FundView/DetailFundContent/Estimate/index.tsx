import React from 'react';
import { useRequest } from 'ahooks';
import ChartCard from '@/components/Card/ChartCard';
import * as Services from '@lib/enh/services';
import * as CONST from '@/constants';
import * as Utils from '@/utils';
import styles from './index.module.css';

export interface EstimateProps {
  code: string;
}
const Estimate: React.FC<EstimateProps> = ({ code }) => {
  const { data, run: runGetEstimatedFromEastmoney } = useRequest(() => Services.Fund.GetEstimatedFromEastmoney(code), {
    pollingInterval: CONST.DEFAULT.ESTIMATE_FUND_DELAY,
    refreshDeps: [code],
  });

  const gsz = Number(data?.gsz) || 0;
  const gszzl = Number(data?.gszzl) || 0;
  const dwjz = Number(data?.dwjz) || 0;

  return (
    <ChartCard onFresh={runGetEstimatedFromEastmoney}>
      <div className={styles.info}>
        <div className={styles.row}>
          <span>当前估值</span>
          <span className={Utils.GetValueColor(gszzl).textClass}>{gsz || '--'}</span>
        </div>
        <div className={styles.row}>
          <span>估算涨跌</span>
          <span className={Utils.GetValueColor(gszzl).textClass}>{gszzl ? `${Utils.Yang(gszzl)}%` : '--'}</span>
        </div>
        <div className={styles.row}>
          <span>单位净值</span>
          <span>{dwjz || '--'}</span>
        </div>
        <div className={styles.row}>
          <span>估值时间</span>
          <span>{data?.gztime || '--'}</span>
        </div>
      </div>
    </ChartCard>
  );
};

export default Estimate;
