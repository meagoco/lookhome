<template>
  <div>
    <el-card shadow="never" style="border-radius:10px;margin-bottom:12px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <el-button type="primary" @click="openAdd">新增租客</el-button>
        <el-select v-model="filterVerify" style="width:150px;" @change="load">
          <el-option label="全部状态" value="all" />
          <el-option label="待验证" value="pending" />
          <el-option label="已通过" value="approved" />
          <el-option label="已驳回" value="rejected" />
        </el-select>
        <el-input v-model="kw" placeholder="姓名/手机号" clearable style="width:180px;" @keyup.enter="load" />
        <el-button @click="load">查询</el-button>
      </div>
    </el-card>

    <el-card shadow="never" style="border-radius:10px;">
      <el-table :data="list" size="small" stripe>
        <el-table-column prop="name" label="姓名" width="100" />
        <el-table-column prop="phone" label="手机号" width="130" />
        <el-table-column label="身份证" min-width="150"><template #default="{row}">{{ row.id_card_enc ? maskId(row.id_card_enc) : '—' }}</template></el-table-column>
        <el-table-column label="验证状态" width="100">
          <template #default="{row}">
            <el-tag size="small" :type="{ pending: 'warning', approved: 'success', rejected: 'danger' }[row.verify_status] || 'info'">{{ verifyName(row.verify_status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="绑定房间" min-width="140"><template #default="{row}">{{ row.property_name ? row.property_name + ' · ' + row.room_no : '未绑定' }}</template></el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{row}">
            <el-button link type="warning" v-if="row.verify_status==='pending'" @click="verify(row,'approved')">通过</el-button>
            <el-button link type="danger" v-if="row.verify_status==='pending'" @click="verify(row,'rejected')">驳回</el-button>
            <el-button link type="primary" @click="openDetail(row)">详情</el-button>
            <el-button link type="danger" @click="delTenant(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="addDlg" title="新增租客（后台录入）" width="480px">
      <el-form :model="form" label-width="80px" size="small">
        <el-form-item label="姓名"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="手机号"><el-input v-model="form.phone" /></el-form-item>
        <el-form-item label="身份证号"><el-input v-model="form.id_card" placeholder="录入后加密存储" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="addDlg=false">取消</el-button><el-button type="primary" @click="saveAdd">保存并直接通过</el-button></template>
    </el-dialog>

    <el-drawer v-model="detailDlg" title="租客详情" size="420px">
      <el-descriptions v-if="current" :column="1" border size="small">
        <el-descriptions-item label="姓名">{{ current.name }}</el-descriptions-item>
        <el-descriptions-item label="手机号">{{ current.phone || '—' }}</el-descriptions-item>
        <el-descriptions-item label="身份证">{{ current.id_card_enc ? maskId(current.id_card_enc) : '—' }}</el-descriptions-item>
        <el-descriptions-item label="验证状态">{{ verifyName(current.verify_status) }}</el-descriptions-item>
        <el-descriptions-item label="注册时间">{{ current.created_at }}</el-descriptions-item>
      </el-descriptions>
      <el-divider>合同记录</el-divider>
      <div v-for="c in current?.contracts || []" :key="c.id" style="border:1px solid #eef1f6;border-radius:8px;padding:10px;margin-bottom:8px;font-size:13px;">
        <div>{{ c.property_name }} · {{ c.room_no }}</div>
        <div style="color:#6b7280;">{{ c.start_date }} ~ {{ c.end_date }} ｜ 月租 {{ c.monthly_rent }} 元 ｜ 押金 {{ c.deposit }} 元</div>
        <el-tag size="small" :type="c.status==='active'?'success':'info'">{{ {active:'在租',ended:'已退租',void:'作废'}[c.status] }}</el-tag>
      </div>
      <el-empty v-if="!current?.contracts?.length" description="暂无合同" :image-size="60" />
    </el-drawer>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';
import { confirmDelete } from '../utils/confirmDelete';

const list = ref([]);
const filterVerify = ref('all');
const kw = ref('');
const addDlg = ref(false);
const detailDlg = ref(false);
const current = ref(null);
const form = reactive({ name: '', phone: '', id_card: '', remark: '' });

const verifyName = s => ({ pending: '待验证', approved: '已通过', rejected: '已驳回' }[s] || s);
const maskId = id => id.length >= 14 ? id.slice(0, 6) + '********' + id.slice(-4) : id;

async function load() {
  list.value = await api.get('/tenants', { params: { verify_status: filterVerify.value, kw: kw.value || undefined } });
}
function openAdd() { Object.assign(form, { name: '', phone: '', id_card: '', remark: '' }); addDlg.value = true; }
async function saveAdd() {
  if (!form.name) return ElMessage.warning('姓名必填');
  await api.post('/tenants', { ...form, verify_status: 'approved' });
  addDlg.value = false; load(); ElMessage.success('已添加');
}
async function verify(row, action) {
  await ElMessageBox.confirm(action === 'approved' ? `确认通过 ${row.name} 的身份验证？` : `确认驳回 ${row.name} 的身份验证？`, '身份验证');
  await api.post(`/tenants/${row.id}/verify`, { action });
  load(); ElMessage.success(action === 'approved' ? '已通过' : '已驳回');
}
async function openDetail(row) {
  const data = await api.get(`/tenants/${row.id}`);
  current.value = data.tenant;
  current.value.contracts = data.contracts;
  detailDlg.value = true;
}
async function delTenant(row) {
  // 前置检查：存在正常（在租）合同则禁止删除
  const data = await api.get(`/tenants/${row.id}`);
  const his = data.contracts || [];
  const active = his.filter(c => c.status === 'active').length;
  if (active > 0) return ElMessage.warning(`该租客存在 ${active} 份正常（在租）合同，请先退房或作废合同后再删除`);
  const extra = his.length ? `（将同时清理 ${his.length} 份历史合同及其账单记录）` : '';
  await confirmDelete(`租客「${row.name}」${extra}`);
  const r = await api.delete(`/tenants/${row.id}`);
  load();
  ElMessage.success(r.cleaned?.contracts ? `已删除（清理合同${r.cleaned.contracts}份、账单${r.cleaned.bills}条）` : '已删除');
}
onMounted(load);
</script>
