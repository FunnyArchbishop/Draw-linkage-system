<template>
  <div class="slider-control">
    <label class="slider-label">{{ label }}</label>
    <input
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      @input="$emit('update:modelValue', Number($event.target.value))"
      class="slider-input"
    />
    <span class="slider-value">{{ displayValue }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  label: { type: String, required: true },
  modelValue: { type: Number, required: true },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  step: { type: Number, default: 1 },
  format: { type: Function, default: (v) => v }
})

defineEmits(['update:modelValue'])

const displayValue = computed(() => props.format(props.modelValue))
</script>

<style scoped>
.slider-control {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
}

.slider-label {
  color: #8892b0;
  font-size: 13px;
  min-width: 70px;
  text-align: right;
}

.slider-input {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: #1a2540;
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.slider-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #64ffda;
  cursor: pointer;
  border: 2px solid #0a192f;
}

.slider-input::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #64ffda;
  cursor: pointer;
  border: 2px solid #0a192f;
}

.slider-value {
  color: #ccd6f6;
  font-size: 13px;
  min-width: 40px;
  text-align: left;
  font-variant-numeric: tabular-nums;
}
</style>
