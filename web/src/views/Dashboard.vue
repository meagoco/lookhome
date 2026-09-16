<template>
  <div>
    <el-card shadow="never" style="border-radius:10px;margin-bottom:12px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <span style="font-size:13px;color:#6b7280;">统计周期：</span>
        <el-radio-group v-model="periodMode" size="small" @change="onPeriodMode">
          <el-radio-button value="month">本月</el-radio-button>
          <el-radio-button value="half">近6月</el-radio-button>
          <el-radio-button value="year12">近12月</el-radio-button>
          <el-radio-button value="cal">今年</el-radio-button>
          <el-radio-button value="custom">自定义</el-radio-button>
        </el-radio-group>
        <el-date-picker v-if="periodMode==='custom'" v-model="customRange" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" style="width:240px;" @change="load" />
        <span v-if="rangeText" style="font-size:12px;color:#9aa3b2;">{{ rangeText }}</span>
      </div>
    </el-card>

    <el-row :gutter="12">
      <el-col :span="6" v-for="c in cards" :key="c.label">
        <el-card shadow="never" style="border-radius:10px;">
          <div style="font-size:13px;color:#8a94a6;">{{ c.label }}</div>
          <div style="font-size:26px;font-weight:700;color:#1f2937;margin-top:6px;">{{ c.value }}</div>
          <div style="font-size:12px;color:#b0b8c4;">{{ c.sub }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="12" style="margin-top:12px;">
      <el-col :span="14">
        <el-card shadow="never" style="border-radius:10px;">
          <template #header><b>收入趋势（实收，元）</b></template>
          <div ref="chartBox" style="height:240px;"></div>
        </el-card>
      </el-col>
      <el-col :span="10">
        <el-card shadow="never" style="border-radius:10px;">
          <template #header><b>房源概况</b></template>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="总房间">{{ dash.rooms?.total || 0 }}</el-descriptions-item>
            <el-descriptions-item label="出租率">{{ dash.rooms?.rent_rate || 0 }}%</el-descriptions-item>
            <el-descriptions-item label="已租">{{ dash.rooms?.rented || 0 }}</el-descriptions-item>
            <el-descriptions-item label="空置">{{ dash.rooms?.vacant || 0 }}</el-descriptions-item>
          </el-descriptions>
          <div style="margin-top:14px;font-size:13px;color:#4b5563;line-height:2;">
            <div>待验证租客：<el-tag size="small" type="warning" v-if="dash.tenant_pending">{{ dash.tenant_pending }}</el-tag><span v-else>0</span></div>
            <div>在租押金未缴：<span style="color:#f59e0b;font-weight:600;">{{ fmt(dash.deposit_owed) }} 元</span></div>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);
import api from '../api';

const dash = reactive({});
const periodMode = ref('half');
const customRange = ref([]);
const rangeText = ref('');
const chartBox = ref(null);
let chart = null;

const fmt = n => Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cards = computed(() => [
  { label: '周期应收', value: fmt(dash.outstanding), sub: '待缴+逾期（按账单周期）' },
  { label: '周期实收', value: fmt(dash.collected), sub: '已确认收款' },
  { label: '逾期未缴', value: fmt(dash.overdue), sub: '超期账单' },
  { label: '待验证租客', value: dash.tenant_pending ?? '-', sub: '需后台审核' }
]);

function calcRange() {
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth();
  const d = n => `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
  const ym = (yy, mm) => { const t = new Date(yy, mm, 1); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-01`; };
  switch (periodMode.value) {
    case 'month': { const last = new Date(y, mo+1, 0).getDate(); return [`${y}-${String(mo+1).padStart(2,'0')}-01`, `${y}-${String(mo+1).padStart(2,'0')}-${last}`]; }
    case 'half': return [ym(y, mo-5), d(now)];
    case 'year12': return [ym(y, mo-11), d(now)];
    case 'cal': return [`${y}-01-01`, `${y}-12-31`];
    case 'custom': return customRange.value.length === 2 ? customRange.value : null;
  }
}
function onPeriodMode() {
  if (periodMode.value !== 'custom') { customRange.value = []; load(); }
}
function renderChart() {
  if (!chartBox.value) return;
  if (!chart) chart = echarts.init(chartBox.value);
  const tr = dash.trend || [];
  chart.setOption({
    tooltip: { trigger: 'axis', valueFormatter: v => fmt(v) + ' 元' },
    grid: { left: 60, right: 20, top: 24, bottom: 28 },
    xAxis: { type: 'category', data: tr.map(t => t.ym) },
    yAxis: { type: 'value' },
    series: [{
      name: '实收', type: 'bar', barMaxWidth: 30, itemStyle: { color: '#2f54eb', borderRadius: [3,3,0,0] },
      data: tr.map(t => Number(t.v || 0))
    }]
  }, true);
}
function resizeChart() { chart?.resize(); }

async function load() {
  const range = calcRange();
  if (!range) return;
  Object.assign(dash, await api.get('/dashboard', { params: { start: range[0], end: range[1] } }));
  rangeText.value = `${range[0]} ~ ${range[1]}`;
  renderChart();
}
onMounted(() => {
  load();
  window.addEventListener('resize', resizeChart);
});
onBeforeUnmount(() => { window.removeEventListener('resize', resizeChart); chart?.dispose(); chart = null; });
</script>
