<template>
  <div>
    <el-card shadow="never" style="border-radius:10px;margin-bottom:12px;">
      <div style="display:flex;gap:8px;">
        <el-button type="primary" @click="dlg=true">发起退押金</el-button>
      </div>
    </el-card>
    <el-card shadow="never" style="border-radius:10px;">
      <el-table :data="rows" size="small" stripe>
        <el-table-column prop="created_at" label="时间" width="160" />
        <el-table-column prop="tenant_name" label="租客" width="90" />
        <el-table-column label="房源" min-width="130"><template #default="{row}">{{ row.property_name }} · {{ row.room_no }}</template></el-table-column>
        <el-table-column label="金额" width="100"><template #default="{row}"><span style="color:#16a34a;font-weight:600;">-{{ row.amount }}元</span></template></el-table-column>
        <el-table-column label="方式" width="120"><template #default="{row}"><el-tag size="small" :type="row.refund_mode==='wechat'?'primary':'success'">{{ row.refund_mode==='wechat'?'微信原路退回':'手工退款' }}</el-tag></template></el-table-column>
        <el-table-column prop="status" label="状态" width="80"><template #default="{row}">{{ row.status==='done'?'已完成':'处理中' }}</template></el-table-column>
        <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
      </el-table>
    </el-card>

    <el-dialog v-model="dlg" title="退押金（全额/部分）" width="480px">
      <el-form :model="form" label-width="90px" size="small">
        <el-form-item label="合同">
          <el-select v-model="form.contract_id" filterable style="width:100%;" placeholder="选择在租合同" @change="onChange">
            <el-option v-for="c in activeContracts" :key="c.id" :label="`${c.tenant_name} · ${c.property_name}·${c.room_no}（押金${c.deposit}）`" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="退款金额"><el-input-number v-model="form.amount" :min="0.01" :max="maxAmount" style="width:100%;" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" placeholder="如：扣水电欠费/维修费" /></el-form-item>
        <el-alert v-if="hint" :title="hint" type="info" :closable="false" />
      </el-form>
      <template #footer><el-button @click="dlg=false">取消</el-button><el-button type="primary" @click="save">确认退款</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';

const rows = ref([]);
const activeContracts = ref([]);
const dlg = ref(false);
const maxAmount = ref(0);
const hint = ref('');
const form = reactive({ contract_id: null, amount: 0, remark: '' });

async function load() {
  rows.value = await api.get('/refunds');
  activeContracts.value = await api.get('/contracts', { params: { status: 'active' } });
}
function onChange(id) {
  const c = activeContracts.value.find(x => x.id === id);
  if (c) { maxAmount.value = c.deposit; form.amount = c.deposit; hint.value = c.deposit ? `该合同押金 ${c.deposit} 元，全额退可留空扣款说明` : '该合同未设押金'; }
}
async function save() {
  if (!form.contract_id || !(form.amount > 0)) return ElMessage.warning('请选择合同并输入金额');
  const data = await api.post('/refunds', form);
  dlg.value = false; load();
  ElMessage.success(data.refund_mode === 'wechat' ? '已发起微信原路退回' : '已记录手工退款，请线下转账后在收款记录中登记');
}
onMounted(load);
</script>
