<template>
  <div>
    <el-card shadow="never" style="border-radius:10px;margin-bottom:12px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <b>租赁历史查询</b>
        <span style="color:#909399;font-size:12px;">按租客姓名 / 身份证号 / 手机号搜索全部历史租赁记录（含在租、已退租、作废）</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px;">
        <el-input v-model="f.name" placeholder="租客姓名" clearable style="width:150px;" @keyup.enter="search" />
        <el-input v-model="f.id_card" placeholder="身份证号" clearable style="width:200px;" @keyup.enter="search" />
        <el-input v-model="f.phone" placeholder="手机号" clearable style="width:150px;" @keyup.enter="search" />
        <el-button type="primary" @click="search">查询</el-button>
        <el-button @click="reset">重置</el-button>
      </div>
    </el-card>

    <el-card shadow="never" style="border-radius:10px;">
      <el-table :data="rows" size="small" stripe>
        <el-table-column label="租客" width="100">
          <template #default="{row}">
            <div>{{ row.tenant_name }}</div>
            <div style="font-size:11px;color:#909399;">{{ row.tenant_phone }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="tenant_id_card" label="身份证号" min-width="170" show-overflow-tooltip />
        <el-table-column label="房源" min-width="130">
          <template #default="{row}">{{ row.property_name }}·{{ row.room_no }}</template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{row}">
            <el-tag size="small" :type="{active:'success',ended:'info',void:'danger'}[row.status]">{{ {active:'在租',ended:'已退租',void:'作废'}[row.status] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="租赁时长" width="110">
          <template #default="{row}">{{ row.status==='active' ? '在租中' : dur(row) }}</template>
        </el-table-column>
        <el-table-column label="月租金" width="90">
          <template #default="{row}">{{ row.monthly_rent }}元</template>
        </el-table-column>
        <el-table-column label="押金" width="80">
          <template #default="{row}">{{ row.deposit }}元</template>
        </el-table-column>
        <el-table-column label="押金退还" width="110">
          <template #default="{row}">
            <el-tag v-if="row.refund_count" size="small" type="success">已退 {{ row.refunded_amount }}元</el-tag>
            <span v-else style="color:#c0c4cc;font-size:12px;">未退</span>
          </template>
        </el-table-column>
        <el-table-column label="签订时间" width="100">
          <template #default="{row}">{{ (row.start_date||'').slice(0,10) }}</template>
        </el-table-column>
        <el-table-column label="退房/结束" width="100">
          <template #default="{row}">{{ (row.end_date||'').slice(0,10) }}</template>
        </el-table-column>
      </el-table>
      <div v-if="!rows.length" style="text-align:center;color:#c0c4cc;padding:30px 0;">{{ searched ? '未找到匹配的租赁记录' : '请输入姓名 / 身份证号 / 手机号后点击查询' }}</div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import api from '../api.js';

const f = reactive({ name: '', id_card: '', phone: '' });
const rows = ref([]);
const searched = ref(false);

function dur(row) {
  const s = new Date(row.start_date);
  const e = row.status === 'active' ? new Date() : new Date(row.end_date || row.ended_at || Date.now());
  if (isNaN(s) || isNaN(e) || e < s) return '—';
  let m = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  let d = e.getDate() - s.getDate();
  if (d < 0) { m--; d += new Date(e.getFullYear(), e.getMonth(), 0).getDate(); }
  const parts = [];
  if (m > 0) parts.push(`${m}个月`);
  if (d > 0) parts.push(`${d}天`);
  return parts.join('零') || '1天内';
}

async function search() {
  rows.value = await api.get('/contracts/history-search', { params: { name: f.name || undefined, id_card: f.id_card || undefined, phone: f.phone || undefined } });
  searched.value = true;
}
function reset() {
  f.name = ''; f.id_card = ''; f.phone = '';
  rows.value = []; searched.value = false;
}
</script>
