import { ElMessageBox } from 'element-plus';

// 高危删除确认：必须手动输入「删除」两字才能执行
// targetDesc：被删对象描述，如 租客「张三」/ 房间「101」
export function confirmDelete(targetDesc = '') {
  return ElMessageBox.prompt(
    `此操作不可恢复。请输入「删除」两字确认删除${targetDesc}：`,
    '删除确认',
    {
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      inputPlaceholder: '请输入：删除',
      inputPattern: /^删除$/,
      inputErrorMessage: '必须输入「删除」两字才能删除',
      closeOnClickModal: false
    }
  ).then(({ value }) => {
    if (value !== '删除') return Promise.reject(new Error('未输入删除确认'));
    return true;
  });
}
