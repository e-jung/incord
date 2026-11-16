<script lang="ts">
  import ActionFeedback from '../components/ActionFeedback.svelte';
  import DocumentBrowser from '../components/DocumentBrowser.svelte';

  import { incordCopy as incord } from '../config/incord';

  import { tick } from 'svelte';
  import { copy as ui } from '../config/copy';

  import Button from '../components/Button.svelte';
  import List from '../components/List.svelte';
  import Row from '../components/Row.svelte';
  import Cover from '../components/Cover.svelte';

  import { tokenize } from '../engine';
  import { documents } from '../content';
  import { passages, passageTranslations } from '../passages';
  import { topics } from '../topics';

  import type { AppRuntime } from '../controllers/state.svelte';

  let {
    vm,
  }: {
    vm: Pick<
      AppRuntime,
      | 'data'
      | 'changeTranslation'
      | 'actionNotes'
      | 'goalTarget'
      | 'groupGoalError'
      | 'navigate'
      | 'previewFeatured'
      | 'discoverFilters'
      | 'discoverFilter'
      | 'filterDiscover'
      | 'addMode'
      | 'clearPreviewNotes'
      | 'passageRequest'
      | 'loadingPassage'
      | 'selectedDoc'
      | 'found'
      | 'clearAction'
      | 'reference'
      | 'search'
      | 'busy'
      | 'passageMode'
      | 'add'
      | 'passageItems'
      | 'previewFound'
      | 'customTitle'
      | 'customText'
      | 'own'
      | 'previewTopic'
      | 'previewPassage'
      | 'documentSubtitle'
      | 'setGroupGoal'
      | 'groupGoalStart'
      | 'groupGoalEnd'
      | 'groupGoalBusy'
      | 'live'
      | 'addChecked'
    >;
  } = $props();
</script>

{#snippet translationPicker()}<label class="translation-picker"
    ><span class="sr-only">{ui.defaultTranslation}</span><select
      aria-label={ui.defaultTranslation}
      bind:value={vm.data.settings.defaultTranslation}
      onchange={vm.changeTranslation}
      >{#each passageTranslations as value}<option>{value}</option>{/each}</select
    ></label
  ><ActionFeedback note={vm.actionNotes.translation} />{/snippet}

{#if vm.goalTarget}<section class="notice stack" aria-label={ui.groupGoalChoose}>
    <h2>{ui.groupGoalChoose}</h2>
    <p>{ui.groupGoalHelp}</p>
    <Button
      secondary
      onclick={() => {
        vm.goalTarget = '';
        vm.groupGoalError = '';
        vm.navigate(ui.groups.heading);
      }}>{ui.cancel}</Button
    >
  </section>{/if}
<div class="stack">
  <section aria-labelledby="featured-heading">
    <h2 id="featured-heading">{ui.startHere}</h2>
    <div class="covers featured-cards">
      <div class="discovery-choice">
        <Cover
          title={ui.gospelTitle}
          subtitle={ui.gospelFeaturedDetail}
          translation={vm.data.settings.defaultTranslation}
          color={0}
          onclick={() => void vm.previewFeatured('gospel')}
        /><ActionFeedback note={vm.actionNotes['featured-gospel']} />
      </div>
      <div class="discovery-choice">
        <Cover
          title="Psalm 23"
          subtitle={ui.psalmFeaturedDetail}
          translation={vm.data.settings.defaultTranslation}
          color={1}
          onclick={() => void vm.previewFeatured('psalm23')}
        /><ActionFeedback note={vm.actionNotes['featured-psalm23']} />
      </div>
      <div class="discovery-choice">
        <Cover
          title="Westminster Shorter Catechism"
          subtitle={ui.wscFeaturedDetail}
          color={2}
          onclick={() => void vm.previewFeatured('wsc-start')}
        /><ActionFeedback note={vm.actionNotes['featured-wsc-start']} />
      </div>
    </div>
  </section>
  <div class="discover-filters" aria-label={ui.discoverCategories}>
    {#each vm.discoverFilters.filter((filter) => !vm.goalTarget || filter !== ui.addYourOwn) as filter}<button
        class="text-button"
        class:active={vm.discoverFilter === filter}
        aria-pressed={vm.discoverFilter === filter}
        onclick={() => vm.filterDiscover(filter)}>{filter}</button
      >{/each}
  </div>
  {#if vm.discoverFilter === ui.addYourOwn}<div class="discover-section-heading">
      <h2>{ui.addYourOwn}</h2>
      {@render translationPicker()}
    </div>
    <div class="segments" aria-label={ui.contentType}>
      {#each [[ui.verseMode, ui.verses], [ui.ownMode, ui.yourText]] as [id, label]}<button
          class="segment"
          class:active={vm.addMode === id}
          aria-pressed={vm.addMode === id}
          onclick={() => {
            vm.clearPreviewNotes();
            vm.passageRequest++;
            vm.loadingPassage = false;
            vm.addMode = id;
            vm.selectedDoc = '';
            vm.found = [];
            vm.clearAction('find');
            vm.clearAction('own');
            vm.clearAction('add');
          }}>{label}</button
        >{/each}
    </div>
    {#if vm.addMode === ui.verseMode}<label
        >{ui.bibleReference}<input
          bind:value={vm.reference}
          placeholder={ui.referencePlaceholder}
          onkeydown={(e) => {
            if (e.key === ui.enterKey) void vm.search();
          }}
        /></label
      ><Button onclick={() => void vm.search()} disabled={vm.busy || !vm.reference.trim()}
        >{ui.findVerses}</Button
      ><ActionFeedback note={vm.actionNotes.find} />{#if vm.found.length}<div
          class="passage-actions"
        >
          {#if vm.data.settings.defaultTranslation !== incord.esv}<div
              class="segments passage-segments"
              aria-label={ui.passageMode}
            >
              {#each [['passage', ui.onePassage], ['separate', ui.separateVerses], ['chunks', ui.chunks]] as [mode, label]}<button
                  class="segment"
                  class:active={vm.passageMode === mode}
                  aria-pressed={vm.passageMode === mode}
                  onclick={() => (vm.passageMode = mode)}>{label}</button
                >{/each}
            </div>{/if}<Button
            onclick={() =>
              void vm.add(
                vm.passageItems(),
                undefined,
                false,
                tokenize(vm.found.map((i) => i.text).join(' ')).length > 500,
              )}>{ui.addToLibrary}</Button
          ><ActionFeedback note={vm.actionNotes.add} />
        </div>
        <List
          >{#each vm.found as item}<Row
              title={item.title}
              subtitle={item.text}
              translation={item.translation}
              onclick={item.translation === incord.esv
                ? () => void vm.previewFound(item)
                : undefined}
            /><ActionFeedback note={vm.actionNotes['found-' + item.id]} />{/each}</List
        >{/if}{#if vm.data.settings.defaultTranslation !== incord.esv}<small
          >{ui.publicDomainNotice}</small
        >{/if}
    {:else if vm.addMode === ui.ownMode}<label
        >{ui.titleOrQuestion}<input bind:value={vm.customTitle} maxlength={200} /></label
      ><label
        >{ui.textToRemember}<textarea bind:value={vm.customText} maxlength={10000}
        ></textarea></label
      >
      <p>{ui.privateTextNotice}</p>
      <Button onclick={() => void vm.own()}>{ui.addYourText}</Button><ActionFeedback
        note={vm.actionNotes.own}
      />
    {/if}{/if}

  {#if vm.discoverFilter === ui.topics}<section aria-labelledby="topics-heading">
      <div class="discover-section-heading">
        <h2 id="topics-heading">{ui.topics}</h2>
        {@render translationPicker()}
      </div>
      <div class="topic-cards passage-cards">
        {#each topics as topic, i}<div class="discovery-choice">
            <Cover
              title={topic.title}
              subtitle={`${topic.verseCount} verses · ${topic.description}`}
              translation={vm.data.settings.defaultTranslation}
              color={i}
              onclick={() => void vm.previewTopic(topic.id)}
            /><ActionFeedback note={vm.actionNotes['topic-' + topic.id]} />
          </div>{/each}
      </div>
    </section>{/if}
  {#if vm.discoverFilter === ui.passages}<section aria-labelledby="passages-heading">
      <div class="discover-section-heading">
        <h2 id="passages-heading">{ui.passages}</h2>
        {@render translationPicker()}
      </div>
      <p>{ui.passageDetail}</p>
      <div class="passage-cards">
        {#each passages as passage, i}<div class="scripture-card">
            <Cover
              title={passage.reference}
              subtitle={`${passage.verseCount} verses · ${passage.title}`}
              color={i}
              translation={vm.data.settings.defaultTranslation}
              onclick={() => {
                if (!vm.busy) void vm.previewPassage(passage.id);
              }}
            /><ActionFeedback note={vm.actionNotes['passage-' + passage.id]} />
          </div>{/each}
      </div>
    </section>{/if}
  {#if vm.discoverFilter === ui.catechismsAndCreeds}<section aria-labelledby="documents-heading">
      <h2 id="documents-heading" class="section-title">{ui.catechismsAndCreeds}</h2>
      <div class="document-cards passage-cards">
        {#each documents as doc, i}<Cover
            title={doc.title}
            subtitle={vm.documentSubtitle(doc)}
            color={i}
            onclick={() => {
              vm.selectedDoc = doc.id;
              void tick().then(() =>
                document.getElementById('document-browser')?.scrollIntoView({ block: 'start' }),
              );
            }}
          />{/each}
      </div>
      {#if vm.selectedDoc}{@const doc = documents.find(
          (d: any) => d.id === vm.selectedDoc,
        )}{#if doc}{#if vm.goalTarget}<div id="document-browser">
              <header class="document-intro">
                <h2>{doc.title}</h2>
                <p>{doc.subtitle}</p>
                {#if doc.description}<p>{doc.description}</p>{/if}
              </header>
              <form
                class="stack"
                aria-label={ui.groupGoalChoose}
                onsubmit={(event) => {
                  event.preventDefault();
                  void vm.setGroupGoal({
                    kind: 'document',
                    id: doc.id,
                    translation: vm.data.settings.defaultTranslation || 'BSB',
                    start: Number(vm.groupGoalStart),
                    end: Number(vm.groupGoalEnd),
                  });
                }}
              >
                <label
                  >{ui.groupGoalStart}<input
                    type="number"
                    min="1"
                    max={doc.questionCount ||
                      Math.max(...doc.items.map((item) => item.number || 1))}
                    bind:value={vm.groupGoalStart}
                    required
                  /></label
                ><label
                  >{ui.groupGoalEnd}<input
                    type="number"
                    min={vm.groupGoalStart}
                    max={doc.questionCount ||
                      Math.max(...doc.items.map((item) => item.number || 1))}
                    bind:value={vm.groupGoalEnd}
                    required
                  /></label
                ><Button type="submit" disabled={vm.groupGoalBusy}
                  >{vm.groupGoalBusy ? ui.groupGoalSaving : ui.groupGoalUse}</Button
                >{#if vm.groupGoalError}<p role="alert">{vm.groupGoalError}</p>{/if}
              </form>
            </div>{:else}{#key doc.id}<DocumentBrowser
                document={doc}
                live={vm.live}
                add={vm.addChecked}
              />{/key}{/if}{/if}{/if}
    </section>{/if}
</div>
