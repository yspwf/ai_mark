import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

export default function KnowledgeGraphChart() {
  const isDark = false;

  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    tooltip: { formatter: '{b}' },
    series: [
      {
        type: 'graph',
        layout: 'force', // 核心：使用力导向布局
        roam: true,      // 允许鼠标拖拽和滚轮缩放
        symbolSize: 50,
        label: { show: true, position: 'right' },
        edgeSymbol: ['circle', 'arrow'], // 连线带有箭头
        force: {
          repulsion: 300, // 节点间的斥力因子
          edgeLength: [50, 150] // 连线的长度范围
        },
        data: [
          { name: '旗舰手机', symbolSize: 60, itemStyle: { color: '#3B82F6' } },
          { name: '降噪耳机', symbolSize: 40, itemStyle: { color: '#10B981' } },
          { name: '年轻极客', symbolSize: 70, itemStyle: { color: '#8B5CF6' } },
          { name: '商务精英', symbolSize: 50, itemStyle: { color: '#EC4899' } }
        ],
        links: [
          { source: '年轻极客', target: '旗舰手机', value: '偏好购买' },
          { source: '商务精英', target: '旗舰手机', value: '商务复购' },
          { source: '商务精英', target: '降噪耳机', value: '刚需配件' },
        ],
        lineStyle: { opacity: 0.7, width: 1.5, curveness: 0.1 } // 略微弯曲的连线
      }
    ]
  }), [isDark]);

  return (
    <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-800 flex flex-col h-full">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-zinc-100 mb-1">AI 知识图谱与实体关系 (Graph)</h3>
      <div className="flex-1 min-h-[300px]">
        <ReactECharts option={option} style={{ height: '100%', width: '100%' }} />
      </div>
    </div>
  );
}