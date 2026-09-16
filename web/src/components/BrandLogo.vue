<template>
  <div class="bl-brand" :style="{ gap: Math.round(size / 4) + 'px' }">
    <img class="bl-ico" src="/lookhome-icon.png" :style="{ height: size + 'px', width: 'auto' }" :alt="'LookHome'" />
    <div class="bl-text">
      <div class="bl-name" :style="{ fontSize: Math.round(size * 0.6) + 'px', color: dark ? '#ffffff' : '#1b2a4a' }">
        LookHome <span class="bl-en" :style="{ fontSize: Math.round(size * 0.35) + 'px', color: dark ? 'rgba(255,255,255,.62)' : '#8a97ad' }">LOOKHOME</span>
      </div>
      <div v-if="sub" class="bl-sub" :style="{ fontSize: Math.round(size * 0.3) + 'px', color: dark ? 'rgba(255,255,255,.55)' : '#9aa3b2' }">{{ sub }}</div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  size: { type: Number, default: 40 },      // 图标高度（px）
  dark: { type: Boolean, default: false },  // 深色背景适配
  sub: { type: String, default: '' }        // 副标题（可选）
});
</script>

<style scoped>
.bl-brand { display: flex; align-items: center; }
.bl-ico { flex-shrink: 0; display: block; }
.bl-text { line-height: 1.25; min-width: 0; }
.bl-name { font-weight: 800; letter-spacing: 1px; white-space: nowrap; }
.bl-en { font-weight: 500; letter-spacing: 2px; margin-left: 4px; }
.bl-sub { margin-top: 2px; letter-spacing: 1px; white-space: nowrap; }
</style>
