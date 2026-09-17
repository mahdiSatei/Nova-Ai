import type { UserPublic } from '@/types/api'

/** Identicon hash source: the stored seed when set, else the user id. */
export function avatarValueFor(user: Pick<UserPublic, 'id' | 'avatarSeed'>): string {
  return user.avatarSeed ?? user.id
}
