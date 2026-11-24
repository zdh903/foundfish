import React, { useState } from 'react';
import { useRequest } from 'ahooks';

import ChartCard from '@/components/Card/ChartCard';
import ExportTitleBar from '@/components/ExportTitleBar';
import TypeSelection from '@/components/TypeSelection';
import { useResizeEchart, useRenderEcharts } from '@/utils/hooks';
import * as CONST from '@/constants';
import * as Services from '@lib/enh/services';
import * as Utils from '@/utils';
import styles from './index.module.css';

export interface PerformanceProps {
  code: string;
  zs: number;
  name?: string;
}
const trendTypeList = [
  { name: '一天', type: 1, code: 1 },
  { name: '7天', type: 7, code: 7 },
  { name: '1月', type: 30, code: 30 },
  { name: '3月', type: 90, code: 90 },
  { name: '6月', type: 180, code: 180 },
  { name: '1年', type: 365, code: 365 },
];
const Trend: React.FC<PerformanceProps> = ({ code, zs = 0, name }) => {
  const { ref: chartRef, chartInstance } = useResizeEchart(CONST.DEFAULT.ECHARTS_SCALE);
  const [trend, setTrendType] = useState(trendTypeList[0]);
  const { data: result = [], run: runGetTrendFromEastmoney } = useRequest(
    () => Services.Zindex.GetRangeTrendFromEastmoney(code, trend.code),
    {
      refreshDeps: [code, trend.code, zs],
      ready: !!chartInstance,
      cacheKey: Utils.GenerateRequestKey('Zindex.GetRangeTrendFromEastmoney', [code, trend.code]),
    }
  );

  useRenderEcharts(
    () => {
      chartInstance?.setOption({
        title: {
          text: '',
        },
        tooltip: {
          trigger: 'axis',
        },
        grid: {
          left: 0,
          right: 0,
          bottom: 0,
          top: 25,
          outerBoundsMode: 'same',
          outerBoundsContain: 'axisLabel',
        },
        xAxis: {
          type: 'category',
          data: result.map(({ time }) => time) || [],
          boundaryGap: false,
          axisLabel: {
            fontSize: 10,
            // 分时标签含时间、日K仅日期；统一截取月日，并按间隔抽样避免重叠
            formatter: (value: string, index: number) => {
              const step = Math.max(1, Math.ceil(result.length / 8));
              if (result.length > 12 && index % step !== 0) return '';
              return value.length > 10 ? value.slice(5, 16) : value.slice(5);
            },
          },
        },
        yAxis: {
          type: 'value',
          axisLabel: {
            formatter: `{value}`,
            fontSize: 10,
          },
          scale: true,
          splitLine: {
            lineStyle: {
              color: 'var(--border-color)',
            },
          },
          // 仅一天分时以昨收为基准；长周期走势按自身数据范围自适应
          min: trend.code === 1 ? (value: any) => Math.min(value.min, zs) : undefined,
          max: trend.code === 1 ? (value: any) => Math.max(value.max, zs) : undefined,
        },
        dataZoom: [
          {
            type: 'inside',
            // 多日分时点数可达近千，限制最小缩放窗口为总量的 5%，保证可拖动查看
            minValueSpan: Math.max(1, Math.floor(result.length * 0.05)),
            zoomOnMouseWheel: true,
            moveOnMouseMove: true,
          },
        ],
        series: [
          {
            data: result.map(({ time, price }) => [time, price]),
            type: 'line',
            name: '价格',
            showSymbol: false,
            symbol: 'none',
            lineStyle: {
              width: 1,
              // 一天用「最新价-昨收」定色；长周期用「末日-首日」区间涨跌定色
              color: Utils.GetValueColor(
                trend.code === 1
                  ? Number(result[result.length - 1]?.price) - zs
                  : Number(result[result.length - 1]?.price) - Number(result[0]?.price)
              ).color,
            },
            markPoint: {
              symbol: 'pin',
              symbolSize: 30,
              data: [
                { type: 'max', label: { fontSize: 10 } },
                { type: 'min', label: { fontSize: 10 } },
              ],
            },
            markLine:
              trend.code === 1
                ? {
                    symbol: 'none',
                    label: {
                      position: 'insideEndBottom',
                      fontSize: 10,
                    },
                    data: [{ name: '昨收', yAxis: zs }],
                  }
                : undefined,
          },
        ],
      });
    },
    chartInstance,
    [result]
  );

  return (
    <ChartCard onFresh={runGetTrendFromEastmoney} TitleBar={<ExportTitleBar name={name} data={result} />}>
      <div className={styles.content}>
        <div ref={chartRef} style={{ width: '100%' }} />
        <TypeSelection types={trendTypeList} activeType={trend.type} onSelected={setTrendType} flex />
      </div>
    </ChartCard>
  );
};

export default Trend;
