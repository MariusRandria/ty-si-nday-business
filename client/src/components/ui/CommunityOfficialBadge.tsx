import { BadgeCheck } from 'lucide-react'

export function CommunityOfficialBadge() {
  return <span className="community-official-badge" title="Profil officiel vérifié" aria-label="Profil officiel vérifié">
    <BadgeCheck size={17} aria-hidden="true" />
  </span>
}
