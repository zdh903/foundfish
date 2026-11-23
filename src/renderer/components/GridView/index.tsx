import React from 'react';
import clsx from 'clsx';
import ArrowLine from '@/components/ArrowLine';
import { useAppSelector } from '@/utils/hooks';
import * as Utils from '@/utils';
import styles from './index.module.css';

interface ViewItem {
  name: string;
  value: number;
  zdd: number;
  zdf: number;
  code: string; // 唯一标识符
}

interface GridViewProps {
  list: ViewItem[];
  onDetail: (code: string) => void;
}

const GridView: React.FC<GridViewProps> = (props) => {
  const { list } = props;
  const { conciseSetting } = useAppSelector((state) => state.setting.systemSetting);

  return (
    <div className={clsx(styles.content)}>
      {list.map((item) => {
        const zddColor = Utils.GetValueColor(item.zdd);
        const zdfColor = Utils.GetValueColor(item.zdf);
        return (
          <div
            key={item.code}
            className={clsx(styles.item, zdfColor.bgClass)}
            onClick={() => props.onDetail(item.code)}
          >
            <span className={styles.name}>{item.name}</span>
            <span className={clsx(zdfColor.textClass, styles.change)}>
              {Utils.Yang(item.zdf)}%
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default GridView;
