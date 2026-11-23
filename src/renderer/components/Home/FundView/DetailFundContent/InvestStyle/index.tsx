import React from 'react';
import { useRequest } from 'ahooks';
import ChartCard from '@/components/Card/ChartCard';
import * as Services from '@lib/enh/services';
import styles from './index.module.css';

export interface InvestStyleProps {
  code: string;
}
const InvestStyle: React.FC<InvestStyleProps> = ({ code }) => {
  const { data, run } = useRequest(() => Services.Fund.GetInverstStyleFromEastmoney(code), {
    refreshDeps: [code],
  });

  const categories: string[] = data?.categories || [];
  const scores: number[] = data?.data || [];
  const list = categories.map((name, index) => ({ name, score: scores[index] }));

  return (
    <ChartCard onFresh={run}>
      <div className={styles.list}>
        <div className={styles.average}>
          综合评分 <strong>{data?.avr || '--'}</strong>
        </div>
        {list.length ? (
          list.map((item) => (
            <div key={item.name} className={styles.row}>
              <span className={styles.name}>{item.name}</span>
              <span className={styles.bar}>
                <i style={{ width: `${Math.min(Number(item.score) || 0, 100)}%` }} />
              </span>
              <span className={styles.score}>{item.score ?? '--'}</span>
            </div>
          ))
        ) : (
          <div className={styles.empty}>暂无数据</div>
        )}
      </div>
    </ChartCard>
  );
};

export default InvestStyle;
