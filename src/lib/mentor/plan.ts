import type { MentorAction, Match, Opening, Person, Role, SkillClaim } from "@/lib/types";
import { levelFromValue, levelValue } from "@/lib/types";

export interface PlanInput {
  match: Match;
  role: Role;
  openings: Opening[];
  people: Person[];
  claims: SkillClaim[];
}

/**
 * Turns measured gaps into actions bound to real objects.
 *
 * The rule enforced here: if there is nothing in the system that would close a
 * gap, we emit no action for it. A recommendation the organisation cannot honour
 * ("develop your stream processing skills") is the thing that makes career tools
 * feel like a horoscope, and it is trivially easy to generate, which is why so
 * much of this category is made of it.
 */
export function planActions({ match, role, openings, people, claims }: PlanInput): MentorAction[] {
  const actions: MentorAction[] = [];
  const peopleById = new Map(people.map((p) => [p.id, p]));

  for (const gap of match.gaps) {
    const relevant = openings.filter((o) => o.buildsSkillIds.includes(gap.skillId));
    for (const opening of relevant) {
      const isPairing = opening.kind === "mentor_pairing";
      const mentor = opening.personId ? peopleById.get(opening.personId) : undefined;
      actions.push({
        id: `act_${gap.skillId}_${opening.id}`,
        kind: isPairing ? "request_mentor" : "request_work",
        label: isPairing && mentor ? `Request 30 min with ${mentor.name}` : `Request ${opening.title}`,
        boundTo: { type: "opening", id: opening.id },
        because: {
          skillId: gap.skillId,
          fromLevel: gap.current,
          toLevel: gap.required,
          roleId: role.id,
        },
        // Weighted, distance-scaled, and discounted for pairings because a
        // conversation moves a level less reliably than shipping the work does.
        priority: Number((gap.weight * gap.distance * (isPairing ? 0.6 : 1)).toFixed(2)),
      });
    }
  }

  // A thin claim on a requirement the role weights heavily is not a skills gap,
  // it is an evidence gap, and the fix is different: go do something legible.
  for (const req of role.requirements) {
    const claim = claims.find((c) => c.skillId === req.skillId);
    if (!claim?.thin) continue;
    actions.push({
      id: `act_evidence_${req.skillId}`,
      kind: "close_evidence_gap",
      label: `Build a legible track record in ${req.skillId.replace(/_/g, " ")}`,
      boundTo: { type: "skill", id: req.skillId },
      because: {
        skillId: req.skillId,
        fromLevel: claim.level,
        toLevel: levelFromValue(levelValue(claim.level) + 1),
        roleId: role.id,
      },
      priority: Number((req.weight * 0.5).toFixed(2)),
    });
  }

  const requisition = openings.find((o) => o.kind === "requisition" && o.roleId === role.id);
  if (requisition) {
    actions.push({
      id: `act_interest_${requisition.id}`,
      kind: "flag_interest",
      label: `Flag interest in ${requisition.title}`,
      boundTo: { type: "opening", id: requisition.id },
      because: {
        skillId: match.gaps[0]?.skillId ?? role.requirements[0]?.skillId ?? "",
        fromLevel: "none",
        toLevel: "none",
        roleId: role.id,
      },
      // Deliberately below gap-closing work: flagging interest before you are
      // close is how people collect disappointments.
      priority: match.score > 0.7 ? 5 : 0.4,
    });
  }

  return actions.sort((a, b) => b.priority - a.priority);
}
