<script lang="ts">
 import Button from './Button.svelte';
 import List from './List.svelte';
 import {ui, plural, documentBrowserCopy as words} from '../config/copy';
 import type {ContentCollection, ContentItem} from '../content';
 import type {Item} from '../store';
 import {documentNumbers, isCreed, itemsInDocumentRange, nextDocumentRange, type DocumentRange, type DocumentRangeMode} from '../document-ranges';
 let {document, live, add}: {document: ContentCollection; live: Item[]; add: (items: ContentItem[], collectionId: string) => unknown | Promise<unknown>} = $props();
 // Parent keys this browser by document.id so a different card always starts fresh.
 let chosenMode = $state<DocumentRangeMode | null>(null);
 let chosen = $state<DocumentRange | null>(null);
 let busy = $state(false);
 const creed = $derived(isCreed(document));
 const hasDays = $derived(document.items.some(item => item.lordsDay));
 const mode = $derived(chosenMode ?? (hasDays ? 'days' : 'questions'));
 const range = $derived(chosen ?? nextDocumentRange(document, live, mode));
 const numbers = $derived(documentNumbers(document, mode));
 const selected = $derived(itemsInDocumentRange(document, mode, range));
 const addedIds = $derived(new Set(live.filter(item => !item.deleted).map(item => item.id)));
 const missing = $derived(selected.filter(item => !addedIds.has(item.id)));
 const questionCount = $derived(new Set(selected.map(item => item.number)).size);
 function changeMode(next: DocumentRangeMode) { chosenMode = next; chosen = null; }
 function changeRange(key: keyof DocumentRange, value: number) { chosen = {...range, [key]: value}; }
 async function addSelection() {
  if (busy || !missing.length) return;
  busy = true;
  try { if (await add(missing, document.id) === true) chosen = null; }
  finally { busy = false; }
 }
</script>

<section id="document-browser" class="document-browser stack" aria-label={document.title}>
 <header class="document-intro stack">
  <h2>{document.title}</h2>
  <p>{plural(document.questionCount || documentNumbers(document).length, creed ? 'article' : 'question')} · {document.subtitle}</p>
  {#if document.description}<p>{document.description}</p>{/if}
 </header>
 <div class="document-range-panel stack">
  <div class="segments" aria-label={words.selection}>
   <button class="segment" class:active={mode==='questions'} aria-pressed={mode==='questions'} onclick={()=>changeMode('questions')}>{creed ? words.articleRange : words.questionRange}</button>
   {#if hasDays}<button class="segment" class:active={mode==='days'} aria-pressed={mode==='days'} onclick={()=>changeMode('days')}>{words.dayRange}</button>{/if}
   <button class="segment" class:active={mode==='whole'} aria-pressed={mode==='whole'} onclick={()=>changeMode('whole')}>{words.whole}</button>
  </div>
  {#if mode!=='whole'}
   <div class="document-range-inputs">
    <label>{mode==='days' ? words.fromDay : creed ? words.fromArticle : words.fromQuestion}<input type="number" min={numbers[0]} max={numbers.at(-1)} step="1" value={range.start} oninput={event=>changeRange('start',event.currentTarget.valueAsNumber)} /></label>
    <label>{mode==='days' ? words.throughDay : creed ? words.throughArticle : words.throughQuestion}<input type="number" min={range.start} max={numbers.at(-1)} step="1" value={range.end} oninput={event=>changeRange('end',event.currentTarget.valueAsNumber)} /></label>
   </div>
   <p class="document-range-hint">{words.hint(creed,mode==='days')}</p>
  {/if}
  {#if selected.length}
   <p role="status" class="document-range-summary">{words.selectionSummary(questionCount,selected.length,creed,selected.length-missing.length)}</p>
  {:else}<p role="alert">{words.invalidRange}</p>{/if}
  <Button disabled={busy||!missing.length} onclick={()=>void addSelection()}>{busy ? words.adding : missing.length ? words.addItems(missing.length) : selected.length ? ui.alreadyAdded : words.selectRange}</Button>
 </div>
 <h3>{words.contents}</h3>
 <List>{#each document.items as item,i (item.id)}
  {#if item.lordsDay&&(i===0||document.items[i-1].lordsDay!==item.lordsDay)}<h3 class="document-day-heading">{ui.lordsDay(item.lordsDay)}</h3>{/if}
  <div class="document-row"><details><summary>{creed ? ui.articleTitle(item.number||i+1,item.text) : (item.number ? ui.questionPrefix(item.number) : '')+item.title}{#if item.parts} <small>{words.part(item.part||1,item.parts)}</small>{/if}</summary><p>{item.text}</p></details><button class="icon document-add" aria-label={addedIds.has(item.id) ? ui.added : words.addItem(item.number||i+1,creed,item.part,item.parts)} disabled={busy||addedIds.has(item.id)} onclick={()=>void add([item],document.id)}>{addedIds.has(item.id)?'✓':'+'}</button></div>
 {/each}</List>
</section>
