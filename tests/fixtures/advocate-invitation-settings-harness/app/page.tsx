import { InvitationSettingsClient } from "@/components/advocates/admin/InvitationSettingsClient"

/**
 * Renders the production invitation settings client so its request behaviour
 * can be observed in a real browser. No test loaded this component before:
 * a reachability probe that appended a throwing statement to it and ran the
 * complete offline lane passed unchanged.
 */
export default function Page() {
  return (
    <main>
      <InvitationSettingsClient
        slug="hope-partners"
        initialInvitations={[]}
        canInvite
      />
    </main>
  )
}
