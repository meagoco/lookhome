<template>
  <div>
    <el-card shadow="never" style="border-radius:10px;margin-bottom:12px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <el-button type="primary" @click="openAdd">创建合同（绑定房源）</el-button>
        <el-select v-model="filterStatus" style="width:140px;" @change="load">
          <el-option label="全部" value="all" />
          <el-option label="在租中" value="active" />
          <el-option label="已退租" value="ended" />
          <el-option label="作废" value="void" />
        </el-select>
        <el-input v-model="kw" placeholder="租客/房号" clearable style="width:180px;" @keyup.enter="load" />
        <el-button @click="load">查询</el-button>
      </div>
    </el-card>

    <el-card shadow="never" style="border-radius:10px;">
      <el-table :data="list" size="small" stripe>
        <el-table-column prop="tenant_name" label="租客" width="90" />
        <el-table-column label="房源" min-width="130"><template #default="{row}">{{ row.property_name }} · {{ row.room_no }}</template></el-table-column>
        <el-table-column label="租期" width="200"><template #default="{row}">{{ row.start_date }} ~ {{ row.end_date }}</template></el-table-column>
        <el-table-column label="月租金" width="90"><template #default="{row}">{{ row.monthly_rent }}元</template></el-table-column>
        <el-table-column label="押金" width="80"><template #default="{row}">{{ row.deposit }}元</template></el-table-column>
        <el-table-column label="欠费" width="90"><template #default="{row}"><span v-if="row.unpaid_amount" style="color:#ef4444;font-weight:600;">{{ row.unpaid_amount }}元</span><span v-else style="color:#9ca3af;">—</span></template></el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{row}"><el-tag size="small" :type="{active:'success',ended:'info',void:'danger'}[row.status]">{{ {active:'在租中',ended:'已退租',void:'作废'}[row.status] }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{row}">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" v-if="row.status==='active'" @click="checkout(row)">退房</el-button>
            <el-button link type="warning" v-if="row.status==='active'" @click="voidC(row)">作废</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dlg" :title="editing ? '编辑合同（改价/延期等）' : '创建合同 · 绑定房源（租金/押金手动设定）'" width="640px">
      <el-form :model="form" label-width="100px" size="small">
        <el-alert v-if="editing" :title="'租客：' + editInfo.tenant_name + '　房源：' + editInfo.property_name + ' · ' + editInfo.room_no + '　状态：' + {active:'在租中',ended:'已退租',void:'作废'}[editInfo.status]" type="info" :closable="false" style="margin-bottom:10px;" />
        <el-row :gutter="8">
          <el-col :span="12">
            <el-form-item label="租客">
              <el-select v-model="form.tenant_id" filterable style="width:100%;" placeholder="选择已通过验证的租客" :disabled="editing">
                <el-option v-for="t in approvedTenants" :key="t.id" :label="t.name + (t.phone ? ' / ' + t.phone : '')" :value="t.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="空置房间">
              <el-select v-model="form.room_id" filterable style="width:100%;" placeholder="选择空置房间" @change="onRoomChange" :disabled="editing">
                <el-option v-for="r in vacantRooms" :key="r.id" :label="r.property_name + ' · ' + r.room_no" :value="r.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item label="开始日期"><el-date-picker v-model="form.start_date" type="date" value-format="YYYY-MM-DD" style="width:100%;" :disabled="editing" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="结束日期"><el-date-picker v-model="form.end_date" type="date" value-format="YYYY-MM-DD" style="width:100%;" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="月租金(元)"><el-input-number v-model="form.monthly_rent" :min="1" style="width:100%;" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="押金(元)"><el-input-number v-model="form.deposit" :min="0" style="width:100%;" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="收租日"><el-input-number v-model="form.pay_day" :min="1" :max="31" style="width:100%;" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="收租周期"><el-select v-model="form.rent_cycle" style="width:100%;"><el-option label="每月" value="monthly" /></el-select></el-form-item></el-col>
        </el-row>
        <el-form-item label="备注"><el-input v-model="form.remark" /></el-form-item>
        <el-alert v-if="roomHint" :title="roomHint" type="info" :closable="false" style="margin-top:4px;" />
      </el-form>
      <template #footer><el-button @click="dlg=false">取消</el-button><el-button type="primary" @click="save">{{ editing ? '保存修改' : '确认绑定' }}</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';

const list = ref([]);
const approvedTenants = ref([]);
const vacantRooms = ref([]);
const filterStatus = ref('all');
const kw = ref('');
const dlg = ref(false);
const editing = ref(false);
const editInfo = ref({});
const roomHint = ref('');
const emptyForm = () => ({ tenant_id: null, room_id: null, start_date: '', end_date: '', monthly_rent: 0, deposit: 0, pay_day: 1, rent_cycle: 'monthly', remark: '' });
const form = reactive(emptyForm());

async function load() {
  list.value = await api.get('/contracts', { params: { status: filterStatus.value, kw: kw.value || undefined } });
}
async function loadOptions() {
  approvedTenants.value = await api.get('/tenants', { params: { verify_status: 'approved' } });
  const r = await api.get('/rooms', { params: { status: 'vacant' } });
  vacantRooms.value = r.rows;
}
function openAdd() { Object.assign(form, emptyForm()); roomHint.value = ''; editing.value = false; dlg.value = true; }
function openEdit(row) {
  editInfo.value = row;
  Object.assign(form, {
    tenant_id: row.tenant_id, room_id: row.room_id, start_date: row.start_date, end_date: row.end_date,
    monthly_rent: row.monthly_rent, deposit: row.deposit, pay_day: row.pay_day, rent_cycle: row.rent_cycle, remark: row.remark || ''
  });
  roomHint.value = '';
  editing.value = true; dlg.value = true;
}
function onRoomChange(id) {
  const r = vacantRooms.value.find(x => x.id === id);
  roomHint.value = r ? `该房间垃圾费 ${r.garbage_fee || 0} 元/月，水价 ${r.water_rate || 0}，电价 ${r.electric_rate || 0}，将计入账单` : '';
}
async function save() {
  if (editing.value) {
    if (!(form.monthly_rent > 0)) return ElMessage.warning('请设定月租金');
    await api.put(`/contracts/${editInfo.value.id}`, form);
    dlg.value = false; load(); ElMessage.success('已保存（后续账单将按新价格生成）');
    return;
  }
  if (!form.tenant_id || !form.room_id) return ElMessage.warning('请选择租客和房间');
  if (!form.start_date || !form.end_date) return ElMessage.warning('请选择合同起止日期');
  if (!(form.monthly_rent > 0)) return ElMessage.warning('请设定月租金');
  const data = await api.post('/contracts', form);
  dlg.value = false; load(); ElMessage.success(`绑定成功（合同#${data.id}），押金账单已生成`);
}
async function checkout(row) {
  let v = '';
  try {
    const r = await ElMessageBox.prompt(
      `确认「${row.tenant_name}」退房（${row.property_name}·${row.room_no}）？\n退房后：合同解除、房间 ${row.room_no} 自动改为空置，此操作不可恢复。\n请输入「退房」两字确认：`,
      '退房确认',
      { confirmButtonText: '确认退房', inputPlaceholder: '输入：退房' }
    );
    v = (r.value || '').trim();
  } catch { return; }
  if (v !== '退房') return ElMessage.warning('已取消：需输入「退房」两字才能执行');
  await api.post(`/contracts/${row.id}/checkout`, { remark: '前台退房' });
  load(); ElMessage.success('已退房：合同已解除，房间已改为空置，记得处理押金退款');
}
async function voidC(row) {
  let v = '';
  try {
    const r = await ElMessageBox.prompt(
      `确认作废「${row.tenant_name}」的合同（${row.property_name}·${row.room_no}）？\n作废后：合同标记作废、房间 ${row.room_no} 自动改为空置，此操作不可恢复。\n请输入「作废」两字确认：`,
      '作废确认',
      { confirmButtonText: '确认作废', inputPlaceholder: '输入：作废' }
    );
    v = (r.value || '').trim();
  } catch { return; }
  if (v !== '作废') return ElMessage.warning('已取消：需输入「作废」两字才能执行');
  await api.post(`/contracts/${row.id}/void`);
  load(); ElMessage.success('已作废：合同已作废，房间已改为空置');
}
onMounted(() => { load(); loadOptions(); });
</script>
