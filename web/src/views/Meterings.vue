<template>
  <div>
    <el-card shadow="never" style="border-radius:10px;margin-bottom:12px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <el-date-picker v-model="period" type="month" value-format="YYYY-MM" placeholder="抄表月份" style="width:150px;" />
        <el-select v-model="projectId" placeholder="选择项目" clearable style="width:180px;" @change="onProjectChange">
          <el-option v-for="p in projects" :key="p.id" :label="p.name" :value="p.id" />
        </el-select>
        <el-button type="primary" @click="exportTpl">导出 Excel 模板</el-button>
        <el-upload :show-file-list="false" :http-request="doImport" accept=".xlsx,.xls">
          <el-button type="success">导入抄表 Excel</el-button>
        </el-upload>
        <el-button @click="load">刷新记录</el-button>
        <span style="color:#9ca3af;font-size:12px;">先选项目导出模板，在 Excel 中填好水/电「本期」读数后保存，再导入</span>
      </div>
    </el-card>

    <el-card v-if="result" shadow="never" style="border-radius:10px;margin-bottom:12px;border-color:#e5e7eb;">
      <el-alert :type="result.failed ? 'warning' : 'success'" :closable="false"
        :title="`导入完成：成功 ${result.success} 条，失败 ${result.failed} 条`" style="margin-bottom:8px;" />
      <el-table v-if="result.failures && result.failures.length" :data="result.failures" size="small" max-height="200">
        <el-table-column prop="line" label="Excel行" width="80" />
        <el-table-column prop="reason" label="失败原因" />
      </el-table>
    </el-card>

    <el-card shadow="never" style="border-radius:10px;">
      <el-table :data="list" size="small" stripe>
        <el-table-column prop="period" label="月份" width="90" />
        <el-table-column label="房源" min-width="140"><template #default="{row}">{{ row.property_name }} · {{ row.room_no }}</template></el-table-column>
        <el-table-column label="表类型" width="80"><template #default="{row}">{{ row.meter_type === 'water' ? '水表' : '电表' }}</template></el-table-column>
        <el-table-column prop="prev_reading" label="上期" width="80" />
        <el-table-column prop="curr_reading" label="本期" width="80" />
        <el-table-column prop="usage" label="用量" width="80" />
        <el-table-column label="金额" width="90"><template #default="{row}">{{ row.amount }}元</template></el-table-column>
        <el-table-column prop="created_at" label="录入时间" min-width="150" />
      </el-table>
      <el-empty v-if="!list.length" description="暂无抄表记录" :image-size="80" />
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';

const period = ref(new Date().toISOString().slice(0, 7));
const projectId = ref(null);
const projects = ref([]);
const list = ref([]);
const result = ref(null);

async function loadProjects() {
  projects.value = await api.get('/properties');
}
function onProjectChange(v) {
  if (v) load();
}
async function load() {
  list.value = await api.get('/meterings', {
    params: { period: period.value || undefined, project_id: projectId.value || undefined }
  });
}
async function exportTpl() {
  if (!period.value) return ElMessage.warning('请先选择抄表月份');
  if (!projectId.value) return ElMessage.warning('请先选择要导出的项目');
  const blob = await api.get('/meterings/template', { params: { period: period.value, project_id: projectId.value }, responseType: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const pname = projects.value.find(x => x.id === projectId.value)?.name || 'project';
  a.href = url; a.download = `抄表模板-${pname}-${period.value}.xlsx`;
  a.click(); URL.revokeObjectURL(url);
  ElMessage.success('模板已导出，请打开填写「本期」读数后保存');
}
async function doImport({ file }) {
  if (!period.value) return ElMessage.warning('请先选择抄表月份');
  const fd = new FormData();
  fd.append('period', period.value);
  fd.append('file', file);
  result.value = await api.post('/meterings/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  load();
}
onMounted(() => { loadProjects(); load(); });
</script>
