<template>
  <el-card shadow="never" style="border-radius:10px;">
    <div style="margin-bottom:12px;">
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
    </el-table>
  </el-card>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import api from '../api';

const rows = ref([]);
const filterStatus = ref('all');
async function load() {
  rows.value = await api.get('/payments', { params: { confirm_status: filterStatus.value } });
}
onMounted(load);
</script>
