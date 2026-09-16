<template>
  <div>
    <!-- 顶部说明 -->
    <el-card shadow="never" style="border-radius:10px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <b>微信支付配置</b>
        <span style="color:#909399;font-size:12px;">创建支付模板并勾选绑定项目：一个或多个项目共用同一微信支付商户号；一个项目只能绑定一个支付配置。</span>
        <el-button type="primary" size="small" @click="openCreate">新建支付配置</el-button>
      </div>
    </el-card>

    <el-alert type="info" :closable="false" style="margin-bottom:12px;"
      title="租客端小程序统一使用「系统设置-微信小程序」中的全局 AppID；支付配置中的 AppID 留空即跟随全局。未绑定任何支付配置的项目，收款时使用「系统设置-默认支付配置」。" />

    <el-card shadow="never" style="border-radius:10px;">
      <el-table :data="rows" size="small" v-loading="loading">
        <el-table-column prop="name" label="配置名称" min-width="140" />
        <el-table-column label="商户号" width="150"><template #default="{row}">{{ row.mchid }}</template></el-table-column>
        <el-table-column label="证书序列号" width="130"><template #default="{row}">{{ (row.serial_no || '').slice(0, 10) }}{{ (row.serial_no||'').length > 10 ? '…' : '' }}</template></el-table-column>
        <el-table-column label="绑定项目" min-width="180">
          <template #default="{row}">
            <template v-if="row.property_ids.length">
              <el-tag v-for="p in boundProjects(row)" :key="p.id" size="small" style="margin:2px 4px 2px 0;">{{ p.name }}</el-tag>
            </template>
            <span v-else style="color:#909399;font-size:12px;">未绑定（用默认配置）</span>
          </template>
        </el-table-column>
        <el-table-column label="创建人" width="140">
          <template #default="{row}">
            <el-tag size="small" :type="row.scope==='global' ? 'danger' : 'primary'">{{ row.scope==='global' ? '主管理员' : (row.created_by_name || '操作员') }}</el-tag>
            <el-tag v-if="row.shared" size="small" type="warning" style="margin-left:4px;">共享</el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="myRole==='admin'" label="授权操作员" min-width="150">
          <template #default="{row}">
            <template v-if="row.operator_ids.length">
              <el-tag v-for="op in operators.filter(o => row.operator_ids.includes(o.id))" :key="op.id" size="small" style="margin:2px 4px 2px 0;" type="success">{{ op.display_name || op.username }}</el-tag>
            </template>
            <span v-else style="color:#909399;font-size:12px;">未授权</span>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="150" />
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{row}">
            <template v-if="myRole==='admin' || !row.shared">
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button link type="danger" @click="del(row)">删除</el-button>
            </template>
            <span v-else style="color:#909399;font-size:12px;">主管理员分配，只读</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新建/编辑弹窗 -->
    <el-dialog v-model="dlg" :title="form.id ? '编辑支付配置' : '新建支付配置'" width="560px" :close-on-click-modal="false">
      <el-form label-width="120px" size="small">
        <el-form-item label="配置名称" required>
          <el-input v-model="form.name" placeholder="如：A公寓微信支付 / 我的商户" />
        </el-form-item>
        <el-form-item label="商户号" required>
          <el-input v-model="form.mchid" placeholder="微信支付商户号（mchid）" />
        </el-form-item>
        <el-form-item label="APIv3密钥">
          <el-input v-model="form.apiv3_key" type="password" show-password :placeholder="form.apiv3_key_set ? '已配置（留空不修改）' : '商户平台 APIv3 密钥'" />
        </el-form-item>
        <el-form-item label="证书序列号">
          <el-input v-model="form.serial_no" placeholder="API 证书序列号" />
        </el-form-item>
        <el-form-item label="商户私钥">
          <el-input v-model="form.private_key" type="textarea" :rows="3" :placeholder="form.private_key_set ? '已配置（留空不修改）' : '粘贴商户 API 证书私钥（-----BEGIN PRIVATE KEY----- …）'" />
        </el-form-item>
        <el-form-item label="支付回调地址">
          <el-input v-model="form.notify_url" placeholder="如 https://域名/api/pay/notify（留空则用系统默认）" />
        </el-form-item>
        <el-form-item label="小程序 AppID">
          <el-input v-model="form.appid" placeholder="留空 = 跟随全局小程序 AppID" />
        </el-form-item>
        <el-form-item label="绑定项目">
          <el-alert type="info" :closable="false" style="margin-bottom:8px;"
            title="勾选一个或多个项目共用本支付配置。已被其他配置绑定的项目不可重复勾选；操作员仅能绑定自己有权限的项目。" />
          <el-checkbox-group v-model="form.property_ids" style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto;">
            <el-checkbox v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}（{{ p.room_count }}间）</el-checkbox>
          </el-checkbox-group>
          <div v-if="!projects.length" style="color:#909399;font-size:12px;">暂无可用项目</div>
        </el-form-item>
        <el-form-item v-if="myRole==='admin'" label="授权给操作员">
          <el-alert type="info" :closable="false" style="margin-bottom:8px;"
            title="勾选的操作员可在其「支付配置」页看到并使用本配置（只读，不可修改）；管理员可随时调整授权。" />
          <el-checkbox-group v-model="form.operator_ids" style="display:flex;flex-direction:column;gap:6px;max-height:180px;overflow-y:auto;">
            <el-checkbox v-for="op in operators" :key="op.id" :value="op.id">{{ op.display_name || op.username }}（{{ op.username }}）</el-checkbox>
          </el-checkbox-group>
          <div v-if="!operators.length" style="color:#909399;font-size:12px;">暂无可授权操作员（可在系统设置-操作员管理中创建）</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg=false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';
import { confirmDelete } from '../utils/confirmDelete';

const rows = ref([]);
const projects = ref([]);
const operators = ref([]);
const loading = ref(false);
const dlg = ref(false);
const saving = ref(false);
const myRole = localStorage.getItem('lk_role') || 'admin';
const blank = { id: null, name: '', mchid: '', apiv3_key: '', serial_no: '', private_key: '', notify_url: '', appid: '', property_ids: [], operator_ids: [], apiv3_key_set: false, private_key_set: false };
const form = reactive({ ...blank });

function boundProjects(row) {
  return projects.value.filter((p) => row.property_ids.includes(p.id));
}

async function load() {
  loading.value = true;
  try {
    rows.value = await api.get('/pay-configs');
    const ps = await api.get('/properties');
    projects.value = Array.isArray(ps) ? ps : (ps.rows || []);
    if (myRole === 'admin') {
      const us = await api.get('/admin-users');
      operators.value = (Array.isArray(us) ? us : []).filter((u) => u.role === 'operator' && u.status === 1);
    }
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  Object.assign(form, JSON.parse(JSON.stringify(blank)));
  dlg.value = true;
}

async function openEdit(row) {
  const d = await api.get(`/pay-configs/${row.id}`);
  Object.assign(form, {
    id: d.id, name: d.name, mchid: d.mchid, apiv3_key: '', serial_no: d.serial_no || '',
    private_key: '', notify_url: d.notify_url || '', appid: d.appid || '',
    property_ids: d.property_ids || [], operator_ids: d.operator_ids || [],
    apiv3_key_set: d.apiv3_key_set, private_key_set: d.private_key_set
  });
  dlg.value = true;
}

async function save() {
  if (!form.name || !form.mchid) return ElMessage.warning('配置名称与商户号必填');
  saving.value = true;
  try {
    const body = {
      name: form.name, mchid: form.mchid, serial_no: form.serial_no,
      notify_url: form.notify_url, appid: form.appid, property_ids: form.property_ids
    };
    if (myRole === 'admin') body.operator_ids = form.operator_ids;
    if (form.apiv3_key) body.apiv3_key = form.apiv3_key;
    if (form.private_key) body.private_key = form.private_key;
    if (form.id) await api.put(`/pay-configs/${form.id}`, body);
    else await api.post('/pay-configs', body);
    ElMessage.success(form.id ? '配置已更新' : '配置已创建');
    dlg.value = false;
    load();
  } finally {
    saving.value = false;
  }
}

async function del(row) {
  await confirmDelete(`微信支付配置「${row.name}」及其项目绑定`);
  await api.delete(`/pay-configs/${row.id}`);
  ElMessage.success('配置已删除');
  load();
}

onMounted(load);
</script>
