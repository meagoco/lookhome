<template>
  <div>
    <el-card shadow="never" style="border-radius:10px;margin-bottom:12px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <el-button type="primary" @click="genDlg=true">生成月度账单</el-button>
        <el-button @click="readDlg=true">抄表</el-button>
        <el-select v-model="filterProp" style="width:150px;" @change="loadStats">
          <el-option label="全部项目" value="all" />
          <el-option v-for="p in props_" :key="p.id" :label="p.name" :value="String(p.id)" />
        </el-select>
        <el-radio-group v-model="periodMode" size="small" @change="onPeriodMode">
          <el-radio-button value="month">本月</el-radio-button>
          <el-radio-button value="year">本年</el-radio-button>
          <el-radio-button value="last12">近12月</el-radio-button>
          <el-radio-button value="custom">自定义</el-radio-button>
        </el-radio-group>
        <el-date-picker v-if="periodMode==='custom'" v-model="customRange" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" style="width:240px;" @change="loadStats" />
        <el-date-picker v-model="filterPeriod" type="month" value-format="YYYY-MM" placeholder="账单周期" style="width:140px;" @change="load" />
        <el-select v-model="filterStatus" style="width:120px;" @change="load">
          <el-option label="全部状态" value="all" />
          <el-option label="待缴" value="unpaid" />
          <el-option label="已缴" value="paid" />
          <el-option label="逾期" value="overdue" />
          <el-option label="作废" value="void" />
        </el-select>
        <el-select v-model="filterType" style="width:120px;" @change="load">
          <el-option label="全部类型" value="all" />
          <el-option label="月度账单" value="monthly" />
          <el-option label="押金" value="deposit" />
        </el-select>
        <el-select v-model="filterRemind" style="width:120px;" @change="load">
          <el-option label="全部提醒状态" value="all" />
          <el-option label="已提醒" value="reminded" />
          <el-option label="未提醒" value="unreminded" />
        </el-select>
        <el-input v-model="kw" placeholder="租客/房号" clearable style="width:160px;" @keyup.enter="load" />
        <el-button @click="load">查询</el-button>
        <el-button type="warning" plain :disabled="!selRows.length" @click="batchRemind">批量提醒({{ selRows.length }})</el-button>
      </div>
    </el-card>

    <!-- 统计面板 -->
    <el-card v-if="stats" shadow="never" style="border-radius:10px;margin-bottom:12px;">
      <template #header>
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <b>费用统计（{{ periodText }}<template v-if="filterProp!=='all'"> · {{ propName }}</template>）</b>
          <span style="font-size:12px;color:#9aa3b2;">应收口径：非作废账单；实收口径：已确认收款</span>
        </div>
      </template>
      <el-row :gutter="10">
        <el-col :span="4" v-for="c in feeCards" :key="c.label">
          <div style="background:#f7f9fc;border-radius:8px;padding:10px 12px;">
            <div style="font-size:12px;color:#8a94a6;">{{ c.label }}</div>
            <div :style="{fontSize:'20px',fontWeight:700,marginTop:4,color:c.highlight?'#2f54eb':'#1f2937'}">{{ c.value }}</div>
          </div>
        </el-col>
      </el-row>
      <div ref="chartBox" style="height:260px;margin-top:12px;"></div>
    </el-card>


    <el-card shadow="never" style="border-radius:10px;">
      <el-table :data="rows" size="small" stripe @selection-change="selRows = $event">
        <el-table-column type="selection" width="38" :selectable="row => row.status==='unpaid' || row.status==='overdue'" />
        <el-table-column prop="period" label="周期" width="80" />
        <el-table-column label="类型" width="70"><template #default="{row}"><el-tag size="small" :type="row.bill_type==='deposit'?'warning':'primary'">{{ row.bill_type==='deposit'?'押金':'月度' }}</el-tag></template></el-table-column>
        <el-table-column label="租客" width="90"><template #default="{row}">{{ row.tenant_name }}</template></el-table-column>
        <el-table-column label="房源" min-width="120"><template #default="{row}">{{ row.property_name }}·{{ row.room_no }}</template></el-table-column>
        <el-table-column prop="title" label="摘要" min-width="150" show-overflow-tooltip />
        <el-table-column label="金额" width="90"><template #default="{row}">{{ row.total }}元</template></el-table-column>
        <el-table-column label="已收" width="80"><template #default="{row}">{{ row.paid_amount || 0 }}元</template></el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{row}"><el-tag size="small" :type="{unpaid:'warning',paid:'success',overdue:'danger',void:'info'}[row.status]">{{ {unpaid:'待缴',paid:'已缴',overdue:'逾期',void:'作废'}[row.status] }}</el-tag></template>
        </el-table-column>
        <el-table-column label="提醒" width="140">
          <template #default="{row}">
            <template v-if="row.reminder && row.reminder.reminded">
              <el-tag size="small" type="success">已提醒</el-tag>
              <div style="font-size:11px;color:#909399;line-height:1.4;margin-top:2px;">
                {{ row.reminder.kind==='auto'?'自动':'手动' }} · {{ (row.reminder.created_at||'').slice(0,16) }}
              </div>
            </template>
            <span v-else style="color:#c0c4cc;font-size:12px;">未提醒</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{row}">
            <el-button link type="primary" @click="openDetail(row)">明细</el-button>
            <el-button link type="success" v-if="row.status==='unpaid'||row.status==='overdue'" @click="pay(row)">手工收款</el-button>
            <el-button link type="danger" v-if="row.status!=='void'" @click="voidBill(row)">作废</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="genDlg" title="生成月度账单（在租合同：租金+垃圾费+已抄水电）" width="460px">
      <el-form label-width="90px" size="small">
        <el-form-item label="账单周期"><el-date-picker v-model="genPeriod" type="month" value-format="YYYY-MM" style="width:100%;" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="genDlg=false">取消</el-button><el-button type="primary" @click="generate">生成</el-button></template>
    </el-dialog>

    <el-dialog v-model="readDlg" title="抄表（水/电）" width="460px">
      <el-form :model="readForm" label-width="90px" size="small">
        <el-form-item label="房间"><el-select v-model="readForm.room_id" filterable style="width:100%;" placeholder="选择在租房间"><el-option v-for="r in rentedRooms" :key="r.id" :label="r.property_name + ' · ' + r.room_no" :value="r.id" /></el-select></el-form-item>
        <el-form-item label="表类型"><el-radio-group v-model="readForm.meter_type"><el-radio value="water">水表</el-radio><el-radio value="electric">电表</el-radio></el-radio-group></el-form-item>
        <el-form-item label="周期"><el-date-picker v-model="readForm.period" type="month" value-format="YYYY-MM" style="width:100%;" /></el-form-item>
        <el-form-item label="本月读数"><el-input-number v-model="readForm.curr_reading" :min="0" style="width:100%;" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="readDlg=false">取消</el-button><el-button type="primary" @click="saveReading">保存抄表</el-button></template>
    </el-dialog>

    <el-dialog v-model="detailDlg" title="账单明细" width="560px">
      <template v-if="detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="周期">{{ detail.bill.period }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ {unpaid:'待缴',paid:'已缴',overdue:'逾期',void:'作废'}[detail.bill.status] }}</el-descriptions-item>
          <el-descriptions-item label="租客">{{ detail.bill.tenant_name }}</el-descriptions-item>
          <el-descriptions-item label="房源">{{ detail.bill.property_name }}·{{ detail.bill.room_no }}</el-descriptions-item>
        </el-descriptions>
        <el-table :data="detail.items" size="small" style="margin-top:10px;">
          <el-table-column prop="fee_name" label="项目" />
          <el-table-column prop="quantity" label="用量"><template #default="{row}">{{ row.quantity ?? '—' }}</template></el-table-column>
          <el-table-column prop="rate" label="单价"><template #default="{row}">{{ row.rate ?? '—' }}</template></el-table-column>
          <el-table-column label="金额" width="90"><template #default="{row}">{{ row.amount }}元</template></el-table-column>
        </el-table>
        <div style="text-align:right;font-weight:700;margin-top:8px;">合计：{{ detail.bill.total }} 元</div>
        <el-divider>收款记录</el-divider>
        <div v-for="p in detail.payments" :key="p.id" style="font-size:13px;padding:4px 0;color:#374151;">
          {{ p.created_at }} ｜ {{ p.pay_mode==='wechat'?'微信支付':'手工收款' }} ｜ {{ p.amount }} 元 ｜ {{ {pending:'待确认',confirmed:'已确认',rejected:'已驳回'}[p.confirm_status] }}
        </div>
        <el-empty v-if="!detail.payments.length" description="暂无收款" :image-size="50" />
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);
import api from '../api';

const rows = ref([]);
const rentedRooms = ref([]);
const props_ = ref([]);
const filterProp = ref('all');
const periodMode = ref('month');
const customRange = ref([]);
const stats = ref(null);
const chartBox = ref(null);
let chart = null;
const filterPeriod = ref('');
const filterStatus = ref('all');
const filterType = ref('all');
const filterRemind = ref('all');
const kw = ref('');
const genDlg = ref(false);
const readDlg = ref(false);
const detailDlg = ref(false);
const detail = ref(null);
const genPeriod = ref('');
const readForm = reactive({ room_id: null, meter_type: 'water', period: '', curr_reading: 0 });
const selRows = ref([]);

const fmt = n => Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const propName = computed(() => (props_.value.find(p => String(p.id) === filterProp.value) || {}).name || '');
const periodText = computed(() => {
  if (!stats.value?.range) return '';
  return `${stats.value.range.start} ~ ${stats.value.range.end}`;
});
const feeCards = computed(() => {
  const map = {}; for (const f of stats.value?.fees || []) map[f.code] = f.v;
  const defs = [
    { label: '合计', code: null, total: true, highlight: true },
    { label: '租金', code: 'rent' },
    { label: '水费', code: 'water' },
    { label: '电费', code: 'electric' },
    { label: '垃圾费', code: 'garbage' },
    { label: '押金', code: 'deposit' }
  ];
  const rest = (stats.value?.fees || []).filter(f => !['rent','water','electric','garbage','deposit'].includes(f.code)).reduce((s, f) => s + Number(f.v), 0);
  return defs.map(d => ({
    label: d.label,
    value: d.total ? fmt(stats.value?.fee_total) : fmt(map[d.code] || 0),
    highlight: d.highlight
  })).concat(rest > 0 ? [{ label: '其他', value: fmt(rest) }] : []);
});

function calcRange() {
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth();
  const d = n => { const t = new Date(n); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`; };
  const ym = (yy, mm) => { const t = new Date(yy, mm, 1); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-01`; };
  switch (periodMode.value) {
    case 'month': { const last = new Date(y, mo+1, 0).getDate(); return [`${y}-${String(mo+1).padStart(2,'0')}-01`, `${y}-${String(mo+1).padStart(2,'0')}-${last}`]; }
    case 'year': return [`${y}-01-01`, `${y}-12-31`];
    case 'last12': return [ym(y, mo-11), d(now)];
    case 'custom': return customRange.value.length === 2 ? customRange.value : null;
  }
}
function onPeriodMode() {
  if (periodMode.value !== 'custom') { customRange.value = []; loadStats(); }
}
function renderChart() {
  if (!chartBox.value) return;
  if (!chart) chart = echarts.init(chartBox.value);
  const d = stats.value;
  const keys = [...new Set([...(d.trend || []).map(t => t.period), ...(d.income || []).map(i => i.ym)])].sort();
  chart.setOption({
    tooltip: { trigger: 'axis', valueFormatter: v => fmt(v) + ' 元' },
    legend: { data: ['应收', '实收'], top: 0 },
    grid: { left: 60, right: 20, top: 32, bottom: 28 },
    xAxis: { type: 'category', data: keys },
    yAxis: { type: 'value' },
    series: [
      { name: '应收', type: 'bar', barMaxWidth: 26, itemStyle: { color: '#2f54eb', borderRadius: [3,3,0,0] }, data: keys.map(k => Number((d.trend.find(t => t.period === k) || {}).v || 0)) },
      { name: '实收', type: 'line', smooth: true, itemStyle: { color: '#52c41a' }, data: keys.map(k => Number((d.income.find(i => i.ym === k) || {}).v || 0)) }
    ]
  }, true);
}
function resizeChart() { chart?.resize(); }

async function loadStats() {
  const range = calcRange();
  if (!range) return;
  const data = await api.get('/bills/stats', { params: { property_id: filterProp.value, start: range[0], end: range[1] } });
  stats.value = { ...data, range: { start: range[0], end: range[1] } };
  await nextTick(); // 等待 v-if 挂载 chartBox
  renderChart();
}
async function load() {
  const data = await api.get('/bills', { params: { period: filterPeriod.value || undefined, status: filterStatus.value, bill_type: filterType.value, remind: filterRemind.value, kw: kw.value || undefined } });
  rows.value = data.rows;
}
async function loadRooms() {
  const r = await api.get('/rooms', { params: { status: 'rented' } });
  rentedRooms.value = r.rows;
}
async function loadProps() {
  props_.value = await api.get('/properties');
}
async function generate() {
  if (!genPeriod.value) return ElMessage.warning('请选择周期');
  const data = await api.post('/bills/generate', { period: genPeriod.value });
  genDlg.value = false; load(); loadStats(); ElMessage.success(`已生成 ${data.created} 张账单`);
}
async function saveReading() {
  if (!readForm.room_id || !readForm.period) return ElMessage.warning('请选择房间和周期');
  const data = await api.post('/bills/readings', readForm);
  readDlg.value = false; ElMessage.success(`抄表成功：用量 ${data.usage}，金额 ${data.amount} 元（记得生成账单）`);
}
async function pay(row) {
  const { value } = await ElMessageBox.prompt(`输入 ${row.tenant_name} 实收金额（应收 ${row.total} 元）`, '手工确认收款', { inputValue: String(row.total), inputPattern: /^\d+(\.\d+)?$/, inputErrorMessage: '请输入金额' });
  await api.post(`/bills/${row.id}/pay-manual`, { amount: Number(value) });
  load(); loadStats(); ElMessage.success('已确认收款');
}
async function voidBill(row) {
  await ElMessageBox.confirm('确认作废该账单？', '作废');
  await api.post(`/bills/${row.id}/void`);
  load(); loadStats(); ElMessage.success('已作废');
}

// 手动批量提醒：对选中的未缴/逾期账单的房客发起缴费提醒（小程序可收到）
async function batchRemind() {
  const ids = selRows.value.map(x => x.id);
  if (!ids.length) return ElMessage.warning('请先勾选未缴/逾期的账单');
  try {
    await ElMessageBox.confirm(
      `确认对选中的 ${ids.length} 笔账单的房客发起缴费提醒？\n提醒将下发至租客小程序，点开可直接跳转账单页缴费。`,
      '批量缴费提醒',
      { type: 'warning', confirmButtonText: '确认提醒', cancelButtonText: '取消' }
    );
  } catch { return; }
  const r = await api.post('/reminders/manual', { bill_ids: ids });
  ElMessage.success(`已下发 ${r.created} 条提醒${r.skipped ? `（${r.skipped} 条已提醒过跳过）` : ''}${r.denied ? `（${r.denied} 条无权）` : ''}`);
  load();
}
async function openDetail(row) {
  detail.value = await api.get(`/bills/${row.id}`);
  detailDlg.value = true;
}
onMounted(() => {
  load(); loadRooms(); loadProps(); loadStats();
  window.addEventListener('resize', resizeChart);
});
onBeforeUnmount(() => { window.removeEventListener('resize', resizeChart); chart?.dispose(); chart = null; });
</script>
