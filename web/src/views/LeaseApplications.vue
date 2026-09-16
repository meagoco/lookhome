<template>
  <div class="page">
    <el-card shadow="never">
      <div class="bar">
        <div class="bar-left">
          <el-select v-model="status" style="width: 140px" @change="load">
            <el-option label="全部" value="all" />
            <el-option label="待处理" value="pending" />
            <el-option label="已通过" value="approved" />
            <el-option label="已拒绝" value="rejected" />
          </el-select>
        </div>
        <div class="bar-right">
          <span class="tip">租客在小程序「立即签约」提交的申请，审核通过后自动生成合同并绑定房源</span>
        </div>
      </div>

      <el-table :data="rows" v-loading="loading" style="width: 100%" empty-text="暂无签约申请">
        <el-table-column label="申请信息" min-width="200">
          <template #default="{ row }">
            <div class="main">{{ row.tenant_name }}（{{ row.tenant_phone }}）</div>
            <div class="sub">实名：{{ row.verify_status === 'approved' ? '已通过' : row.verify_status === 'pending' ? '待审核' : '未通过' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="房源" min-width="160">
          <template #default="{ row }">
            <div class="main">{{ row.property_name }} · {{ row.room_no }}</div>
            <div class="sub">{{ row.area }}㎡ ｜ 参考租金 {{ row.ref_rent }} 元/月</div>
          </template>
        </el-table-column>
        <el-table-column prop="expected_date" label="预计起租" width="110" />
        <el-table-column label="备注" min-width="140" prop="remark" show-overflow-tooltip />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'pending' ? 'warning' : row.status === 'approved' ? 'success' : 'info'">
              {{ row.status === 'pending' ? '待处理' : row.status === 'approved' ? '已通过' : '已拒绝' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="160" prop="created_at" />
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <template v-if="row.status === 'pending'">
              <el-button type="primary" size="small" @click="openApprove(row)">通过</el-button>
              <el-button type="danger" size="small" plain @click="openReject(row)">拒绝</el-button>
            </template>
            <template v-else>
              <span class="sub">{{ row.contract_id ? '已生成合同 #' + row.contract_id : row.reject_reason }}</span>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 通过：设定租期/月租/押金 -->
    <el-dialog v-model="approveDlg" title="通过签约 · 生成合同" width="520px">
      <el-alert type="info" :closable="false" title="生成合同后，房间将自动转为已租，并生成押金账单" style="margin-bottom: 12px" />
      <el-form label-width="100px">
        <el-form-item label="租客">
          <span>{{ approveRow?.tenant_name }}（{{ approveRow?.tenant_phone }}）</span>
        </el-form-item>
        <el-form-item label="房源">
          <span>{{ approveRow?.property_name }} · {{ approveRow?.room_no }}</span>
        </el-form-item>
        <el-form-item label="起租日期" required>
          <el-date-picker v-model="form.start_date" type="date" value-format="YYYY-MM-DD" placeholder="合同开始日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="到期日期" required>
          <el-date-picker v-model="form.end_date" type="date" value-format="YYYY-MM-DD" placeholder="合同结束日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="月租金（元）" required>
          <el-input-number v-model="form.monthly_rent" :min="0" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="押金（元）">
          <el-input-number v-model="form.deposit" :min="0" :precision="2" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="approveDlg = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="doApprove">确认通过</el-button>
      </template>
    </el-dialog>

    <!-- 拒绝 -->
    <el-dialog v-model="rejectDlg" title="拒绝签约申请" width="440px">
      <el-form label-width="80px">
        <el-form-item label="原因">
          <el-input v-model="rejectReason" type="textarea" :rows="3" placeholder="填写拒绝原因（可选），租客端可查看" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rejectDlg = false">取消</el-button>
        <el-button type="danger" :loading="saving" @click="doReject">确认拒绝</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';

const rows = ref([]);
const loading = ref(false);
const status = ref('all');
const approveDlg = ref(false);
const rejectDlg = ref(false);
const approveRow = ref(null);
const rejectRow = ref(null);
const rejectReason = ref('');
const saving = ref(false);
const form = reactive({ start_date: '', end_date: '', monthly_rent: 0, deposit: 0 });

async function load() {
  loading.value = true;
  try {
    rows.value = await api.get(`/lease-applications?status=${status.value}`);
  } catch { /* 拦截器提示 */ } finally { loading.value = false; }
}

function openApprove(row) {
  approveRow.value = row;
  form.start_date = row.expected_date || '';
  form.end_date = '';
  form.monthly_rent = row.ref_rent || 0;
  form.deposit = 0;
  approveDlg.value = true;
}
function openReject(row) { rejectRow.value = row; rejectReason.value = ''; rejectDlg.value = true; }

async function doApprove() {
  if (!form.start_date || !form.end_date) return ElMessage.warning('请填写合同起止日期');
  if (!(form.monthly_rent > 0)) return ElMessage.warning('请设定月租金');
  saving.value = true;
  try {
    await api.post(`/lease-applications/${approveRow.value.id}/approve`, { ...form });
    ElMessage.success('已通过，合同已生成');
    approveDlg.value = false;
    load();
  } catch { /* 拦截器提示 */ } finally { saving.value = false; }
}

async function doReject() {
  saving.value = true;
  try {
    await api.post(`/lease-applications/${rejectRow.value.id}/reject`, { reason: rejectReason.value });
    ElMessage.success('已拒绝');
    rejectDlg.value = false;
    load();
  } catch { /* 拦截器提示 */ } finally { saving.value = false; }
}

onMounted(load);
</script>

<style scoped>
.bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px; }
.bar-right { color: #8a97ad; font-size: 12px; }
.tip { color: #8a97ad; font-size: 12px; }
.main { font-weight: 500; color: #1b2a4a; }
.sub { color: #8a97ad; font-size: 12px; margin-top: 2px; }
</style>
