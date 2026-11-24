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
  { name: '两天', type: 2, code: 2 },
  { name: '三天', type: 3, code: 3 },
  { name: '四天', type: 4, code: 4 },
  { name: '五天', type: 5, code: 5 },
];
const Trend: React.FC<PerformanceProps> = ({ code, zs = 0, name }) => {
  const { ref: chartRef, chartInstance } = useResizeEchart(CONST.DEFAULT.ECHARTS_SCALE);
  const [trend, setTrendType] = useState(trendTypeList[0]);
  const { data: result = [], run: runGetTrendFromEastmoney } = useRequest(
    () => Services.Zindex.GetTrendFromEastmoney(code, String(trend.code)),
    {
      refreshDeps: [code, trend.code, zs],
      ready: !!chartInstance,
      cacheKey: Utils.GenerateRequestKey('Zindex.GetTrendFromEastmoney', [code, trend.code]),
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
            // 多日分时标签很长，只显示月日+时间的核心部分，并按间隔抽样避免重叠
            formatter: (value: string, index: number) => {
              if (result.length > 300 && index % Math.ceil(result.length / 8) !== 0) return '';
              return value.length > 11 ? value.slice(5) : value;
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
          min: (value: any) => Math.min(value.min, zs),
          max: (value: any) => Math.max(value.max, zs),
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
              color: Utils.GetValueColor(Number(result[result.length - 1]?.price) - zs).color,
            },
            markPoint: {
              symbol: 'pin',
              symbolSize: 30,
              data: [
                { type: 'max', label: { fontSize: 10 } },
                { type: 'min', label: { fontSize: 10 } },
              ],
            },
            markLine: {
              symbol: 'none',
              label: {
                position: 'insideEndBottom',
                fontSize: 10,
              },
              data: [
                {
                  name: '昨收',
                  yAxis: zs,
                },
              ],
            },
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
