import { getApiAuthMe, postApiAuthLogout, type AuthResponse } from '@/client'
import { client } from '@/client/client.gen'

const DEFAULT_API_BASE_URL = 'http://localhost:3000'

export const configureApiClient = () => {
  client.setConfig({
    baseUrl: import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL,
    credentials: 'include',
  })
}

export const bootstrapSession = async (): Promise<AuthResponse | null> => {
  const result = await getApiAuthMe()
  return result.data ?? null
}

export const logoutSession = async (): Promise<void> => {
  await postApiAuthLogout()
}

