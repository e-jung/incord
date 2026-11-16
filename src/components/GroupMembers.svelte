<script module lang="ts">
  type Role = 'owner' | 'admin' | 'member';
  export type Member = {
    id: string;
    name: string;
    role: Role;
    self: boolean;
    weekDays: string[];
    weeklyGoal: number;
    learnedCount: number;
    streak: number;
    titles?: { title: string; translation?: string; learned: boolean }[];
    goalStatus: string;
    goalLearned: number;
    goalTotal: number;
  };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Settings } from '../store';
  import { copy as ui } from '../config/copy';
  import WeekDots from './WeekDots.svelte';
  let {
    group,
    settings,
    busy,
    manager,
    owner,
    mutate,
    feedback,
    onConfirm,
  }: {
    group: { members: Member[]; goal: unknown };
    settings: Settings;
    busy: string;
    manager: boolean;
    owner: boolean;
    mutate: (key: string, suffix: string, body: unknown, success: string) => Promise<void>;
    feedback: Snippet<[string]>;
    onConfirm: (kind: 'remove' | 'transfer', member: Member) => void;
  } = $props();
  function weekDotDays(days: string[]) {
    return days.map((value) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      const [year, month, date] = value.split('-').map(Number);
      return new Date(year, month - 1, date).toLocaleDateString(ui.dateLocale);
    });
  }
</script>

<section class="stack" aria-label={ui.groups.membersLabel}>
  <h3>{ui.groups.membersHeading}</h3>
  <ul class="members">
    {#each group.members as member (member.id)}
      <li class="member">
        <div class="member-heading">
          <strong>{ui.groups.memberName(member.name, member.self)}</strong><small
            >{ui.groups.roles[member.role]}</small
          >
        </div>
        <WeekDots days={weekDotDays(member.weekDays)} />
        <p class="metrics">
          {ui.groups.weekPracticed(new Set(member.weekDays).size, member.weeklyGoal)}<br
          />{ui.groups.learnedAndStreak(member.learnedCount, member.streak)}
        </p>
        {#if group.goal}<p class="metrics">
            {ui.groups.goalProgress(member.goalStatus, member.goalLearned, member.goalTotal)}
          </p>{/if}
        {#if member.titles?.length && (!member.self || (settings as Settings & { groupShareTitles?: boolean }).groupShareTitles !== false)}
          <details class="titles">
            <summary>{ui.groups.titles}</summary>
            <ul>
              {#each member.titles as title, index (`${index}:${title.title}:${title.translation}`)}<li
                >
                  <span>{title.title}</span>{#if title.translation}<small class="translation"
                      >{title.translation}</small
                    >{/if}<small>{title.learned ? ui.groups.learned : ui.groups.memorizing}</small>
                </li>{/each}
            </ul>
          </details>
        {/if}
        {#if !member.self}
          <button
            class="text-button"
            disabled={!!busy}
            aria-label={ui.groups.prayFor(member.name)}
            onclick={() =>
              void mutate(
                `pray:${member.id}`,
                '/pray',
                { memberId: member.id },
                ui.groups.prayerSent,
              )}>{busy === `pray:${member.id}` ? ui.groups.sending : ui.groups.pray}</button
          >
          {@render feedback(`pray:${member.id}`)}
          {#if manager && member.role !== 'owner' && (owner || member.role === 'member')}
            <details class="member-controls">
              <summary>{ui.groups.manageMember(member.name)}</summary>
              <div class="stack">
                {#if owner}<label
                    >{ui.groups.roleFor(member.name)}<select
                      value={member.role}
                      disabled={!!busy}
                      onchange={(event) => {
                        const role = event.currentTarget.value;
                        event.currentTarget.value = member.role;
                        void mutate(
                          `role:${member.id}`,
                          '/role',
                          { memberId: member.id, role },
                          ui.groups.roleUpdated,
                        );
                      }}
                      ><option value="member">{ui.groups.memberRole}</option><option value="admin"
                        >{ui.groups.adminRole}</option
                      ></select
                    ></label
                  >{@render feedback(`role:${member.id}`)}{/if}
                <button
                  class="text-button danger"
                  disabled={!!busy}
                  onclick={() => onConfirm('remove', member)}>{ui.groups.removeMember}</button
                >
                {#if owner}<button
                    class="text-button"
                    disabled={!!busy}
                    onclick={() => onConfirm('transfer', member)}
                    >{ui.groups.transferTo(member.name)}</button
                  >{/if}
              </div>
            </details>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
</section>
