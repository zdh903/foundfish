import React from 'react';
import { useRequest } from 'ahooks';
import ChartCard from '@/components/Card/ChartCard';
import * as Services from '@lib/enh/services';
import * as Utils from '@/utils';
import styles from './index.module.css';

export interface EstimateProps {
  code: string;
}
const Estimate: React.FC<EstimateProps> = ({ code }) => {
  const { data = [], run } = useRequest(() => Services.Quotation.GetMainFundFromEastmoney(code), {
    refreshDeps: [code],
  });

  const list = (data as any[]).slice(0, 10);
  const max = Math.max(...list.map((item) => Math.abs(Number(item.mainNetInflow) || 0)), 1);

  return (
    <ChartCard onFresh={run} auto>
      <div className={styles.list}>
        {list.length ? (
          list.map((item) => {
            const net = Number(item.mainNetInflow) || 0;
            return (
              <div key={item.code} className={styles.row}>
                <span className={styles.name}>{item.name}</span>
                <span className={styles.bar}>
                  <i
                    className={net >= 0 ? styles.barUp : styles.barDown}
                    style={{ width: `${(Math.abs(net) / max) * 100}%` }}
                  />
                </span>
                <span className={Utils.GetValueColor(net).textClass}>{Utils.ConvertBigNum(net / 1e8, 2)}亿</span>
              </div>
            );
          })
        ) : (
          <div className={styles.empty}>暂无数据</div>
        )}
      </div>
    </ChartCard>
  );
};

export default Estimate;
