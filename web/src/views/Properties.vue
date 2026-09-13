<template>
  <div>
    <el-card shadow="never" style="border-radius:10px;margin-bottom:12px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <el-button type="primary" @click="openProp">添加项目</el-button>
        <el-button type="danger" plain @click="delProp" :disabled="!filterProp">删除项目</el-button>
        <el-select v-model="filterProp" placeholder="全部项目" clearable style="width:160px;" @change="load">
          <el-option v-for="p in props" :key="p.id" :label="p.name" :value="p.id" />
        </el-select>
        <el-select v-model="filterStatus" style="width:130px;" @change="load">
          <el-option label="全部状态" value="all" />
          <el-option label="空置" value="vacant" />
          <el-option label="已租" value="rented" />
          <el-option label="配置中" value="configuring" />
          <el-option label="关闭" value="closed" />
        </el-select>
        <el-button @click="openRoom" :disabled="!filterProp">添加房间</el-button>
        <el-tag v-for="s in roomStat" :key="s.status" style="margin-left:4px;">{{ statusName(s.status) }} {{ s.c }}</el-tag>
      </div>
    </el-card>

    <el-card shadow="never" style="border-radius:10px;">
      <el-table :data="rooms" size="small" stripe>
        <el-table-column prop="property_name" label="项目" width="140" />
        <el-table-column prop="room_no" label="房号" width="80" />
        <el-table-column prop="layout" label="户型" width="80" />
        <el-table-column prop="area" label="面积(㎡)" width="80" />
        <el-table-column label="参考租金" width="90"><template #default="{row}">{{ row.ref_rent ? row.ref_rent + '元' : '—' }}</template></el-table-column>
        <el-table-column label="垃圾费/月" width="90"><template #default="{row}">{{ row.garbage_fee ? row.garbage_fee + '元' : '—' }}</template></el-table-column>
        <el-table-column label="水/电单价" width="100"><template #default="{row}">{{ row.water_rate || 0 }}/{{ row.electric_rate || 0 }}</template></el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{row}"><el-tag size="small" :type="statusType(row.status)">{{ statusName(row.status) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="在租租客" min-width="100"><template #default="{row}">{{ row.tenant_name || '—' }}</template></el-table-column>
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{row}">
            <el-button link type="primary" @click="openHistory(row)">历史</el-button>
            <el-button link type="primary" @click="openRoom(row)">编辑</el-button>
            <el-button link type="danger" @click="delRoom(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="roomDlg" :title="roomForm.id ? '编辑房间' : '添加房间'" width="560px">
      <el-form :model="roomForm" label-width="90px" size="small">
        <el-form-item label="所属项目"><el-select v-model="roomForm.property_id" style="width:100%;"><el-option v-for="p in props" :key="p.id" :label="p.name" :value="p.id" /></el-select></el-form-item>
        <el-row :gutter="8">
          <el-col :span="12"><el-form-item label="房号"><el-input v-model="roomForm.room_no" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="户型"><el-input v-model="roomForm.layout" placeholder="主卧/次卧" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="朝向"><el-input v-model="roomForm.orientation" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="面积(㎡)"><el-input-number v-model="roomForm.area" :min="0" style="width:100%;" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="参考租金"><el-input-number v-model="roomForm.ref_rent" :min="0" style="width:100%;" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="垃圾费/月"><el-input-number v-model="roomForm.garbage_fee" :min="0" style="width:100%;" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="水费单价"><el-input-number v-model="roomForm.water_rate" :min="0" :precision="2" style="width:100%;" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="电费单价"><el-input-number v-model="roomForm.electric_rate" :min="0" :precision="2" style="width:100%;" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="水倍率"><el-input-number v-model="roomForm.water_factor" :min="0.1" :precision="2" style="width:100%;" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="电倍率"><el-input-number v-model="roomForm.electric_factor" :min="0.1" :precision="2" style="width:100%;" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="状态">
            <el-select v-model="roomForm.status" style="width:100%;">
              <el-option label="空置" value="vacant" /><el-option label="已租" value="rented" /><el-option label="配置中" value="configuring" /><el-option label="关闭" value="closed" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="可租日"><el-date-picker v-model="roomForm.available_date" type="date" value-format="YYYY-MM-DD" style="width:100%;" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="备注"><el-input v-model="roomForm.remark" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="roomDlg=false">取消</el-button><el-button type="primary" @click="saveRoom">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="propDlg" title="项目" width="420px">
      <el-form :model="propForm" label-width="70px" size="small">
        <el-form-item label="项目名"><el-input v-model="propForm.name" /></el-form-item>
        <el-form-item label="地址"><el-input v-model="propForm.address" /></el-form-item>
        <el-form-item label="类型"><el-select v-model="propForm.type" style="width:100%;"><el-option label="合/整租" value="centralized" /><el-option label="独栋" value="single" /></el-select></el-form-item>
        <el-form-item label="备注"><el-input v-model="propForm.remark" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="propDlg=false">取消</el-button><el-button type="primary" @click="saveProp">保存</el-button></template>
    </el-dialog>

    <!-- 房屋历史租赁查询 -->
    <el-dialog v-model="histDlg" :title="`历史租赁 · ${histRoom?.property_name} ${histRoom?.room_no}`" width="980px" top="4vh">
      <template v-if="histRoom">
        <el-descriptions :column="4" size="small" border style="margin-bottom:10px;">
          <el-descriptions-item label="当前状态">{{ statusName(histRoom.status) }}</el-descriptions-item>
          <el-descriptions-item label="水费单价">{{ histRoom.water_rate }} 元/吨</el-descriptions-item>
          <el-descriptions-item label="电费单价">{{ histRoom.electric_rate }} 元/度</el-descriptions-item>
          <el-descriptions-item label="垃圾费">{{ histRoom.garbage_fee }} 元/月</el-descriptions-item>
        </el-descriptions>
        <el-table :data="histRows" size="small" stripe>
          <el-table-column type="expand">
            <template #default="{row}">
              <div style="padding:4px 12px 10px;">
                <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">合同期内抄表：水 {{ row.meter_water.usage }} 吨 / {{ row.meter_water.amount }} 元；电 {{ row.meter_electric.usage }} 度 / {{ row.meter_electric.amount }} 元</div>
                <el-table :data="row.refunds" size="mini" border>
                  <el-table-column label="押金退还记录" min-width="260">
                    <template #default="{row:rf}">
                      <el-tag size="small" :type="rf.status==='done'?'success':(rf.status==='rejected'?'danger':'warning')">{{ rf.status==='done'?'已退':(rf.status==='rejected'?'已驳回':'待审批') }}</el-tag>
                      <span v-if="rf.amount" style="margin-left:6px;">{{ rf.amount }} 元</span>
                      <span v-if="rf.done_at" style="margin-left:6px;color:#9aa3b2;">{{ rf.done_at }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column prop="remark" label="备注" min-width="140" />
                  <template #empty><span style="color:#c0c6d0;font-size:12px;">该合同无押金退款记录</span></template>
                </el-table>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="80"><template #default="{row}"><el-tag size="small" :type="{active:'success',ended:'info',void:'danger'}[row.status]">{{ {active:'在租中',ended:'已退租',void:'作废'}[row.status] }}</el-tag></template></el-table-column>
          <el-table-column prop="tenant_name" label="租赁人" width="90" />
          <el-table-column prop="tenant_phone" label="手机号" width="120" />
          <el-table-column prop="tenant_id_card" label="身份证" width="190" />
          <el-table-column prop="duration_text" label="租赁时长" width="110" />
          <el-table-column label="月租金" width="90"><template #default="{row}">{{ row.monthly_rent }} 元</template></el-table-column>
          <el-table-column label="押金" width="80"><template #default="{row}">{{ row.deposit }} 元</template></el-table-column>
          <el-table-column label="押金退还" width="140"><template #default="{row}">
            <template v-if="row.refunds.length">
              <el-tag v-for="rf in row.refunds" :key="rf.id" size="small" :type="rf.status==='done'?'success':(rf.status==='rejected'?'danger':'warning')" style="margin:1px 2px;">{{ rf.status==='done'?'已退':(rf.status==='rejected'?'驳回':'待审') }}{{ rf.amount ? ' ' + rf.amount + '元' : '' }}</el-tag>
            </template>
            <span v-else style="color:#c0c6d0;">未退</span>
          </template></el-table-column>
          <el-table-column label="签订时间" width="150"><template #default="{row}">{{ row.created_at }}</template></el-table-column>
          <el-table-column label="退房/结束" width="150"><template #default="{row}">
            <span v-if="row.status==='active'">在租中（{{ row.end_date }}到期）</span>
            <span v-else-if="row.actual_end">{{ row.actual_end }}{{ row.status==='void' ? ' 作废' : '' }}</span>
            <span v-else>{{ row.end_date }}</span>
          </template></el-table-column>
        </el-table>
      </template>
      <template #footer><el-button @click="histDlg=false">关闭</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';
import { confirmDelete } from '../utils/confirmDelete';

const props = ref([]);
const rooms = ref([]);
const roomStat = ref([]);
const filterProp = ref(null);
const filterStatus = ref('all');
const roomDlg = ref(false);
const propDlg = ref(false);
const histDlg = ref(false);
const histRoom = ref(null);
const histRows = ref([]);
const emptyRoom = () => ({ id: null, property_id: filterProp.value, room_no: '', layout: '', orientation: '', area: 0, ref_rent: 0, garbage_fee: 0, water_rate: 0, electric_rate: 0, water_factor: 1, electric_factor: 1, status: 'vacant', available_date: '', remark: '' });
const roomForm = reactive(emptyRoom());
const propForm = reactive({ id: null, name: '', address: '', type: 'centralized', remark: '' });

const statusName = s => ({ vacant: '空置', rented: '已租', configuring: '配置中', closed: '关闭' }[s] || s);
const statusType = s => ({ vacant: 'info', rented: 'success', configuring: 'warning', closed: 'danger' }[s] || 'info');

async function load() {
  props.value = await api.get('/properties');
  const data = await api.get('/rooms', { params: { property_id: filterProp.value || undefined, status: filterStatus.value } });
  rooms.value = data.rows;
  roomStat.value = data.stat;
}
function openProp() { Object.assign(propForm, { id: null, name: '', address: '', type: 'centralized', remark: '' }); propDlg.value = true; }
async function saveProp() {
  if (!propForm.name) return ElMessage.warning('项目名必填');
  if (propForm.id) await api.put(`/properties/${propForm.id}`, propForm);
  else await api.post('/properties', propForm);
  propDlg.value = false; load(); ElMessage.success('已保存');
}
function openRoom(row) {
  Object.assign(roomForm, row ? { ...row } : emptyRoom());
  roomDlg.value = true;
}
async function saveRoom() {
  if (!roomForm.property_id || !roomForm.room_no) return ElMessage.warning('项目与房号必填');
  // 前置检查：房间有在租租客（正常合同）时，状态完全锁定，不允许任何变更
  if (roomForm.id && roomForm.status) {
    const cur = rooms.value.find(x => x.id === roomForm.id);
    if (cur && cur.tenant_name && cur.status !== roomForm.status) return ElMessage.warning('该房间存在正常（在租）合同，合同生效期间房间状态不可变更');
  }
  if (roomForm.id) await api.put(`/rooms/${roomForm.id}`, roomForm);
  else await api.post('/rooms', roomForm);
  roomDlg.value = false; load(); ElMessage.success('已保存');
}
async function delRoom(row) {
  await confirmDelete(`房间「${row.property_name}·${row.room_no}」`);
  await api.delete(`/rooms/${row.id}`);
  load(); ElMessage.success('已删除');
}
async function delProp() {
  const p = props.value.find(x => x.id === filterProp.value);
  if (!p) return ElMessage.warning('请先选择要删除的项目');
  await confirmDelete(`项目「${p.name}」`);
  await api.delete(`/properties/${p.id}`);
  filterProp.value = null; load(); ElMessage.success('项目已删除');
}

async function openHistory(row) {
  const data = await api.get(`/rooms/${row.id}/history`);
  histRoom.value = data.room;
  histRows.value = data.history;
  histDlg.value = true;
}

onMounted(load);
</script>
