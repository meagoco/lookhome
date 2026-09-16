<template>
  <el-card shadow="never" style="border-radius:10px;">
    <div style="margin-bottom:12px;display:flex;gap:10px;flex-wrap:wrap;">
      <el-select v-model="filterMonth" style="width:150px;" @change="load">
        <el-option label="全部月份" value="all" />
        <el-option v-for="m in monthOptions" :key="m" :label="m" :value="m" />
      </el-select>
      <el-select v-model="filterStatus" style="width:140px;" @change="load">
        <el-option label="全部" value="all" />
        <el-option label="已确认" value="confirmed" />
        <el-option label="待确认" value="pending" />
        <el-option label="已驳回" value="rejected" />
      </el-select>
    </div>
    <el-table :data="rows" size="small" stripe>
      <el-table-column prop="created_at" label="时间" width="160" />
      <el-table-column prop="tenant_name" label="租客" width="90" />
      <el-table-column label="房源" min-width="130"><template #default="{row}">{{ row.room_no }}</template></el-table-column>
      <el-table-column prop="bill_title" label="账单" min-width="160" show-overflow-tooltip />
      <el-table-column label="金额" width="90"><template #default="{row}">{{ row.amount }}元</template></el-table-column>
      <el-table-column label="方式" width="100"><template #default="{row}"><el-tag size="small" :type="row.pay_mode==='wechat'?'primary':'success'">{{ row.pay_mode==='wechat'?'微信支付':'手工收款' }}</el-tag></template></el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{row}"><el-tag size="small" :type="{confirmed:'success',pending:'warning',rejected:'danger'}[row.confirm_status]">{{ {confirmed:'已确认',pending:'待确认',rejected:'已驳回'}[row.confirm_status] }}</el-tag></template>
      </el-table-column>
      <el-table-column label="经手人" width="90"><template #default="{row}">{{ row.confirmed_by_name || '—' }}</template></el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{row}">
          <template v-if="row.confirm_status==='pending'">
            <el-button size="small" type="success" link @click="confirmPay(row)">确认收款</el-button>
            <el-button size="small" type="danger" link @click="rejectPay(row)">驳回</el-button>
          </template>
          <span v-else style="color:#a8b0c0;font-size:12px">—</span>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';

const rows = ref([]);
const filterStatus = ref('all');
const filterMonth = ref('all');
const monthOptions = (() => {
  const arr = [];
  const d = new Date();
  for (let i = 0; i < 12; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    arr.push(m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0'));
  }
  return arr;
})();
async function load() {
  rows.value = await api.get('/payments', { params: { confirm_status: filterStatus.value, month: filterMonth.value } });
}
async function confirmPay(row) {
  await ElMessageBox.confirm(`确认「${row.tenant_name}」${row.bill_title}（${row.amount}元）已到账？确认后账单自动记为已缴。`, '确认收款', { type: 'warning', confirmButtonText: '确认收款', cancelButtonText: '取消' });
  await api.post(`/payments/${row.id}/confirm`);
  ElMessage.success('已确认收款，账单已入账');
  load();
}
async function rejectPay(row) {
  await ElMessageBox.confirm(`驳回「${row.tenant_name}」的这笔收款记录？`, '驳回收款', { type: 'warning', confirmButtonText: '驳回', cancelButtonText: '取消' });
  await api.post(`/payments/${row.id}/reject`);
  ElMessage.success('已驳回');
  load();
}
onMounted(load);
</script>
