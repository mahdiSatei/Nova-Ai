// سیگنال سراسری «گفتگوی جدید» بین ChatSidebar (در UserShell) و ChatView.
// ماژول‌سطحی و واکنش‌گراست تا مجبور به prop-drilling یا دست‌زدن به منطق چت نشویم.
import { ref } from 'vue'

const tick = ref(0)

export function requestNewChat(): void {
  tick.value += 1
}

export function useNewChatSignal() {
  return { tick }
}
