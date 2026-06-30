<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import * as z from 'zod'
import type { FormSubmitEvent, AuthFormField } from '@nuxt/ui'
import { authClient } from '../utils/auth-client'

const router = useRouter()
const isSignUp = ref(false)
const loading = ref(false)
const errorMessage = ref('')

const fields: AuthFormField[] = [{
  name: 'email',
  type: 'email',
  label: 'Email',
  placeholder: 'Enter your email',
  required: true
}, {
  name: 'password',
  label: 'Password',
  type: 'password',
  placeholder: 'Enter your password',
  required: true
}]

const schema = z.object({
  email: z.email('Invalid email'),
  password: z.string().min(8, 'Must be at least 8 characters')
})

type Schema = z.output<typeof schema>

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  errorMessage.value = ''

  try {
    if (isSignUp.value) {
      await authClient.signUp.email({
        email: event.data.email,
        password: event.data.password,
        name: event.data.email.split('@')[0]
      })
    } else {
      await authClient.signIn.email({
        email: event.data.email,
        password: event.data.password
      })
    }
    router.push('/')
  } catch (e: any) {
    errorMessage.value = e?.message || 'Authentication failed'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center bg-muted/50">
    <UPageCard class="w-full max-w-md">
      <UAuthForm
        :schema="schema"
        :fields="fields"
        :title="isSignUp ? 'Create an account' : 'Welcome back!'"
        :description="isSignUp ? 'Sign up to get started.' : 'Sign in to your account.'"
        icon="i-lucide-lock"
        :submit="{ label: isSignUp ? 'Sign up' : 'Sign in', loading, block: true }"
        @submit="onSubmit"
      >
        <template #validation v-if="errorMessage">
          <UAlert color="error" :title="errorMessage" icon="i-lucide-alert-circle" />
        </template>

        <template #footer>
          <p class="text-center text-sm text-muted">
            {{ isSignUp ? 'Already have an account?' : "Don't have an account?" }}
            <a
              class="text-primary font-medium cursor-pointer"
              @click="isSignUp = !isSignUp; errorMessage = ''"
            >
              {{ isSignUp ? 'Sign in' : 'Sign up' }}
            </a>
          </p>
        </template>
      </UAuthForm>
    </UPageCard>
  </div>
</template>
