import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

export default function UserRadarChart() {
  const isDark = false; // 实际可接入 next-themes

  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    tooltip: {},
    legend: {
      data: ['核心高净值用户', '高潜社交活跃用户'],
      bottom: 0,
      textStyle: { color: isDark ? '#A1A1AA' : '#4B5563' }
    },
    radar: {
      indicator: [
        { name: '消费力 (Spends)', max: 100 },
        { name: '活跃度 (Activity)', max: 100 },
        { name: '忠诚度 (Loyalty)', max: 100 },
        { name: '转化率 (Conversion)', max: 100 },
        { name: '社交影响力 (Social)', max: 100 }
      ],
      splitArea: {
        areaStyle: {
          color: isDark ? ['#27272A', '#18181B'] : ['#F9FAFB', '#F3F4F6'],
        }
      }
    },
    series: [{
      name: '用户群体多维画像',
      type: 'radar',
      data: [
        {
          value: [85, 90, 80, 75, 60],
          name: '核心高净值用户',
          itemStyle: { color: '#3B82F6' }, // 蓝色
          areaStyle: { opacity: 0.3 }
        },
        {
          value: [50, 60, 45, 40, 85],
          name: '高潜社交活跃用户',
          itemStyle: { color: '#10B981' }, // 绿色
          areaStyle: { opacity: 0.3 }
        }
      ]
    }]
  }), [isDark]);

  return (
    <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-800 flex flex-col h-full">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-zinc-100 mb-1">群体多维特征画像 (Radar)</h3>
      <div className="flex-1 min-h-[300px]">
        <ReactECharts option={option} style={{ height: '100%', width: '100%' }} />
      </div>
    </div>
  );
}