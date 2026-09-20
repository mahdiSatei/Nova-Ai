import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/chat' },

  // ---- Visitor ----
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { guestOnly: true },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/views/RegisterView.vue'),
    meta: { guestOnly: true },
  },

  // ---- User ----
  {
    path: '/chat',
    component: () => import('@/layouts/UserShell.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', name: 'chat', component: () => import('@/views/ChatView.vue') },
      { path: 'c/:id', name: 'chat-conversation', component: () => import('@/views/ChatView.vue'), props: true },
      { path: 'conversations/:id', name: 'conversation', component: () => import('@/views/ConversationView.vue'), props: true },
    ],
  },

  // ---- Admin ----
  {
    path: '/admin/login',
    name: 'admin-login',
    component: () => import('@/views/admin/AdminLoginView.vue'),
    meta: { guestOnly: true },
  },
  {
    path: '/admin',
    component: () => import('@/layouts/AdminShell.vue'),
    meta: { requiresAuth: true, role: 'admin' },
    children: [
      { path: '', redirect: { name: 'admin-provider' } },
      { path: 'provider', name: 'admin-provider', component: () => import('@/views/admin/ProviderView.vue') },
      { path: 'models', name: 'admin-models', component: () => import('@/views/admin/ModelsView.vue') },
      { path: 'users', name: 'admin-users', component: () => import('@/views/admin/UsersView.vue') },
      { path: 'usage', name: 'admin-usage', component: () => import('@/views/admin/UsageView.vue') },
      {path: 'files', name: 'admin-files', component: () => import('@/views/admin/FilesView.vue')
      },
    ],
  },

  { path: '/forbidden', name: 'forbidden', component: () => import('@/views/ForbiddenView.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/chat' },
]

export const homeFor = (role: 'user' | 'admin'): string =>
  role === 'admin' ? '/admin/provider' : '/chat'

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.ready) await auth.restore()

  if (to.meta.requiresAuth) {
    if (!auth.isAuthenticated) {
      // Pick the right login page based on what the caller was trying
      // to reach — admin-area visitors go to /admin/login, not /login.
      const requiredRole = to.meta.role as 'user' | 'admin' | undefined
      const loginRoute = requiredRole === 'admin' ? 'admin-login' : 'login'
      return { name: loginRoute, query: { redirect: to.fullPath } }
    }
    const requiredRole = to.meta.role as 'user' | 'admin' | undefined
    const actualRole = auth.user?.role
    if (requiredRole && actualRole !== requiredRole) {
      return { name: 'forbidden' }
    }
  }

  if (to.meta.guestOnly && auth.isAuthenticated) {
    return homeFor(auth.user!.role)
  }

  return true
})

export default router
