<template>
  <div>
    <el-card shadow="never" style="border-radius:10px;margin-bottom:12px;">
      <div style="display:flex;gap:8px;">
        <el-button type="primary" @click="dlg=true">发起退押金</el-button>
        <el-alert v-if="pendingCount" :title="`有 ${pendingCount} 笔租客退押金申请待审批（同意后自动解除合同并将房间改为空置）`" type="warning" :closable="false" style="flex:1;min-width:240px;" />
      </div>
    </el-card>
    <el-card shadow="never" style="border-radius:10px;">
      <el-table :data="rows" size="small" stripe>
        <el-table-column prop="created_at" label="时间" width="150" />
        <el-table-column label="来源" width="90"><template #default="{row}"><el-tag size="small" :type="row.source==='tenant'?'warning':'info'">{{ row.source==='tenant'?'租客申请':'后台发起' }}</el-tag></template></el-table-column>
        <el-table-column prop="tenant_name" label="租客" width="90" />
        <el-table-column label="房源" min-width="130"><template #default="{row}">{{ row.property_name }} · {{ row.room_no }}</template></el-table-column>
        <el-table-column label="金额" width="100"><template #default="{row}"><span style="color:#16a34a;font-weight:600;">-{{ row.amount }}元</span></template></el-table-column>
        <el-table-column label="方式" width="110"><template #default="{row}"><el-tag size="small" :type="row.refund_mode==='wechat'?'primary':'success'">{{ row.refund_mode==='wechat'?'微信原路退回':'手工退款' }}</el-tag></template></el-table-column>
        <el-table-column label="状态" width="90"><template #default="{row}">
          <el-tag size="small" :type="row.status==='done'?'success':(row.status==='rejected'?'danger':'warning')">{{ row.status==='done'?'已退押金':(row.status==='rejected'?'已驳回':'待审批') }}</el-tag>
        </template></el-table-column>
        <el-table-column prop="apply_remark" label="申请说明" min-width="110" show-overflow-tooltip />
        <el-table-column prop="remark" label="备注" min-width="110" show-overflow-tooltip />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{row}">
            <template v-if="row.status==='pending'">
              <el-button link type="primary" size="small" @click="approve(row)">同意</el-button>
              <el-button link type="danger" size="small" @click="reject(row)">驳回</el-button>
            </template>
            <span v-else style="color:#c0c6d0;font-size:12px;">已处理</span>
          </template>
        </el-table-column>
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
        <el-alert v-if="hint" :title="hint" type="info" :closable="false" style="margin-bottom:8px;" />
        <el-alert title="确认后：押金记为已退，合同将自动解除（已退租），房间自动改为空置；租客小程序将无法再申请退押金。" type="warning" :closable="false" />
      </el-form>
      <template #footer><el-button @click="dlg=false">取消</el-button><el-button type="primary" @click="save">确认退款</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';

const rows = ref([]);
const activeContracts = ref([]);
const dlg = ref(false);
const maxAmount = ref(0);
const hint = ref('');
const form = reactive({ contract_id: null, amount: 0, remark: '' });
const pendingCount = computed(() => rows.value.filter(x => x.status === 'pending').length);

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
  if (data.refund_mode === 'wechat') {
    ElMessage.success(data.auto_ended ? '已发起微信原路退回：合同已自动退房，房间已改为空置' : '已发起微信原路退回');
  } else {
    ElMessage.success(data.auto_ended ? '已记录手工退款：合同已自动退房，房间已改为空置，请线下转账后登记收款' : '已记录手工退款，请线下转账后在收款记录中登记');
  }
}

async function approve(row) {
  try {
    await ElMessageBox.confirm(
      `确认同意「${row.tenant_name}」的退押金申请（${row.amount} 元）？\n同意后：押金记为已退，对应合同自动解除，房间 ${row.property_name}·${row.room_no} 改为空置。`,
      '同意退押金',
      { type: 'warning', confirmButtonText: '同意并解约', cancelButtonText: '取消' }
    );
  } catch { return; }
  await api.post(`/refunds/${row.id}/approve`, {});
  ElMessage.success('已同意退押金：合同已解除，房间已改为空置');
  load();
}

async function reject(row) {
  let reason = '';
  try {
    const r = await ElMessageBox.prompt(`驳回「${row.tenant_name}」的退押金申请（${row.amount} 元），请填写驳回原因：`, '驳回申请', { confirmButtonText: '确认驳回', inputPlaceholder: '驳回原因（必填）' });
    reason = r.value.trim();
  } catch { return; }
  if (!reason) return ElMessage.warning('请填写驳回原因');
  await api.post(`/refunds/${row.id}/reject`, { reason });
  ElMessage.success('已驳回该退押金申请');
  load();
}

onMounted(load);</script>
