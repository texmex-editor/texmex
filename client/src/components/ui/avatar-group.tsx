import React from 'react'
import { cn } from '@/components/lib/utils.ts'

export interface AvatarGroupUser {
  id: string
  name: string
  color: string
}

interface AvatarGroupProps {
  users: AvatarGroupUser[]
  /** Max avatars shown before collapsing the rest into a +N chip. Default 3 —
   *  small enough to keep the editor header readable in narrow panes while
   *  still showing the most relevant collaborators directly. */
  max?: number
  className?: string
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    return `${words[0]?.[0] || ''}${words[1]?.[0] || ''}`.toUpperCase()
  }

  return (name.trim().slice(0, 2) || '??').toUpperCase()
}

export const AvatarGroup: React.FC<AvatarGroupProps> = ({ users, max = 3, className }) => {
  const visibleUsers = users.slice(0, max)
  const hiddenUsers = users.slice(max)
  const remaining = hiddenUsers.length

  // Browser-native `title` only renders one line, but accepts \n. Join hidden
  // names with newlines so the chip's tooltip is a readable list rather than
  // an unhelpful "+5 more collaborators" with no clue who's there.
  const hiddenTooltip =
    remaining > 0
      ? hiddenUsers.map((u) => u.name).join('\n')
      : ''

  return (
    <div className={cn('flex items-center', className)} aria-label="Connected collaborators">
      {visibleUsers.map(user => (
        <div
          key={user.id}
          title={user.name}
          className="-ml-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold text-white first:ml-0"
          style={{ backgroundColor: user.color }}
          aria-label={user.name}
        >
          {getInitials(user.name)}
        </div>
      ))}
      {remaining > 0 && (
        <div
          className="-ml-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-slate-500 text-[10px] font-semibold text-white"
          title={hiddenTooltip}
          aria-label={`${remaining} more collaborators: ${hiddenUsers.map((u) => u.name).join(', ')}`}
        >
          +{remaining}
        </div>
      )}
    </div>
  )
}
